/* ============================================================================
   ui.js — the shared vocabulary: element building, icons, dates, toast, menu.
   If two screens need the same thing, it lives here.
   ========================================================================= */

/* ------------------------------------------------------------------- el() */

/** el('button.compose', { 'aria-label': 'Write' }, 'Start writing…')
 *  Tag defaults to div. `.class` and `#id` in the selector. Children may be
 *  nodes, strings, or nested arrays; null and false are skipped so callers
 *  can write `cond && el(...)` inline. */
export function el(sel, attrs, ...children) {
  /* Parsed by pattern rather than by splitting, so #id and .class may appear
     in either order — 'p.entry-date#today' and 'p#today.entry-date' both mean
     the same thing. */
  const s = String(sel);
  const tag = (s.match(/^[a-zA-Z][\w-]*/) || ['div'])[0];
  const id = (s.match(/#([\w-]+)/) || [])[1];
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);

  const node = document.createElement(tag);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/* ------------------------------------------------------------------ icons
   Stroked, 24px grid, round caps — the SF Symbols idiom without shipping a
   font. `d` is one or more path commands. */

const PATHS = {
  calendar: ['M7 3v3M17 3v3', 'M4 8h16', 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  pencil:   ['M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z', 'M14.5 6.5l3 3'],
  back:     ['M15 5l-7 7 7 7'],
  prev:     ['M14 5l-7 7 7 7'],
  next:     ['M10 5l7 7-7 7'],
  go:       ['M5 12h13', 'M12 6l6 6-6 6'],
  trash:    ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13'],
  check:    ['M5 12.5l4.5 4.5L19 7.5'],

  /* The list's one control. It was a cloud while sync was the only thing
     behind it; it is a gear now that the palette is there too — a door to
     everything about the app that is not an entry.

     Eight teeth on the same 4–20 band as the icons beside it, generated
     rather than drawn: tips on a 8.35 circle, roots on a 6, so the arcs
     between them are true and the whole mark stays concentric with the 44px
     capsule it sits in. */
  settings: [
    'M10.3 6.25L10.55 3.78A8.35 8.35 0 0 1 13.45 3.78L13.7 6.25A6 6 0 0 1 14.86 6.73L16.79 5.16A8.35 8.35 0 0 1 18.84 7.21L17.27 9.14A6 6 0 0 1 17.75 10.3L20.22 10.55A8.35 8.35 0 0 1 20.22 13.45L17.75 13.7A6 6 0 0 1 17.27 14.86L18.84 16.79A8.35 8.35 0 0 1 16.79 18.84L14.86 17.27A6 6 0 0 1 13.7 17.75L13.45 20.22A8.35 8.35 0 0 1 10.55 20.22L10.3 17.75A6 6 0 0 1 9.14 17.27L7.21 18.84A8.35 8.35 0 0 1 5.16 16.79L6.73 14.86A6 6 0 0 1 6.25 13.7L3.78 13.45A8.35 8.35 0 0 1 3.78 10.55L6.25 10.3A6 6 0 0 1 6.73 9.14L5.16 7.21A8.35 8.35 0 0 1 7.21 5.16L9.14 6.73A6 6 0 0 1 10.3 6.25Z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  ],

  /* The five day ratings. No outer circle — the thumb or the fill behind the
     glyph is the face. Two dots and a mouth, and only the mouth changes: at
     28px an eye that also changes reads as noise, and the mouth is what
     carries a five-step ramp legibly. Drawn on the same 24 grid as
     everything else, so a face lines up with the icons it sits under.

     THE EYES ARE THE FIRST TWO PATHS OF EACH, and app.css strokes them
     heavier than the mouth by exactly that position (`:nth-child(-n + 2)`).
     They are zero-length round caps, so their stroke weight is their
     diameter. Keep them first if these are ever redrawn.

     They were drawn as short vertical lines once, on 13 Aug 2026, and put
     back the same day: at this size a line reads as a squint where a dot
     reads as an eye. Do not try it again. */
  'mood-1': ['M8.6 9.9h.01', 'M15.4 9.9h.01', 'M6.9 17Q12 12.6 17.1 17'],
  'mood-2': ['M8.6 9.9h.01', 'M15.4 9.9h.01', 'M6.9 16.4Q12 14 17.1 16.4'],
  'mood-3': ['M8.6 9.9h.01', 'M15.4 9.9h.01', 'M6.9 15.4h10.2'],
  'mood-4': ['M8.6 9.9h.01', 'M15.4 9.9h.01', 'M6.9 14.4Q12 16.8 17.1 14.4'],
  'mood-5': ['M8.6 9.9h.01', 'M15.4 9.9h.01', 'M6.9 13.8Q12 18.2 17.1 13.8'],
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** An icon-only button always needs a name for anyone not looking at it. */
export function iconButton(name, label, onClick, extra = {}) {
  return el('button.icon-btn', { type: 'button', 'aria-label': label, onclick: onClick, ...extra }, icon(name));
}

/* ------------------------------------------------------------------ dates */

const f = (opts) => new Intl.DateTimeFormat(undefined, opts);
const timeFmt      = f({ hour: 'numeric', minute: '2-digit' });
const dayMonthFmt  = f({ month: 'long', day: 'numeric' });
const fullFmt      = f({ month: 'long', day: 'numeric', year: 'numeric' });
const weekdayFmt   = f({ weekday: 'long' });
const monthYearFmt = f({ month: 'long', year: 'numeric' });

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

/** The compact date on a list row: recent days get a word, this year gets a
 *  day and month, anything older gets the year too. */
export function shortDate(ts) {
  const d = new Date(ts);
  const diff = daysBetween(new Date(), d);
  if (diff === 0) return timeFmt.format(d);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return weekdayFmt.format(d);
  if (d.getFullYear() === new Date().getFullYear()) return dayMonthFmt.format(d);
  return fullFmt.format(d);
}

/** The full date under an entry's title. */
export function longDate(ts) {
  const d = new Date(ts);
  const diff = daysBetween(new Date(), d);
  const when =
    diff === 0 ? 'Today' :
    diff === 1 ? 'Yesterday' :
    d.getFullYear() === new Date().getFullYear() ? dayMonthFmt.format(d) : fullFmt.format(d);
  return `${when} at ${timeFmt.format(d)}`;
}

export function monthYear(date) {
  return monthYearFmt.format(date);
}

/** First words of the body, whitespace collapsed, for the list preview. */
export function excerpt(text, max = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

/* ------------------------------------------------------------------ toast
   One at a time, announced politely so it reaches VoiceOver without
   interrupting whatever is being read. */

let toastNode = null;
let toastTimer = null;

export function toast(message, ms = 2400) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;

  clearTimeout(toastTimer);
  if (toastNode) toastNode.remove();

  toastNode = el('div.toast.glass', { role: 'status' }, message);
  document.body.append(toastNode);

  toastTimer = setTimeout(() => {
    if (!toastNode) return;
    toastNode.dataset.leaving = 'true';
    const node = toastNode;
    toastNode = null;
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/* ------------------------------------------------------------------- menu
   A bottom action sheet. Items: { label, icon, tone, onSelect }.
   Focus is trapped while it is open and returned to the opener on close —
   without that, dismissing the sheet drops a keyboard user at the top of
   the document.

   Nothing routine opens one. The app's only sheet is the second tap on
   Delete — everything else is a control you can already see. */

export function menu(items, { label = 'Actions' } = {}) {
  const opener = document.activeElement;
  const scrim = el('div.menu-scrim', { onclick: () => close() });
  /* Not .glass — see the note on .menu in app.css. */
  const sheet = el('div.menu', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label });

  for (const item of items) {
    if (item === '-') { sheet.append(el('div.menu-sep', { 'aria-hidden': 'true' })); continue; }
    sheet.append(
      el('button.menu-item', {
        type: 'button',
        'data-tone': item.tone || null,
        onclick: () => { close(); item.onSelect(); },
      }, item.icon ? icon(item.icon) : null, el('span', item.label))
    );
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...sheet.querySelectorAll('button')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    sheet.remove();
    if (opener && opener.isConnected) opener.focus();
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim, sheet);
  sheet.querySelector('button')?.focus();
  return close;
}

/** A destructive confirmation, as a menu — iOS asks for the second tap in a
 *  sheet, not a modal with two equal buttons. */
export function confirmDestructive(label, onConfirm) {
  menu([{ label, icon: 'trash', tone: 'danger', onSelect: onConfirm }], { label });
}
