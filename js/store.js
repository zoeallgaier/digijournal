/* ============================================================================
   store.js — every entry, and the only file that touches localStorage.

   The whole journal is one JSON blob under one key. That sounds crude and it
   is exactly right at this size: a decade of daily entries is a couple of
   megabytes of text, it loads in one read, and it exports in one line. If a
   day comes when it doesn't fit, the fix is IndexedDB behind this same API —
   nothing outside this file would change.

   An entry:

     { id, title, body, mood, day, createdAt, updatedAt, published, deletedAt }

   `day` is the calendar day the entry BELONGS to, fixed when it is created.
   `updatedAt` is when it was last touched. They are deliberately separate:
   the list sorts and dates by updatedAt (you asked for "date last edited"),
   while the calendar plots by `day` — so fixing a typo in Monday's entry on
   Friday does not move Monday's mood to Friday.

   `deletedAt` IS THE ONE THING SYNC ADDED. A deleted entry does not leave the
   array; it stays as a tombstone with its text blanked. Without that, deleting
   on the phone would be undone by the next sync from any other device, which
   still has the entry and no way to know it was meant to go. The tombstone is
   how "this was deleted" travels; nothing in the app ever shows one, and they
   are swept for good after DELETED_TTL.

   This file also holds the two small pieces of sync bookkeeping — the session
   and the watermarks — because it is the only file allowed near localStorage
   and that is worth keeping true.
   ========================================================================= */

const KEY = 'digijournal.v1';
const SYNC_KEY = 'digijournal.sync';
const SESSION_KEY = 'digijournal.session';

/* Bumped only when the shape below changes in a way that needs migrating.
   It travels in the export file too, so an old backup stays readable.
   Adding `deletedAt` did not need a bump: normalise() reads its absence as
   null, so a journal written before sync loads unchanged. */
export const SCHEMA = 1;

/* How long a tombstone is kept. It only has to outlive the longest a device
   might sit unopened and still be trusted to hear about a deletion — after
   this, a phone that has been in a drawer since before the delete would bring
   the entry back. Ninety days is far past when that stops being plausible,
   and a tombstone is a few dozen bytes. */
const DELETED_TTL = 90 * 24 * 60 * 60 * 1000;

export const MOODS = [
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Even' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Bright' },
];

export function moodLabel(mood) {
  const m = MOODS.find((x) => x.value === mood);
  return m ? m.label : 'Not rated';
}

/* ------------------------------------------------------------------ state */

let entries = [];
const listeners = new Set();

/** Local calendar day as YYYY-MM-DD. Never use toISOString() for this — it
 *  converts to UTC, which lands an 11pm entry on tomorrow. */
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function uid() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalise(raw) {
  const created = Number(raw.createdAt) || Date.now();
  return {
    id: String(raw.id || uid()),
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    mood: [1, 2, 3, 4, 5].includes(Number(raw.mood)) ? Number(raw.mood) : null,
    day: /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : dayKey(new Date(created)),
    createdAt: created,
    updatedAt: Number(raw.updatedAt) || created,
    published: raw.published !== false,
    deletedAt: Number(raw.deletedAt) || null,
  };
}

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.map(normalise);
  } catch {
    /* Corrupt or unreadable storage must not take the app down with it —
       an empty journal you can write into beats a white screen. */
    console.warn('digijournal: could not read storage, starting empty');
    return [];
  }
}

let writeFailed = false;

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, entries }));
    writeFailed = false;
    return true;
  } catch (err) {
    /* Quota, or Safari private mode. Say so once — silently dropping what
       someone just wrote is the worst thing this app could do. */
    if (!writeFailed) {
      writeFailed = true;
      console.error('digijournal: write failed', err);
      window.dispatchEvent(new CustomEvent('dj:write-failed'));
    }
    return false;
  }
}

function emit() {
  for (const fn of listeners) fn();
}

/** Everything the app is allowed to show. A tombstone is a row in storage and
 *  a fact for sync; it is never an entry. Every read below goes through this,
 *  which is what keeps a deleted entry deleted on every screen at once. */
function live() {
  return entries.filter((e) => e.deletedAt === null);
}

/* --------------------------------------------------------------- lifecycle */

/* Ask the browser to treat this origin's storage as worth keeping rather than
   as a cache it may reclaim. Only the installed app asks: in a tab it would
   be a permission prompt for a stranger who is only looking at the URL.
   Safari does not implement this today, so on the phone it is a no-op that
   costs nothing and starts working the day it isn't. */
function requestPersistence() {
  const installed = navigator.standalone
    || matchMedia('(display-mode: standalone)').matches;
  if (!installed) return;
  try {
    navigator.storage?.persist?.()?.catch?.(() => {});
  } catch { /* not available; nothing to fall back to */ }
}

export function load() {
  entries = read();

  /* Sweep tombstones that have outlived their job. Done on load rather than
     on a timer: it is the one moment the whole array is in hand anyway. */
  const cutoff = Date.now() - DELETED_TTL;
  const before = entries.length;
  entries = entries.filter((e) => e.deletedAt === null || e.deletedAt > cutoff);
  if (entries.length !== before) write();

  requestPersistence();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------------ reads */

/** Newest first, by last edit. Drafts included — they are entries that
 *  haven't been published yet, not a separate species. */
export function all() {
  return live().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function published() {
  return all().filter((e) => e.published);
}

export function get(id) {
  return live().find((e) => e.id === id) || null;
}

export function count() {
  return live().length;
}

/** day (YYYY-MM-DD) → the entry that represents that day on the calendar.
 *  When a day has several, the one with a mood wins, then the newest —
 *  the calendar shows a day's mood, so a rated entry is the truer answer. */
export function byDay() {
  const map = new Map();
  for (const e of live()) {
    if (!e.published) continue;
    const prev = map.get(e.day);
    if (!prev) { map.set(e.day, e); continue; }
    const better =
      (e.mood !== null && prev.mood === null) ||
      ((e.mood === null) === (prev.mood === null) && e.updatedAt > prev.updatedAt);
    if (better) map.set(e.day, e);
  }
  return map;
}

export function entriesOn(day) {
  return all().filter((e) => e.day === day && e.published);
}

/* ----------------------------------------------------------------- writes */

export function create(day) {
  const now = Date.now();
  const entry = {
    id: uid(),
    title: '',
    body: '',
    mood: null,
    day: day || dayKey(),
    createdAt: now,
    updatedAt: now,
    published: false,
    deletedAt: null,
  };
  entries.push(entry);
  write();
  emit();
  return entry;
}

/** Patch an entry. `touch: false` writes without moving updatedAt — used by
 *  publish, which sets its own timestamp, and by anything that shouldn't
 *  count as an edit. */
export function update(id, patch, { touch = true } = {}) {
  const entry = get(id);
  if (!entry) return null;
  Object.assign(entry, patch);
  if (touch) entry.updatedAt = Date.now();
  write();
  emit();
  return entry;
}

export function publish(id) {
  return update(id, { published: true });
}

/** Delete, as far as anyone using the app can tell. What actually happens is
 *  that the entry becomes a tombstone: the text is blanked — there is no
 *  reason for a server to keep holding words you deleted — and `deletedAt`
 *  is set so every other device learns the entry went rather than finding it
 *  simply missing and helpfully sending it back. */
export function remove(id) {
  const entry = get(id);
  if (!entry) return false;
  Object.assign(entry, {
    title: '',
    body: '',
    mood: null,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
  write();
  emit();
  return true;
}

/** True when an entry holds nothing a person typed. Used to sweep away the
 *  drafts created by tapping "Start writing…" and then changing your mind —
 *  those should not become rows in the list. */
export function isEmpty(entry) {
  return !!entry && !entry.title.trim() && !entry.body.trim() && entry.mood === null;
}

export function discardIfEmpty(id) {
  const entry = get(id);
  if (entry && !entry.published && isEmpty(entry)) {
    /* A hard splice, not a tombstone. An untouched draft is never pushed —
       see pushable() — so no other device has one to be told about, and
       leaving a marker behind for it would be litter with nothing to say. */
    const i = entries.indexOf(entry);
    if (i !== -1) entries.splice(i, 1);
    write();
    emit();
    return true;
  }
  return false;
}

/* --------------------------------------------------------------- syncing
   Three small things sync.js needs and nothing else may have: the rows to
   push, a way to fold in what came back, and somewhere to keep the session
   and the watermarks. They live here because this is the only file that
   touches localStorage, and that is a property worth keeping true. */

/** Everything sync should push, tombstones included.
 *
 *  An empty unpublished draft is excluded on purpose. Tapping "Start writing…"
 *  makes a real entry immediately, and most of those are abandoned — pushing
 *  them would fill the table with blank rows and, worse, make the tombstone in
 *  discardIfEmpty necessary. Nothing is lost: the moment a character is typed
 *  the draft stops being empty and syncs like anything else. */
export function pushable(since = 0) {
  return entries.filter((e) =>
    e.updatedAt > since && !(e.deletedAt === null && !e.published && isEmpty(e)));
}

/** Fold rows from another device in. Last edit wins, per entry — the same
 *  rule importBundle uses, and the only one that behaves sanely when a phone
 *  has been offline: whichever copy was touched more recently is the one that
 *  survives, whichever device it came from.
 *
 *  `skip` holds the id of an entry currently open in the editor. Without it, a
 *  sync landing mid-sentence would replace the entry under the caret with the
 *  server's copy and the next keystroke would be typed into someone else's
 *  version of the paragraph. An entry being edited is by definition the most
 *  recently touched one; it will win the next round anyway.
 *
 *  Returns what changed, and the highest updatedAt seen — the watermark for
 *  the next pull. */
export function mergeRemote(rows, { skip = null } = {}) {
  let added = 0;
  let updated = 0;
  let latest = 0;

  for (const raw of rows) {
    const incoming = normalise(raw);
    latest = Math.max(latest, incoming.updatedAt);
    if (incoming.id === skip) continue;

    const existing = entries.find((e) => e.id === incoming.id);
    if (!existing) {
      entries.push(incoming);
      added++;
    } else if (incoming.updatedAt > existing.updatedAt) {
      Object.assign(existing, incoming);
      updated++;
    }
  }

  if (added || updated) { write(); emit(); }
  return { added, updated, latest };
}

/** Everything goes. Used when a different account signs in on this device —
 *  the journal in storage belongs to whoever was signed in before, and
 *  merging one person's entries into another's account would be the worst
 *  bug this app could have. */
export function clearJournal() {
  entries = [];
  write();
  setSyncState(null);
  emit();
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota or private mode; sync degrades, the journal does not */ }
}

/** { userId, pulledThrough, pushedThrough } */
export function syncState() {
  return readJSON(SYNC_KEY) || { userId: null, pulledThrough: 0, pushedThrough: 0 };
}

export function setSyncState(patch) {
  writeJSON(SYNC_KEY, patch === null ? null : { ...syncState(), ...patch });
}

/** { accessToken, refreshToken, expiresAt, userId, email } */
export function session() {
  return readJSON(SESSION_KEY);
}

export function setSession(value) {
  writeJSON(SESSION_KEY, value);
}

/* --------------------------------------------------------- export/import */

export function exportBundle() {
  return {
    app: 'digijournal',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    entries: all(),
  };
}

/** Merge a bundle in. Same id → keep whichever was edited last, so importing
 *  a backup onto a phone that has since moved on doesn't roll it back.
 *  Returns a tally for the toast. */
export function importBundle(bundle) {
  if (!bundle || !Array.isArray(bundle.entries)) {
    throw new Error('That file is not a Digijournal backup.');
  }
  let added = 0;
  let updated = 0;
  for (const raw of bundle.entries) {
    const incoming = normalise(raw);
    /* Against the raw array, not get(): an entry deleted here must not be
       resurrected by an older backup that still has it, and get() cannot see
       the tombstone that says so. */
    const existing = entries.find((e) => e.id === incoming.id);
    if (!existing) {
      entries.push(incoming);
      added++;
    } else if (incoming.updatedAt > existing.updatedAt) {
      Object.assign(existing, incoming);
      updated++;
    }
  }
  write();
  emit();
  return { added, updated };
}
