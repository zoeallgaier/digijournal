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
     in either order — 'p.gate-error#gate-error' and 'p#gate-error.gate-error'
     both mean the same thing. */
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
  more:     ['M6 12h.01M12 12h.01M18 12h.01'],
  trash:    ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13'],
  export:   ['M12 15V4', 'M8 8l4-4 4 4', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  import:   ['M12 4v11', 'M8 11l4 4 4-4', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  lock:     ['M7 10V7a5 5 0 0 1 10 0v3', 'M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'],
  close:    ['M6 6l12 12M18 6L6 18'],
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
   the document. */

export function menu(items, { label = 'Actions' } = {}) {
  const opener = document.activeElement;
  const scrim = el('div.menu-scrim', { onclick: () => close() });
  const sheet = el('div.menu.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label });

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
