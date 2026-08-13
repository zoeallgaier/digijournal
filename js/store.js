/* ============================================================================
   store.js — every entry, every day's rating, and the only file that touches
   localStorage.

   The whole journal is one JSON blob under one key. That sounds crude and it
   is exactly right at this size: a decade of daily entries is a couple of
   megabytes of text, it loads in one read, and it exports in one line. If a
   day comes when it doesn't fit, the fix is IndexedDB behind this same API —
   nothing outside this file would change.

   An entry:

     { id, title, body, day, createdAt, updatedAt, published, deletedAt }

   A rating:

     { day, mood, updatedAt }

   THE RATING IS A PROPERTY OF THE DAY, NOT OF AN ENTRY. It used to live on
   the entry, which meant a day you rated but did not write about had to
   invent a draft to hold the rating, and a day you wrote about twice had two
   moods and a tiebreak deciding which one the calendar believed. One row per
   day, keyed by the day itself, is the shape the thing actually has.

   A rating is never deleted, only set to null — the row with its later
   `updatedAt` is how "I cleared this" reaches the other device, exactly as a
   tombstone does for an entry, and it costs a few bytes to keep forever.

   `day` is the calendar day the entry BELONGS to, fixed when it is created.
   `updatedAt` is when it was last touched. They are deliberately separate:
   the list sorts and dates by updatedAt (you asked for "date last edited"),
   while the calendar plots by `day` — so fixing a typo in Monday's entry on
   Friday does not move Monday's entry off Monday.

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
const PALETTE_KEY = 'digijournal.palette';

/* Bumped only when the shape below changes in a way that needs migrating.
   It travels in the export file too, so an old backup stays readable.
   Adding `deletedAt` did not need a bump: normalise() reads its absence as
   null, so a journal written before sync loads unchanged.

   2 is the day rating leaving the entry. A journal written before it still
   has a `mood` on each entry, and adopt() folds those into day ratings on the
   one load that finds them — see load(). */
export const SCHEMA = 2;

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
  { value: 5, label: 'Stellar' },
];

export function moodLabel(mood) {
  const m = MOODS.find((x) => x.value === mood);
  return m ? m.label : 'Not rated';
}

/* ------------------------------------------------------------------ state */

let entries = [];
let ratings = [];
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

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function moodOf(raw) {
  return [1, 2, 3, 4, 5].includes(Number(raw)) ? Number(raw) : null;
}

function normalise(raw) {
  const created = Number(raw.createdAt) || Date.now();
  return {
    id: String(raw.id || uid()),
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    day: isDay(raw.day) ? raw.day : dayKey(new Date(created)),
    createdAt: created,
    updatedAt: Number(raw.updatedAt) || created,
    published: raw.published !== false,
    deletedAt: Number(raw.deletedAt) || null,
  };
}

function normaliseRating(raw) {
  return {
    day: isDay(raw.day) ? raw.day : dayKey(),
    mood: moodOf(raw.mood),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!parsed) return { schema: SCHEMA, entries: [], ratings: [] };
    return {
      schema: Number(parsed.schema) || 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
    };
  } catch {
    /* Corrupt or unreadable storage must not take the app down with it —
       an empty journal you can write into beats a white screen. */
    console.warn('digijournal: could not read storage, starting empty');
    return { schema: SCHEMA, entries: [], ratings: [] };
  }
}

let writeFailed = false;

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ schema: SCHEMA, entries, ratings }));
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
  const stored = read();
  entries = stored.entries.map(normalise);
  ratings = stored.ratings.map(normaliseRating);

  /* Every mood written before the rating left the entry. normalise() has
     already dropped it from the entry itself, so this is the one moment it
     can still be read — hence the raw rows rather than `entries`. A day
     written about twice resolves the same way two devices do: last edit
     wins. */
  const migrated = stored.entries.reduce(
    (n, raw) => n + (adopt(raw.day, moodOf(raw.mood), Number(raw.updatedAt) || 0) ? 1 : 0), 0);

  /* Sweep tombstones that have outlived their job. Done on load rather than
     on a timer: it is the one moment the whole array is in hand anyway.
     Ratings are not swept: one row per day is a rounding error beside the
     entries, and a cleared rating has to outlive every device that might
     still be holding the old one. */
  const cutoff = Date.now() - DELETED_TTL;
  const before = entries.length;
  entries = entries.filter((e) => e.deletedAt === null || e.deletedAt > cutoff);

  if (migrated || entries.length !== before || stored.schema !== SCHEMA) write();

  requestPersistence();
}

/** Take a mood found somewhere other than the ratings — an entry written
 *  before they were separated, or an old backup — and let it stand as the
 *  day's rating if nothing more recent has already spoken for that day.
 *  Returns true when it changed something. */
function adopt(day, mood, updatedAt) {
  if (mood === null || !isDay(day)) return false;
  const existing = ratings.find((r) => r.day === day);
  if (existing && existing.updatedAt >= updatedAt) return false;
  if (existing) Object.assign(existing, { mood, updatedAt });
  else ratings.push({ day, mood, updatedAt });
  return true;
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
 *  When a day has several it is the most recently edited one — the day's
 *  colour is the rating's business now, so the only question left here is
 *  which entry a tap on that day should open. */
export function byDay() {
  const map = new Map();
  for (const e of live()) {
    if (!e.published) continue;
    const prev = map.get(e.day);
    if (!prev || e.updatedAt > prev.updatedAt) map.set(e.day, e);
  }
  return map;
}

export function entriesOn(day) {
  return all().filter((e) => e.day === day && e.published);
}

/* ---------------------------------------------------------------- ratings */

/** How a day was rated, or null. Today's, unless asked for another. */
export function rating(day = dayKey()) {
  return ratings.find((r) => r.day === day)?.mood ?? null;
}

/** Rate a day, or clear it with null. The row stays either way — see the
 *  note at the top of this file on why a cleared rating is not a deletion. */
export function setRating(mood, day = dayKey()) {
  const value = moodOf(mood);
  const existing = ratings.find((r) => r.day === day);
  if (existing) Object.assign(existing, { mood: value, updatedAt: Date.now() });
  else ratings.push({ day, mood: value, updatedAt: Date.now() });
  write();
  emit();
  return value;
}

/** day → mood, for the calendar. Cleared days are left out rather than
 *  handed over as nulls: to every screen, an unrated day and a day whose
 *  rating was taken back are the same day. */
export function ratingsByDay() {
  const map = new Map();
  for (const r of ratings) if (r.mood !== null) map.set(r.day, r.mood);
  return map;
}

export function ratedIn(month) {
  return ratings.filter((r) => r.mood !== null && r.day.startsWith(month));
}

/** The rated days in a closed range, both ends included. Day keys are
 *  zero-padded, so comparing them as strings is comparing them as dates —
 *  which is what lets a week straddle the end of a month without arithmetic. */
export function ratedBetween(from, to) {
  return ratings.filter((r) => r.mood !== null && r.day >= from && r.day <= to);
}

/* ----------------------------------------------------------------- writes */

export function create(day) {
  const now = Date.now();
  const entry = {
    id: uid(),
    title: '',
    body: '',
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
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  });
  write();
  emit();
  return true;
}

/** True when an entry holds nothing a person typed. Used to sweep away the
 *  drafts created by tapping "Start writing…" and then changing your mind —
 *  those should not become rows in the list.
 *
 *  It asks about words alone now. A rating is no longer something an entry
 *  can be holding, which is the point of having moved it: rating a day never
 *  leaves a draft behind, and deleting the entry you wrote that day does not
 *  take the day's colour with it. */
export function isEmpty(entry) {
  return !!entry && !entry.title.trim() && !entry.body.trim();
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

/** The same two, for ratings. A rating is one row per day and never a
 *  tombstone, so both are simpler: everything touched since the watermark
 *  goes up, and the later row wins coming down. There is no open-editor
 *  guard because there is nothing to type into — the card on the list shows
 *  whatever the day currently says, including what another device just said
 *  about it. */
export function pushableRatings(since = 0) {
  return ratings.filter((r) => r.updatedAt > since);
}

export function mergeRemoteRatings(rows) {
  let changed = 0;
  let latest = 0;

  for (const raw of rows) {
    const incoming = normaliseRating(raw);
    latest = Math.max(latest, incoming.updatedAt);
    const existing = ratings.find((r) => r.day === incoming.day);
    if (!existing) { ratings.push(incoming); changed++; }
    else if (incoming.updatedAt > existing.updatedAt) {
      Object.assign(existing, incoming);
      changed++;
    }
  }

  if (changed) { write(); emit(); }
  return { changed, latest };
}

/** Everything goes. Used when a different account signs in on this device —
 *  the journal in storage belongs to whoever was signed in before, and
 *  merging one person's entries into another's account would be the worst
 *  bug this app could have. */
export function clearJournal() {
  entries = [];
  ratings = [];
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

/** { userId, pulledThrough, pushedThrough, pulledDaysThrough,
 *    pushedDaysThrough } — the last two are the ratings' own watermarks, kept
 *  apart from the entries' so that a project without the `days` table yet
 *  cannot stall the entries behind it. */
export function syncState() {
  return {
    userId: null,
    pulledThrough: 0,
    pushedThrough: 0,
    pulledDaysThrough: 0,
    pushedDaysThrough: 0,
    ...(readJSON(SYNC_KEY) || {}),
  };
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

/* ------------------------------------------------------------- the palette
   Which of the seven colour schemes the app is wearing. A bare string, not
   JSON, and deliberately so: index.html reads this same key from four inline
   lines before the first stylesheet is painted, and the less that fragment
   has to understand about our storage format, the better.

   It is a property of this device, not of the journal — which is why
   clearJournal() leaves it alone. Signing a different account in changes
   whose entries these are; it does not change what colour the phone is. */

export function palette() {
  try { return localStorage.getItem(PALETTE_KEY); } catch { return null; }
}

export function setPalette(id) {
  try {
    if (id === null) localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, id);
  } catch { /* quota or private mode; the colour resets, the journal does not */ }
}

/* --------------------------------------------------------- export/import */

export function exportBundle() {
  return {
    app: 'digijournal',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    entries: all(),
    ratings: ratings.filter((r) => r.mood !== null),
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
    /* A bundle written before schema 2 carries the day's rating on the entry.
       That is where the ratings have to come from for such a file, and
       adopt() applies the same last-edit-wins rule to it as everything else. */
    adopt(incoming.day, moodOf(raw.mood), incoming.updatedAt);
  }
  if (Array.isArray(bundle.ratings)) {
    for (const raw of bundle.ratings) {
      const r = normaliseRating(raw);
      adopt(r.day, r.mood, r.updatedAt);
    }
  }
  write();
  emit();
  return { added, updated };
}
