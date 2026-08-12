/* ============================================================================
   entry.js — one entry: reading it, writing it, rating the day.

   THE SUBTLE PART. Reading and editing are not two screens. They are one
   screen with the fields switched between `readonly` and not.

   The reason is that a textarea and a paragraph of the same text never wrap
   identically — swap one for the other and every line moves a hair, which on
   a phone reads as the page flinching each time you tap edit. Keeping the
   same two textareas mounted means entering edit mode moves nothing at all;
   the caret simply appears. `readonly` (not `disabled`) is what makes it
   work: iOS raises no keyboard for a readonly field, the text stays
   selectable, and the field keeps its colours.

   Everything is saved as you type — there is no unsaved state to lose.
   "Publish" only moves a draft into the list; it is not the save.
   ========================================================================= */

import { el, iconButton, longDate, toast, confirmDestructive } from './ui.js';
import * as store from './store.js';
import { MOODS, moodLabel } from './store.js';

const SAVE_DEBOUNCE = 400;

/** Grow a textarea to fit its content. The fields must never scroll
 *  internally — the page is the scroller, so the composer bar and the
 *  keyboard behave. */
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

export function view(params, api) {
  const entry = store.get(params.id);

  if (!entry) {
    return {
      node: el('div.screen-inner',
        el('div.empty',
          el('h2', 'Entry not found'),
          el('p', 'It may have been deleted.'),
        )),
      title: '',
      bar: 'hidden',
      toolbarLeft: iconButton('back', 'Back', () => api.go('#/')),
    };
  }

  /* Read mode unless this is a draft that was never published — walking into
     an empty draft should put the caret where you left it. */
  let editing = !entry.published;
  let saveTimer = null;

  /* ------------------------------------------------------------- fields */

  const titleField = el('textarea.entry-title-field', {
    rows: '1',
    placeholder: 'Title',
    'aria-label': 'Title',
    spellcheck: 'true',
    enterkeyhint: 'next',
  });
  titleField.value = entry.title;

  const bodyField = el('textarea.entry-body-field', {
    rows: '1',
    placeholder: 'Write about your day…',
    'aria-label': 'Entry',
    spellcheck: 'true',
  });
  bodyField.value = entry.body;

  const dateLine = el('p.entry-date');

  function refreshDate() {
    const current = store.get(entry.id);
    if (!current) return;
    dateLine.textContent = current.published
      ? `Edited ${longDate(current.updatedAt)}`
      : `Draft · ${longDate(current.updatedAt)}`;
  }

  /* --------------------------------------------------------------- save */

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const current = store.get(entry.id);
    if (!current) return;
    if (current.title === titleField.value && current.body === bodyField.value) return;
    store.update(entry.id, { title: titleField.value, body: bodyField.value });
    refreshDate();
    api.refreshBar();
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE);
  }

  for (const field of [titleField, bodyField]) {
    field.addEventListener('input', () => {
      autoGrow(field);
      queueSave();
    });
  }

  /* Enter in the title goes to the body — a title is one line. */
  titleField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bodyField.focus();
    }
  });

  /* Tapping the text while reading is the other way into edit mode, and the
     one people reach for before they find the pencil. */
  for (const field of [titleField, bodyField]) {
    field.addEventListener('click', () => { if (!editing) setEditing(true, field); });
  }

  /* --------------------------------------------------------------- mood */

  const moodValue = el('span.mood-label');
  const moodGroup = el('div.mood', {
    role: 'radiogroup',
    'aria-label': 'How the day felt',
  });

  const moodButtons = MOODS.map(({ value, label }) =>
    el('button.mood-opt', {
      type: 'button',
      role: 'radio',
      'data-mood': value,
      'aria-label': `${label} (${value} of 5)`,
      onclick: () => setMood(value === currentMood() ? null : value),
    })
  );

  moodGroup.append(...moodButtons, moodValue);

  function currentMood() {
    return store.get(entry.id)?.mood ?? null;
  }

  function paintMood() {
    const mood = currentMood();
    moodButtons.forEach((btn, i) => {
      const checked = MOODS[i].value === mood;
      btn.setAttribute('aria-checked', String(checked));
      /* Roving tabindex: the group is one stop, arrows move within it. When
         nothing is chosen the first circle takes the tab stop. */
      btn.tabIndex = checked || (mood === null && i === 0) ? 0 : -1;
    });
    moodValue.textContent = mood === null ? 'Rate the day' : moodLabel(mood);
  }

  function setMood(value, { focus = false } = {}) {
    store.update(entry.id, { mood: value });
    paintMood();
    refreshDate();
    if (focus) {
      const i = MOODS.findIndex((m) => m.value === value);
      moodButtons[i >= 0 ? i : 0].focus();
    }
  }

  moodGroup.addEventListener('keydown', (e) => {
    const mood = currentMood();
    const i = mood === null ? -1 : MOODS.findIndex((m) => m.value === mood);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setMood(MOODS[Math.min(i + 1, MOODS.length - 1)].value, { focus: true });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setMood(MOODS[Math.max(i - 1, 0)].value, { focus: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setMood(MOODS[0].value, { focus: true });
    } else if (e.key === 'End') {
      e.preventDefault();
      setMood(MOODS[MOODS.length - 1].value, { focus: true });
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      setMood(null);
      moodButtons[0].focus();
    }
  });

  /* --------------------------------------------------------------- mode */

  function setEditing(on, focusField) {
    editing = on;
    titleField.readOnly = !on;
    bodyField.readOnly = !on;

    if (on) {
      const target = focusField || (titleField.value ? bodyField : titleField);
      target.focus();
      /* Land the caret at the end rather than wherever the tap fell when we
         were the one who decided to focus. */
      if (!focusField) target.setSelectionRange(target.value.length, target.value.length);
    } else {
      flush();
      titleField.blur();
      bodyField.blur();
    }
    api.refreshBar();
    api.refreshToolbar();
  }

  /* ------------------------------------------------------------- delete */

  function del() {
    confirmDestructive('Delete entry', () => {
      clearTimeout(saveTimer);
      store.remove(entry.id);
      toast('Deleted');
      api.go('#/', { replace: true });
    });
  }

  /* --------------------------------------------------------------- node */

  const node = el('div.screen-inner',
    el('article.entry-head',
      titleField,
      dateLine,
      moodGroup,
      bodyField,
    ),
  );

  titleField.readOnly = !editing;
  bodyField.readOnly = !editing;
  refreshDate();
  paintMood();

  /* Textareas have no height until they are in the document. */
  requestAnimationFrame(() => {
    autoGrow(titleField);
    autoGrow(bodyField);
    if (editing) titleField.focus();
  });

  return {
    node,
    /* The toolbar title only appears once the big title has scrolled away,
       so it tracks whatever is currently typed. */
    get title() {
      return titleField.value.trim() || bodyField.value.trim().split('\n')[0].slice(0, 40) || 'Entry';
    },
    get bar() {
      if (!editing) return 'hidden';
      const current = store.get(entry.id);
      return {
        mode: 'publish',
        label: current?.published ? 'Done' : 'Publish',
        /* Nothing to publish until something has been written. */
        disabled: !!current && store.isEmpty(current),
        /* Delete sits beside Done because deleting is something you decide
           while you have the entry open in front of you, not a thing to go
           hunting for behind a ⋯. Reading stays read-only in every sense. */
        side: { icon: 'trash', label: 'Delete entry', tone: 'danger', onSelect: del },
        onSelect: () => {
          flush();
          const now = store.get(entry.id);
          if (!now) return;
          if (now.published) {
            setEditing(false);
          } else {
            store.publish(entry.id);
            toast('Published');
            api.go('#/', { replace: true });
          }
        },
      };
    },
    get toolbarLeft() {
      return iconButton('back', 'Back', () => api.back());
    },
    /* Read mode offers exactly one thing, and it is the pencil. Everything
       else you can do to an entry belongs to editing it and lives in the bar,
       so there is no ⋯ here and nothing hidden behind one. */
    get toolbarRight() {
      return editing
        ? []
        : iconButton('pencil', 'Edit entry', () => setEditing(true), { 'data-tone': 'accent' });
    },
    onLeave() {
      flush();
      /* "Start writing…", then second thoughts: an untouched draft should
         not survive as a row in the list. */
      store.discardIfEmpty(entry.id);
    },
    /* app.js calls this when the app is being backgrounded — iOS may never
       give us another frame. */
    onHide: flush,
  };
}
