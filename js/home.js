/* ============================================================================
   home.js — today's rating, then the list of entries.

   One column, newest edit first, rows divided by hairlines. Each row is a
   title, two lines of the body, and the date it was last edited. A dot beside
   that date carries how that ENTRY'S DAY was rated — the day's colour, not
   the entry's, which is why two entries written on one day wear the same one.
   It sits with the date because that is the line about WHEN, which is what a
   day's rating is about; on the title line it read as a mark on the writing.

   Above the list is the rating card, and it rates today. It is the one thing
   on this screen that is not about an entry, and the reason it is here rather
   than on the entry screen is that a day is worth rating whether or not you
   wrote anything. See mood.js.
   ========================================================================= */

import { el, shortDate, excerpt } from './ui.js';
import * as store from './store.js';
import { moodLabel } from './store.js';
import { card } from './mood.js';

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

function row(entry, go, mood) {
  const untitled = !entry.title.trim() && !entry.body.trim();
  const preview = displayPreview(entry);

  return el('button.entry-row', {
    type: 'button',
    onclick: () => go(`#/e/${entry.id}`),
  },
    el('div.entry-row-top',
      el('span.entry-title', { 'data-untitled': untitled ? 'true' : null }, displayTitle(entry)),
    ),
    preview && el('p.entry-preview', preview),
    el('div.entry-meta',
      mood !== null && el('span.mood-dot', { 'data-mood': mood, 'aria-hidden': 'true' }),
      el('span', shortDate(entry.updatedAt)),
      !entry.published && el('span.entry-flag', 'Draft'),
      /* The dot above is colour only — this is the same fact in words, for
         a screen reader and for anyone who can't tell the hues apart. It says
         whose rating it is, because it is the day's and not this entry's. */
      mood !== null && el('span.sr-only', `That day: ${moodLabel(mood)}`),
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
  const ratings = store.ratingsByDay();

  /* Which day the card is rating, fixed at render. */
  const today = store.dayKey();
  const rating = card(today);

  /* Two things can happen while this screen sits open behind a locked phone:
     midnight, and a rating arriving from another device. The first makes the
     card the wrong day's, which no repaint can fix — the screen has to be
     built again. The second only needs the faces redrawn, and redrawing them
     costs nothing, so it is not worth telling the two apart. */
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (store.dayKey() !== today) api.go('#/', { replace: true });
    else rating.repaint();
  };
  document.addEventListener('visibilitychange', onVisible);

  const node = el('div.screen-inner',
    el('header.home-head',
      el('h1.home-title', 'Digijournal'),
      entries.length ? el('p.home-sub', subtitle(entries)) : null,
    ),
    rating.node,
    entries.length
      ? el('div.entry-list', { role: 'list' },
          entries.map((entry) => el('div', { role: 'listitem' },
            row(entry, api.go, ratings.get(entry.day) ?? null))))
      /* The invitation the composer used to be. "Start writing…" was a
         field-shaped button spanning the bar, which said "begin here"
         without having to; the quill that replaced it is a tool, and a tool
         is a poor greeting for a journal with nothing in it. So the
         invitation moved to the one screen that has room for it and nothing
         else to say. It calls the same thing the quill does, in the same
         tap, for the same reason — see api.compose. */
      : el('div.empty',
          el('h2', 'Nothing written yet'),
          el('p', 'A day is worth writing down even when nothing happened.'),
          el('button.empty-btn', { type: 'button', onclick: api.compose },
            'Write the first entry'),
        ),
  );

  return {
    node,
    title: 'Journal',
    bar: 'nav',
    /* Nothing in the toolbar. The gear that used to sit here was Settings'
       only door in the whole app; it is a tab in the bar now, reachable from
       every screen rather than from this one. */
    onLeave() {
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
