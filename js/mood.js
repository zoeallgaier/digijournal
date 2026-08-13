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

   THE PROMPT IS A SENTENCE THE RATING FINISHES. "Today I feel —" and then
   the word, on its own line, in the day's colour. It was a bare question
   until 13 Aug 2026; naming the rating in words is the second channel the
   colour is never allowed to be alone on, said out loud instead of hidden
   under five faces. The card still answers in colour too — `data-mood` on
   the group is the day's colour, and the pane wears it. See the mood block
   in app.css for why the colour is on the card and not on five faces.

   IT IS ONE LINE. The word was given its own line for about ten minutes and
   was wrong: a break turns something said into a heading. The span exists to
   hold the answer, not to break it.

   IT IS A SLIDER OVER A RADIOGROUP, and it is both on purpose. The thing you
   touch is a track with a thumb that follows your finger across five stops —
   which is what a rating on a phone should feel like, and what tapping five
   separate circles never did. Underneath it is still five real `role=radio`
   buttons: that is what gives it arrow keys, a roving tabindex, five names a
   screen reader can read, and five 44pt targets for anyone who would rather
   tap than drag.

   The drag is therefore the ONLY thing this file adds. It reads a pointer's
   x, works out which of the five columns it is over, and calls the same
   `set()` a tap calls. There is no separate drag state to keep in step with
   the selection, and nothing about the thumb's position lives in JS — CSS
   moves it from `data-mood`, because the position is a fact about the rating
   and the rating is already on the card. See the note on the thumb in
   app.css.
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
  /* Two nodes, not one string: the lead-in never changes, and the word does.
     The word carries its own leading space, because the unrated ellipsis
     must close up against "feel" — "Today I feel…" trails off, "Today I
     feel …" is a typo. One line either way. */
  const said = el('span.mood-said');
  const prompt = el('p.mood-prompt', { id }, 'Today I feel', said);
  /* The thumb is a sibling of the five, not a child of one: it slides
     between them, so it cannot belong to any of them. First in the track so
     tree order paints it under the faces. */
  const thumb = el('span.mood-thumb', { 'aria-hidden': 'true' });
  const row = el('div.mood-row');
  /* Not .glass any more. A pane filled edge to edge with its own colour has
     nothing behind it to refract, and the glass tint over it only greyed
     the mood down — the same reason the action sheet is a card and not
     glass. See the house note on it. */
  const group = el('div.mood', {
    role: 'radiogroup',
    'aria-labelledby': id,
  });

  const buttons = MOODS.map(({ value, label }) =>
    el('button.mood-opt', {
      type: 'button',
      role: 'radio',
      'data-mood': value,
      onclick: () => {
        if (claimed) return;   /* a pointer gesture already answered this */
        set(value === current() ? null : value);
      },
    },
      el('span.mood-face', icon(`mood-${value}`)),
      /* The name is the button's accessible name and the second channel the
         colour is never allowed to be alone. It is hidden rather than
         removed: the faces carry it visually, and five words under five
         circles is the row the card stopped being. */
      el('span.mood-name.sr-only', label),
    )
  );

  row.append(thumb, ...buttons);
  group.append(prompt, row);

  function current() {
    return store.rating(day);
  }

  function repaint() {
    const mood = current();
    /* The card wears the rating. Everything coloured on it — the wash behind
       the type, the fill in the chosen swatch, the glow under it — is an
       alpha of one custom property that this attribute switches, so the day
       has ONE colour rather than five options having one each. Absent when
       nothing is rated, which is what CSS falls back to the ink on. */
    if (mood === null) group.removeAttribute('data-mood');
    else group.dataset.mood = String(mood);

    /* The sentence finishes itself. Lower-cased, because it is a word in a
       sentence here and a name on a control in `MOODS` — the same string
       doing two jobs, and only one of them capitalises. */
    said.textContent = mood === null ? '…' : ` ${store.moodLabel(mood).toLowerCase()}`;

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

  /* --- the drag ---------------------------------------------------------
     Which of the five a point is over. Measured from the first and last
     BUTTONS rather than from the track, because the track is padded and the
     buttons are not — measuring the padded box puts every boundary a few
     pixels off, and the face under your finger stops being the one that
     lights up. The columns are equal, so this is arithmetic rather than a
     hit test, and it keeps answering past either end: a finger dragged off
     the edge of the card holds the last face rather than stopping. */
  function moodAt(clientX) {
    const first = buttons[0].getBoundingClientRect();
    const last = buttons[buttons.length - 1].getBoundingClientRect();
    const width = last.right - first.left;
    if (!width) return null;   /* not laid out yet — nothing to point at */
    const i = Math.floor(((clientX - first.left) / width) * MOODS.length);
    return MOODS[Math.min(MOODS.length - 1, Math.max(0, i))].value;
  }

  /* A pointer gesture and the click that follows it would otherwise both
     act, and the second would undo the first: press face 4 on an unrated
     day and the press selects it, then the click sees 4 already chosen and
     toggles it straight back off. So a gesture CLAIMS its click. What is
     left for the click handler is every click that did not come from one —
     the keyboard's, and the suite's .click(). */
  let claimed = false;   /* a pointer gesture handled this click already   */
  let moved = false;     /* …and it was a drag rather than a tap          */
  let pressedOn = null;  /* the rating at the moment the finger went down */

  row.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    claimed = true;
    moved = false;
    pressedOn = current();
    /* Capture on the TRACK, so the whole gesture keeps arriving here once
       the finger leaves whichever button it started on. Without it the
       first face swallows the drag and nothing moves. */
    row.setPointerCapture(e.pointerId);
    const value = moodAt(e.clientX);
    /* The thumb goes under the finger immediately. Clearing is not done
       here — pressing the one already chosen has to be allowed to become a
       drag, so it is only a clear if the finger never moves. */
    if (value !== null && value !== current()) set(value);
  });

  row.addEventListener('pointermove', (e) => {
    if (!row.hasPointerCapture(e.pointerId)) return;
    /* preventDefault so a drag across the card does not scroll the list
       under it. touch-action in app.css is what stops the scroll from
       starting at all; this stops the rest. */
    e.preventDefault();
    const value = moodAt(e.clientX);
    if (value !== null && value !== current()) {
      moved = true;
      set(value);
    }
  });

  row.addEventListener('pointerup', (e) => {
    if (row.hasPointerCapture(e.pointerId)) row.releasePointerCapture(e.pointerId);
    /* A tap on the rating the day already had clears it — the same toggle
       tapping has always done. A drag that ends where it started does not:
       it moved, so it was an adjustment, not a second tap. */
    if (!moved && pressedOn !== null && moodAt(e.clientX) === pressedOn) set(null);
  });

  row.addEventListener('pointercancel', (e) => {
    if (row.hasPointerCapture(e.pointerId)) row.releasePointerCapture(e.pointerId);
    claimed = false;   /* no click will follow a cancel to release it */
  });

  /* Bubbles, so it runs after whichever button's own handler did or did not
     fire — and it runs even when the gesture began and ended on different
     faces, where the click lands on the track rather than on a button. That
     is what keeps the flag from swallowing the NEXT click. */
  row.addEventListener('click', () => { claimed = false; });

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
