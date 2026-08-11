/* ============================================================================
   home.js — the list of entries.

   One column, newest edit first, rows divided by hairlines. Each row is a
   title, two lines of the body, and the date it was last edited. A mood, if
   the day was rated, sits as a dot on the title line.
   ========================================================================= */

import { el, iconButton, shortDate, excerpt } from './ui.js';
import * as store from './store.js';
import { moodLabel } from './store.js';

/** Apple Notes' rule, which is the right one: if you never typed a title,
 *  the first line of what you wrote is the title. */
export function displayTitle(entry) {
  const title = entry.title.trim();
  if (title) return title;
  const firstLine = entry.body.trim().split('\n')[0].trim();
  if (firstLine) return excerpt(firstLine, 60);
  return 'Untitled';
}

/** …and in that case the preview starts after that first line, so the row
 *  doesn't say the same thing twice. */
function displayPreview(entry) {
  const body = entry.body.trim();
  if (entry.title.trim()) return excerpt(body);
  const rest = body.split('\n').slice(1).join(' ');
  return excerpt(rest);
}

function row(entry, go) {
  const untitled = !entry.title.trim() && !entry.body.trim();
  const preview = displayPreview(entry);

  return el('button.entry-row', {
    type: 'button',
    onclick: () => go(`#/e/${entry.id}`),
  },
    el('div.entry-row-top',
      el('span.entry-title', { 'data-untitled': untitled ? 'true' : null }, displayTitle(entry)),
      entry.mood !== null && el('span.mood-dot', { 'data-mood': entry.mood, 'aria-hidden': 'true' }),
    ),
    preview && el('p.entry-preview', preview),
    el('div.entry-meta',
      el('span', shortDate(entry.updatedAt)),
      !entry.published && el('span.entry-flag', 'Draft'),
      /* The dot above is colour only — this is the same fact in words, for
         a screen reader and for anyone who can't tell the hues apart. */
      entry.mood !== null && el('span.sr-only', `Mood: ${moodLabel(entry.mood)}`),
    ),
  );
}

function subtitle(entries) {
  if (!entries.length) return '';
  /* Local month, not UTC — toISOString() would call the evening of the 31st
     "next month" anywhere west of Greenwich. */
  const thisMonth = store.dayKey().slice(0, 7);
  const n = entries.filter((e) => e.day.startsWith(thisMonth)).length;
  const total = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  return n ? `${total} · ${n} this month` : total;
}

export function view(_params, api) {
  const entries = store.all();

  const node = el('div.screen-inner',
    el('header.home-head',
      el('h1.home-title', 'Journal'),
      entries.length ? el('p.home-sub', subtitle(entries)) : null,
    ),
    entries.length
      ? el('div.entry-list', { role: 'list' },
          entries.map((entry) => el('div', { role: 'listitem' }, row(entry, api.go))))
      : el('div.empty',
          el('h2', 'Nothing written yet'),
          el('p', 'Tap Start writing to make the first entry.'),
        ),
  );

  return {
    node,
    title: 'Journal',
    bar: 'compose',
    toolbarRight: iconButton('more', 'Journal actions', api.openMenu),
  };
}
