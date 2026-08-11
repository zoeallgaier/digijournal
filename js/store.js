/* ============================================================================
   store.js — every entry, and the only file that touches localStorage.

   The whole journal is one JSON blob under one key. That sounds crude and it
   is exactly right at this size: a decade of daily entries is a couple of
   megabytes of text, it loads in one read, and it exports in one line. If a
   day comes when it doesn't fit, the fix is IndexedDB behind this same API —
   nothing outside this file would change.

   An entry:

     { id, title, body, mood, day, createdAt, updatedAt, published }

   `day` is the calendar day the entry BELONGS to, fixed when it is created.
   `updatedAt` is when it was last touched. They are deliberately separate:
   the list sorts and dates by updatedAt (you asked for "date last edited"),
   while the calendar plots by `day` — so fixing a typo in Monday's entry on
   Friday does not move Monday's mood to Friday.
   ========================================================================= */

const KEY = 'digijournal.v1';

/* Bumped only when the shape below changes in a way that needs migrating.
   It travels in the export file too, so an old backup stays readable. */
export const SCHEMA = 1;

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

/* --------------------------------------------------------------- lifecycle */

export function load() {
  entries = read();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------------ reads */

/** Newest first, by last edit. Drafts included — they are entries that
 *  haven't been published yet, not a separate species. */
export function all() {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function published() {
  return all().filter((e) => e.published);
}

export function get(id) {
  return entries.find((e) => e.id === id) || null;
}

export function count() {
  return entries.length;
}

/** day (YYYY-MM-DD) → the entry that represents that day on the calendar.
 *  When a day has several, the one with a mood wins, then the newest —
 *  the calendar shows a day's mood, so a rated entry is the truer answer. */
export function byDay() {
  const map = new Map();
  for (const e of entries) {
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

export function remove(id) {
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) return false;
  entries.splice(i, 1);
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
    remove(id);
    return true;
  }
  return false;
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
    const existing = get(incoming.id);
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
