/* ============================================================================
   entry.js — one entry: reading it and writing it. Nothing else.

   The day's rating used to be the first thing on this screen and is now on
   the list, where it belongs to the day rather than to whatever was written
   that day. See mood.js and store.js.

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
      bodyField,
    ),
  );

  titleField.readOnly = !editing;
  bodyField.readOnly = !editing;
  refreshDate();

  return {
    node,
    /* Called by app.js the moment the node is in the document — textareas
       have no height until they are, and nothing can be focused before then.
       THIS MUST NOT BE DEFERRED TO A FRAME. It used to be a
       requestAnimationFrame, and a frame is one turn too late: iOS raises the
       keyboard only for a focus() that happens inside the tap that asked for
       it, so tapping "Start writing…" opened the draft with the caret sitting
       in it and no keyboard underneath. */
    onMount() {
      autoGrow(titleField);
      autoGrow(bodyField);
      if (!editing) return false;
      titleField.focus();
      return true;   /* the caret is ours; app.js leaves it alone */
    },
    /* Which entry is open, so sync.js can refuse to overwrite it. A round
       landing mid-sentence would otherwise replace the paragraph under the
       caret with the server's older copy, and the next keystroke would be
       typed into it. See the note at the top of sync.js. */
    entryId: entry.id,
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
