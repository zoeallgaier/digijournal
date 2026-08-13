/* ============================================================================
   sync.js — the journal on more than one device.

   THE PHONE IS STILL THE SOURCE OF TRUTH. Every screen reads and writes
   localStorage exactly as it did before any of this existed; Supabase is a
   mirror this file pushes to and pulls from in the background. So the app
   still opens instantly, still works on a plane, and still behaves identically
   when signed out. Nothing on the writing path waits for a network.

   What it buys: the entries are no longer only on one phone. If iOS reclaims
   the storage, or the phone is lost or replaced, signing in on the next device
   brings the journal back.

   TWO TABLES SINCE THE RATING LEFT THE ENTRY: `entries`, and `days` for how
   each day was rated. They are pushed and pulled in the same round on separate
   watermarks, and a project whose SQL predates the second one keeps syncing
   its entries while the ratings wait — see syncRatings().

   ---------------------------------------------------------------------------
   The rule, when two devices disagree

   Last edit wins, per entry — the same rule importBundle has always used. It
   is the only rule that behaves sanely after a phone has been offline: fixing
   Monday's typo on the iPad does not lose Tuesday's entry written on the
   phone, because they are different rows.

   What it does cost: editing the SAME entry on two devices while one is
   offline loses the older of the two edits, silently. For a journal — where
   an entry belongs to a day and a person writes on one device at a time —
   that is the right trade. It is worth knowing it is a trade.

   Clock skew is the assumption underneath. `updatedAt` is written by whichever
   device made the edit, so two devices whose clocks disagree by more than they
   type will resolve "last" wrongly. Phones keep network time; this is a real
   assumption but not a fragile one. SKEW below absorbs the small change.

   ---------------------------------------------------------------------------
   What is never overwritten

   The entry currently open in the editor. A sync landing mid-sentence must not
   replace the paragraph under the caret with the server's older copy of it —
   so app.js tells this file which entry is open, and mergeRemote skips it.
   ========================================================================= */

import * as store from './store.js';
import * as net from './net.js';
import { configured } from './config.js';

/* How far back to reach past the watermark on every pull. The watermark is
   made of timestamps written by OTHER devices' clocks, so asking for strictly
   newer rows would miss an edit from a phone running a minute behind. Rows
   are idempotent to re-apply, so overlapping costs a few hundred bytes and
   buys a tolerance the app would otherwise not have. */
const SKEW = 2 * 60 * 1000;

/* PostgREST answers a page at a time; ask for more while it keeps filling. */
const PAGE = 1000;

/* Rows per upsert. A first sync of a decade of entries is thousands of rows,
   and one request carrying all of them is a request that times out on a train. */
const BATCH = 200;

/* Wait this long after the last local write before pushing. Typing saves every
   400ms and each save would otherwise be its own round trip. */
const SETTLE = 3000;

/* And sync anyway on this cadence while the app sits open, so an entry written
   on the iPad reaches a phone that is already awake and looking at the list. */
const POLL_MS = 5 * 60 * 1000;

/* --------------------------------------------------------------- the state
   'off'      no account on this device, or no project configured
   'syncing'  a round is in flight
   'synced'   the last round finished cleanly
   'offline'  the last round could not reach the server — nothing is wrong
   'error'    the server answered, and said no                              */

let status = 'off';
let detail = '';
let lastSyncedAt = 0;
let inFlight = null;
let settleTimer = null;
let guard = () => null;

export function state() {
  return { status, detail, lastSyncedAt, email: net.currentEmail() };
}

function announce(next, why = '') {
  status = next;
  detail = why;
  window.dispatchEvent(new CustomEvent('dj:sync'));
}

/** app.js hands this file a way to ask what is open in the editor, so a round
 *  of syncing cannot overwrite the entry being typed into. */
export function setGuard(fn) {
  guard = typeof fn === 'function' ? fn : () => null;
}

/* ------------------------------------------------------------- row mapping
   The table is snake_case because Postgres is; the app is camelCase because
   JavaScript is. This is the whole translation, and it is the only place
   either spelling crosses over. */

function toRow(entry, userId) {
  return {
    user_id: userId,
    id: entry.id,
    title: entry.title,
    body: entry.body,
    day: entry.day,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    published: entry.published,
    deleted_at: entry.deletedAt,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    day: row.day,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    published: row.published,
    deletedAt: row.deleted_at === null || row.deleted_at === undefined
      ? null : Number(row.deleted_at),
  };
}

function toDayRow(rating, userId) {
  return {
    user_id: userId,
    day: rating.day,
    mood: rating.mood,
    updated_at: rating.updatedAt,
  };
}

function fromDayRow(row) {
  return { day: row.day, mood: row.mood, updatedAt: Number(row.updated_at) };
}

/* ------------------------------------------------------------------ a round */

async function round({ full = false } = {}) {
  const token = await net.accessToken();
  if (!token) { announce('off'); return; }

  const userId = net.currentUserId();
  if (!userId) { announce('off'); return; }

  let sync = store.syncState();

  /* A DIFFERENT ACCOUNT ON THIS DEVICE. The journal in storage belongs to
     whoever was signed in before; merging it into this account would hand one
     person's entries to another. Nothing is lost that was ever synced — the
     previous account still holds it all on the server. */
  if (sync.userId && sync.userId !== userId) {
    store.clearJournal();
    sync = store.syncState();
    full = true;
  }
  if (sync.userId !== userId) {
    store.setSyncState({ userId });
    sync = store.syncState();
  }

  /* --- push ------------------------------------------------------------
     Everything touched since the last confirmed push, tombstones included.
     On a first sync that is the entire local journal, which is exactly the
     seeding behaviour wanted: signing in on the phone that already holds the
     journal uploads it rather than finding an empty table and pulling it
     down over the top. */
  const outgoing = store.pushable(sync.pushedThrough);
  if (outgoing.length) {
    /* Read the high-water mark BEFORE the request. Anything typed while it is
       in flight gets a later updatedAt and is caught by the next round; the
       other way round, a keystroke landing mid-request would be marked pushed
       without ever having been. */
    const mark = Math.max(...outgoing.map((e) => e.updatedAt));
    for (let i = 0; i < outgoing.length; i += BATCH) {
      await net.upsert(token, outgoing.slice(i, i + BATCH).map((e) => toRow(e, userId)));
    }
    store.setSyncState({ pushedThrough: mark });
    sync = store.syncState();
  }

  /* --- pull ------------------------------------------------------------- */
  const since = full ? 0 : Math.max(0, sync.pulledThrough - SKEW);
  let cursor = since;
  let highest = sync.pulledThrough;
  let changed = 0;

  for (;;) {
    const rows = await net.selectSince(token, cursor, PAGE);
    if (!rows.length) break;

    const { latest, added, updated } = store.mergeRemote(rows.map(fromRow), { skip: guard() });
    highest = Math.max(highest, latest);
    changed += added + updated;

    if (rows.length < PAGE) break;
    /* Rows come back oldest first, so the last one is the new floor. If a
       whole page shares one millisecond this would not advance — it cannot
       here, because updatedAt is per-edit and an edit takes longer than that. */
    const next = Number(rows[rows.length - 1].updated_at);
    if (next <= cursor) break;
    cursor = next;
  }

  /* Rows that arrived FROM the server are, by definition, already on it.
     Advancing the push watermark past them stops every round echoing the other
     device's entries straight back. Never past our own clock, though — a
     remote row stamped in the future would otherwise suppress the next real
     local edit. */
  if (highest > sync.pushedThrough) {
    store.setSyncState({ pushedThrough: Math.min(highest, Date.now()) });
  }
  store.setSyncState({ pulledThrough: highest });

  changed += await syncRatings(token, userId, full);

  lastSyncedAt = Date.now();
  announce('synced');

  /* Only when entries actually arrived. app.js redraws the list on this, and
     redrawing it on every quiet round would mean a screen that flickers and
     loses its scroll position once a minute for no reason at all. */
  if (changed) window.dispatchEvent(new CustomEvent('dj:sync-changed'));
}

/* The day ratings, on their own watermarks. Same shape as the half above and
   simpler for having no tombstones and no open editor to protect: one row per
   day, later row wins, and a cleared rating is a row saying null.

   It is deliberately not allowed to fail the round. A project whose schema.sql
   was run before the ratings existed has no `days` table, and until it is run
   again the entries must go on syncing exactly as they did — with the ratings
   staying on this phone, which is the same deal the whole app had before
   anyone signed in. Any OTHER error is a real one and is thrown. */
let warnedMissing = false;

async function syncRatings(token, userId, full) {
  let changed = 0;
  try {
    const sync = store.syncState();

    const outgoing = store.pushableRatings(sync.pushedDaysThrough || 0);
    if (outgoing.length) {
      const mark = Math.max(...outgoing.map((r) => r.updatedAt));
      for (let i = 0; i < outgoing.length; i += BATCH) {
        await net.upsertDays(token, outgoing.slice(i, i + BATCH).map((r) => toDayRow(r, userId)));
      }
      store.setSyncState({ pushedDaysThrough: mark });
    }

    const from = store.syncState().pulledDaysThrough || 0;
    const since = full ? 0 : Math.max(0, from - SKEW);
    let cursor = since;
    let highest = from;

    for (;;) {
      const rows = await net.selectDaysSince(token, cursor, PAGE);
      if (!rows.length) break;
      const result = store.mergeRemoteRatings(rows.map(fromDayRow));
      highest = Math.max(highest, result.latest);
      changed += result.changed;
      if (rows.length < PAGE) break;
      const next = Number(rows[rows.length - 1].updated_at);
      if (next <= cursor) break;
      cursor = next;
    }

    if (highest > (store.syncState().pushedDaysThrough || 0)) {
      store.setSyncState({ pushedDaysThrough: Math.min(highest, Date.now()) });
    }
    store.setSyncState({ pulledDaysThrough: highest });
  } catch (err) {
    if (!net.isMissingTable(err)) throw err;
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn('digijournal: no `days` table yet — ratings are staying on this device. '
                 + 'Run supabase/schema.sql again.');
    }
  }
  return changed;
}

/** Run a round, unless one is already running — in which case join it. */
export function now({ full = false } = {}) {
  if (!configured() || !net.signedIn()) { announce('off'); return Promise.resolve(); }
  if (inFlight) return inFlight;

  announce('syncing');
  inFlight = round({ full })
    .catch((err) => {
      if (err?.offline) {
        /* A phone in a lift. Not a failure, and above all not a reason to
           touch the session — the entries are safe in localStorage either
           way, and the next foreground will try again. */
        announce('offline');
        return;
      }
      /* 401 is the one answer that means the session is genuinely over.
         Everything else — a dropped table, a policy that refuses a write — is
         a fault to show, not a reason to sign someone out of their journal. */
      if (err?.status === 401) {
        store.setSession(null);
        announce('off', 'Signed out — please sign in again.');
        return;
      }
      announce('error', err?.message || 'Sync failed.');
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** After signing in. A full pull, because the watermark means nothing yet and
 *  this is the round that either seeds the server from this phone or restores
 *  this phone from the server. */
export function afterSignIn() {
  return now({ full: true });
}

export function afterSignOut() {
  store.setSyncState(null);
  lastSyncedAt = 0;
  announce('off');
}

/* ----------------------------------------------------------------- wiring */

export function start() {
  if (!configured()) { announce('off'); return; }

  /* Local writes push, once the typing has stopped. */
  store.subscribe(() => {
    if (!net.signedIn()) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => now(), SETTLE);
  });

  /* Back to the foreground: the moment an entry written elsewhere should
     appear. Same event update.js listens for, and for the same reason. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') now();
  });

  /* The editor is being flushed because the app is going away. Push what was
     just written rather than waiting for SETTLE that will never come — iOS
     may not give the page another frame, so this is best effort by nature. */
  window.addEventListener('dj:flush', () => {
    clearTimeout(settleTimer);
    if (net.signedIn()) now();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') now();
  }, POLL_MS);

  if (net.signedIn()) now();
  else announce('off');
}
