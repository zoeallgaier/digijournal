/* ============================================================================
   home.js — the list of entries.

   One column, newest edit first, rows divided by hairlines. Each row is a
   title, two lines of the body, and the date it was last edited. A mood, if
   the day was rated, sits as a dot on the title line.
   ========================================================================= */

import { el, iconButton, shortDate, excerpt } from './ui.js';
import * as store from './store.js';
import { moodLabel } from './store.js';
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

  /* Repaint the gear when a round finishes, so its label is never describing
     a sync that ended five minutes ago. */
  const onSync = () => api.refreshToolbar();
  window.addEventListener('dj:sync', onSync);

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
    },
  };
}
