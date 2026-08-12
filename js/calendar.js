/* ============================================================================
   calendar.js — the month, coloured by mood.

   The point of this screen is the shape of a month seen at once: whether the
   warm days cluster, whether a stretch went cool. So the mood fills the whole
   day cell rather than sitting in it as a dot — at arm's length the grid
   reads as a temperature map, and up close the numeral is still there.

   Days are plotted by `entry.day`, the day the entry is about, which does not
   move when the entry is edited later. See store.js.
   ========================================================================= */

import { el, iconButton, monthYear } from './ui.js';
import * as store from './store.js';
import { MOODS, moodLabel, dayKey } from './store.js';

/* Locale-correct single letters, Sunday first. 7 Jan 2024 was a Sunday. */
const WEEKDAYS = (() => {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  const long = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 7 + i);
    return { narrow: fmt.format(d), long: long.format(d) };
  });
})();

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });

function parseMonth(param) {
  const m = /^(\d{4})-(\d{2})$/.exec(param || '');
  const now = new Date();
  if (!m) return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

function monthParam(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function view(params, api) {
  const month = parseMonth(params.month);
  const byDay = store.byDay();
  const today = dayKey();

  const year = month.getFullYear();
  const mIndex = month.getMonth();
  const firstWeekday = new Date(year, mIndex, 1).getDay();
  const daysInMonth = new Date(year, mIndex + 1, 0).getDate();

  /* ---------------------------------------------------------------- grid */

  const grid = el('div.cal-grid', { role: 'grid', 'aria-label': monthYear(month) });

  for (let i = 0; i < firstWeekday; i++) {
    grid.append(el('div.cal-day', { 'data-empty': 'true', 'aria-hidden': 'true' }));
  }

  const monthEntries = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(mIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entry = byDay.get(key) || null;
    const isToday = key === today;
    const isFuture = key > today;
    if (entry) monthEntries.push(entry);

    const label = [
      dayFmt.format(new Date(year, mIndex, d)),
      isToday ? 'today' : null,
      entry ? moodLabel(entry.mood).toLowerCase() : null,
      entry ? 'written' : isFuture ? null : 'nothing written',
    ].filter(Boolean).join(', ');

    grid.append(el('button.cal-day', {
      type: 'button',
      role: 'gridcell',
      'data-mood': entry && entry.mood !== null ? entry.mood : null,
      'data-written': entry ? 'true' : null,
      'data-today': isToday ? 'true' : null,
      'aria-label': label,
      'aria-disabled': isFuture ? 'true' : null,
      disabled: isFuture,
      onclick: () => {
        if (entry) { api.go(`#/e/${entry.id}`); return; }
        /* An empty day is an invitation: start an entry dated to it, so a
           day missed on Tuesday can still be written on Wednesday. */
        const created = store.create(key);
        api.go(`#/e/${created.id}`);
      },
    }, String(d)));
  }

  /* --------------------------------------------------------------- stats */

  const rated = monthEntries.filter((e) => e.mood !== null);
  const average = rated.length
    ? (rated.reduce((sum, e) => sum + e.mood, 0) / rated.length)
    : null;

  const stats = el('div.cal-stats',
    el('div',
      el('div.cal-stat-n', String(monthEntries.length)),
      el('div.cal-stat-l', monthEntries.length === 1 ? 'day written' : 'days written'),
    ),
    average !== null && el('div',
      el('div.cal-stat-n', average.toFixed(1)),
      el('div.cal-stat-l', 'average mood'),
    ),
  );

  /* ----------------------------------------------------------------- key */

  const key = el('div.cal-key', { 'aria-hidden': 'true' },
    MOODS.map(({ value, label }) =>
      el('div.cal-key-item',
        el('span.mood-dot', { 'data-mood': value }),
        label,
      )),
  );

  /* ------------------------------------------------------------- header */

  const step = (delta) => {
    const next = new Date(year, mIndex + delta, 1);
    api.go(`#/calendar/${monthParam(next)}`, { replace: true });
  };

  /* Don't offer a month that hasn't happened. */
  const now = new Date();
  const atCurrentMonth = year === now.getFullYear() && mIndex === now.getMonth();

  const node = el('div.screen-inner',
    el('header.cal-head',
      el('h1.cal-month', monthYear(month)),
      iconButton('prev', 'Previous month', () => step(-1)),
      /* Dimming a disabled control is the stylesheet's business — see
         .icon-btn:disabled. */
      iconButton('next', 'Next month', () => step(1), {
        disabled: atCurrentMonth ? true : null,
        'aria-disabled': atCurrentMonth ? 'true' : null,
      }),
    ),
    el('div.cal-weekdays', { 'aria-hidden': 'true' },
      WEEKDAYS.map((w) => el('div.cal-weekday', w.narrow))),
    grid,
    stats,
    key,
  );

  node.addEventListener('keydown', (e) => {
    if (e.target.closest('.cal-day')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight' && !atCurrentMonth) { e.preventDefault(); step(1); }
  });

  return {
    node,
    title: monthYear(month),
    bar: 'compose',
    /* No back button up here: the calendar capsule in the composer bar is
       the way out, and two ways back would be one too many. */
  };
}
