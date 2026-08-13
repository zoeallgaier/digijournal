/* ============================================================================
   mood.js — the day's rating, as a card.

   Five faces, each named under itself. A radiogroup, so it is one tab stop
   and the arrow keys move the selection — the pattern a rating control is
   supposed to follow.

   IT RATES A DAY, NOT AN ENTRY. It lived on the entry screen until the two
   were separated: rating a day you never wrote about meant leaving a blank
   draft behind to hold the rating, and writing twice on one day meant two
   moods and a tiebreak. The card asks the day, the day answers, and whether
   anything was written that day is a different question. See store.js.

   It sits on the list, above the journal, and it is about today alone. A day
   you missed is rated by not being rated — going back to colour in last
   Tuesday is bookkeeping, not journalling, and the calendar is a record
   rather than a form.

   The card carries its own heading and its own answers, so nothing in it
   changes as you choose: the prompt is a heading, not a readout, and which
   day it was is carried by the face that fills.
   ========================================================================= */

import { el, icon } from './ui.js';
import * as store from './store.js';
import { MOODS } from './store.js';

let seq = 0;

/** The card for one day, live: it repaints itself when the rating changes
 *  under it, so a rating arriving from the iPad lands on the list without the
 *  screen being rebuilt. Returns { node, repaint }. */
export function card(day) {
  const id = `mood-prompt-${++seq}`;
  const prompt = el('p.mood-prompt', { id }, 'Rate the day');
  const row = el('div.mood-row');
  const group = el('div.mood.glass', {
    role: 'radiogroup',
    'aria-labelledby': id,
  });

  const buttons = MOODS.map(({ value, label }) =>
    el('button.mood-opt', {
      type: 'button',
      role: 'radio',
      'data-mood': value,
      'aria-label': `${label} (${value} of 5)`,
      onclick: () => set(value === current() ? null : value),
    },
      el('span.mood-face', icon(`mood-${value}`)),
      el('span.mood-name', label),
    )
  );

  row.append(...buttons);
  group.append(prompt, row);

  function current() {
    return store.rating(day);
  }

  function repaint() {
    const mood = current();
    buttons.forEach((btn, i) => {
      const checked = MOODS[i].value === mood;
      btn.setAttribute('aria-checked', String(checked));
      /* Roving tabindex: the group is one stop, arrows move within it. When
         nothing is chosen the first circle takes the tab stop. */
      btn.tabIndex = checked || (mood === null && i === 0) ? 0 : -1;
    });
  }

  function set(value, { focus = false } = {}) {
    store.setRating(value, day);
    repaint();
    if (focus) {
      const i = MOODS.findIndex((m) => m.value === value);
      buttons[i >= 0 ? i : 0].focus();
    }
  }

  group.addEventListener('keydown', (e) => {
    const mood = current();
    const i = mood === null ? -1 : MOODS.findIndex((m) => m.value === mood);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(MOODS[Math.min(i + 1, MOODS.length - 1)].value, { focus: true });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      set(MOODS[Math.max(i - 1, 0)].value, { focus: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      set(MOODS[0].value, { focus: true });
    } else if (e.key === 'End') {
      e.preventDefault();
      set(MOODS[MOODS.length - 1].value, { focus: true });
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      set(null);
      buttons[0].focus();
    }
  });

  repaint();
  return { node: group, repaint };
}
