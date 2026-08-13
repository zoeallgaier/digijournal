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

import { el, iconButton, shortDate, excerpt } from './ui.js';
import * as store from './store.js';
import { moodLabel } from './store.js';
import { card } from './mood.js';
import * as sync from './sync.js';

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

/* One control, so its name carries everything behind it — and the sync state
   has to reach someone who can't see the icon's tone, so that is in the name
   rather than only in the colour. */
function settingsLabel(status) {
  if (status === 'off')     return 'Settings — not signed in';
  if (status === 'syncing') return 'Settings — syncing now';
  if (status === 'offline') return 'Settings — no connection';
  if (status === 'error')   return 'Settings — sync needs attention';
  return 'Settings — sync up to date';
}

export function view(_params, api) {
  const entries = store.all();
  const ratings = store.ratingsByDay();

  /* Which day the card is rating, fixed at render. */
  const today = store.dayKey();
  const rating = card(today);

  /* Repaint the gear when a round finishes, so its label is never describing
     a sync that ended five minutes ago. */
  const onSync = () => api.refreshToolbar();
  window.addEventListener('dj:sync', onSync);

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
      el('h1.home-title', 'Journal'),
      entries.length ? el('p.home-sub', subtitle(entries)) : null,
    ),
    rating.node,
    entries.length
      ? el('div.entry-list', { role: 'list' },
          entries.map((entry) => el('div', { role: 'listitem' },
            row(entry, api.go, ratings.get(entry.day) ?? null))))
      : el('div.empty',
          el('h2', 'Nothing written yet'),
          el('p', 'Tap Start writing to make the first entry.'),
        ),
  );

  return {
    node,
    title: 'Journal',
    bar: 'compose',
    /* The list's one control, and it is a door rather than an action: it goes
       to Settings, where the palette and the account both live. Everything
       you can do TO the journal is still a tap on a row or the composer —
       this is the only thing in the app that is about the app rather than
       about an entry, so it is the only thing that earned a place up here.
       It carries a tone only when something needs looking at; the rest of the
       time it is as quiet as the empty toolbar it replaced. */
    get toolbarRight() {
      const { status } = sync.state();
      return iconButton('settings', settingsLabel(status), () => api.go('#/settings'),
        status === 'error' ? { 'data-tone': 'danger' } : {});
    },
    onLeave() {
      window.removeEventListener('dj:sync', onSync);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
