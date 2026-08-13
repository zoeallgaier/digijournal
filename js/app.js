/* ============================================================================
   app.js — boot, routing, the composer bar, and the keyboard.

   Routes are hashes because this is a static site: GitHub Pages will not
   rewrite /entry/abc123 back to index.html, so a real path would 404 the
   moment anyone reloaded on an entry.

     #/                  the list
     #/e/<id>            one entry
     #/calendar          this month
     #/calendar/2026-08  a specific month
     #/settings          the palette, and signing in

   There is no unlock step: the app opens straight onto the list. Anyone
   holding the phone can read the journal, which is the trade Zoe made on
   12 Aug 2026 — see the storage note in CLAUDE.md.

   SIGNING IN IS NOT AN UNLOCK STEP EITHER. Sync arrived on 12 Aug 2026 and
   deliberately did not put a form in front of the journal: a cold launch
   still opens on the list whether or not anyone has ever signed in, and the
   app is exactly what it was — local only — until someone does.

   A view is a plain object: { node, title, bar, toolbarLeft, toolbarRight,
   onMount, onLeave, onHide }. `bar` and the toolbar slots may be getters,
   which is how the entry screen changes the button under itself without
   re-rendering. `onMount` runs once the node is in the document; returning
   true means the view has taken the caret and app.js must not move it.
   ========================================================================= */

import { el, icon, toast } from './ui.js';
import * as store from './store.js';
import * as home from './home.js';
import * as entry from './entry.js';
import * as calendar from './calendar.js';
import * as settings from './settings.js';
import * as sync from './sync.js';
import * as theme from './theme.js';
import { consumeUpdateNotice } from './update.js';

const screenHost = document.getElementById('screen');
const toolbar    = document.getElementById('toolbar');
const bar        = document.getElementById('bar');

let current = null;   /* the mounted view                                   */
let route   = null;   /* { name, params }                                   */
let depth   = 0;      /* in-app navigations, so back() knows if it can      */

/* ---------------------------------------------------------------- routing */

function parse(hash) {
  const path = (hash || '').replace(/^#\/?/, '');
  const [head, ...rest] = path.split('/');

  if (head === 'e' && rest[0]) return { name: 'entry', params: { id: rest[0] } };
  if (head === 'calendar')     return { name: 'calendar', params: { month: rest[0] || '' } };
  if (head === 'settings')     return { name: 'settings', params: {} };
  return { name: 'home', params: {} };
}

const VIEWS = { home, entry, calendar, settings };

/* BOTH BRANCHES RENDER SYNCHRONOUSLY, AND THAT IS THE KEYBOARD.
   This used to assign `location.hash` and let the hashchange event drive the
   render. hashchange is a task, so the new screen was built one turn after
   the tap that asked for it — outside it, as far as iOS is concerned. WebKit
   raises the on-screen keyboard only for a focus() that happens inside the
   gesture that asked for it, so "Start writing…" opened a draft with a caret
   in it and no keyboard under it. pushState changes the URL without firing
   hashchange, so rendering here keeps the whole navigation inside the tap.
   The back button still arrives as a hashchange, which is what that listener
   is left for. */
function go(hash, { replace = false } = {}) {
  if (location.hash === hash) { render(); return; }
  if (replace) {
    history.replaceState(null, '', hash);
  } else {
    depth++;
    history.pushState(null, '', hash);
  }
  render();
}

function back() {
  if (depth > 0) { depth--; history.back(); }
  else go('#/', { replace: true });
}

const api = { go, back, refreshBar, refreshToolbar };

/* ---------------------------------------------------------------- render */

function render() {
  const next = parse(location.hash);
  const previous = current;

  current = null;                 /* so onLeave can't re-enter render()     */
  previous?.onLeave?.();

  route = next;
  current = VIEWS[next.name].view(next.params, api);

  screenHost.replaceChildren(current.node);
  screenHost.scrollTop = 0;

  refreshToolbar();
  refreshBar();
  onScroll();

  /* The node is in the document now, which is the first moment a view can
     measure itself or take the caret — and, because go() got us here inside
     the tap, still early enough for iOS to raise the keyboard for it. A view
     that took the caret says so, and keeps it. */
  const claimed = current.onMount?.() === true;

  screenHost.dataset.enter = '';

  /* Move focus to the top of the new screen so a screen reader announces it
     and the keyboard doesn't stay on the button that got us here. */
  if (!claimed) screenHost.focus({ preventScroll: true });
}

/* --------------------------------------------------------------- toolbar */

/* Three slots, always all three. An empty slot still holds its width — that
   is the CSS's job, not a spacer element's — so the title stays centred
   whatever a screen puts on either side of it. */
function refreshToolbar() {
  if (!current) return;

  const left  = [].concat(current.toolbarLeft  || []).filter(Boolean);
  const right = [].concat(current.toolbarRight || []).filter(Boolean);

  toolbar.replaceChildren(el('div.toolbar-inner',
    el('div.toolbar-slot', ...left),
    el('h2.toolbar-title', { 'aria-hidden': 'true' }, current.title || ''),
    el('div.toolbar-slot', { 'data-side': 'right' }, ...right),
  ));
}

function onScroll() {
  toolbar.dataset.scrolled = screenHost.scrollTop > 8 ? 'true' : 'false';
}

/* ------------------------------------------------------------------- bar
   One button, two lives. On the list it is the invitation to write; in the
   editor it is Publish. It is never rebuilt, only relabelled, so the change
   reads as the same object taking a new job. */

const compose = el('button.compose.glass', { type: 'button' });

/* The capsule beside the composer takes whatever job the screen you are on
   has for it: the calendar from the list, the way back out of the calendar,
   delete while you are editing. Same position, same capsule — so the thing
   that took you in is the thing that brings you back, and an entry needs no
   ⋯ menu to reach the one action that isn't already on screen. */
const sideButton = el('button.bar-side.glass', { type: 'button' });

bar.append(el('div.bar-inner', compose, sideButton));

/** { icon, label, tone, onSelect }, or null to take the capsule away. */
function paintSide(spec) {
  if (!spec) { sideButton.hidden = true; return; }
  sideButton.hidden = false;
  sideButton.replaceChildren(icon(spec.icon));
  sideButton.setAttribute('aria-label', spec.label);
  if (spec.tone) sideButton.dataset.tone = spec.tone;
  else delete sideButton.dataset.tone;
  sideButton.onclick = spec.onSelect;
}

function startWriting() {
  const created = store.create();
  go(`#/e/${created.id}`);
}

function refreshBar() {
  if (!current) return;
  const spec = current.bar ?? 'hidden';

  if (spec === 'hidden') {
    bar.hidden = true;
    /* aria-hidden as well: `hidden` is overridden in CSS so the bar can
       animate out, which leaves it in the accessibility tree. */
    bar.setAttribute('aria-hidden', 'true');
    return;
  }

  bar.hidden = false;
  bar.removeAttribute('aria-hidden');

  if (spec === 'compose') {
    compose.dataset.mode = 'compose';
    compose.textContent = 'Start writing…';
    compose.disabled = false;
    compose.setAttribute('aria-label', 'Start writing a new entry');
    compose.onclick = startWriting;

    const onCalendar = route?.name === 'calendar';
    paintSide(onCalendar
      ? { icon: 'back',     label: 'Back to the list', onSelect: back }
      : { icon: 'calendar', label: 'Mood calendar',    onSelect: () => go('#/calendar') });
    return;
  }

  compose.dataset.mode = 'publish';
  compose.textContent = spec.label;
  compose.disabled = !!spec.disabled;
  compose.setAttribute('aria-label', spec.label);
  compose.onclick = spec.onSelect;
  paintSide(spec.side);
}

/* -------------------------------------------------------------- keyboard
   When the on-screen keyboard opens, iOS shrinks the visual viewport but
   leaves the layout viewport alone — so a `position: fixed` bar sits under
   the keyboard rather than above it. Measuring the difference and lifting
   the bar (and shortening the scroll pane) by that much is the fix.

   --kb LIFTS THE COMPOSER OFF THE BOTTOM OF THE SCREEN. That is right for a
   keyboard and wrong for anything else, and the difference is not academic:
   both `.bar` and `.screen` sit on it, so any stray value leaves a band of
   bare --paper under the composer — an off-white block in light, navy in
   dark, looking for all the world like iOS padding the app.

   window.innerHeight and visualViewport.height do not always agree by zero
   on iOS. They disagree by a hair while a scroll settles, and can disagree
   by a standing amount depending on how the web view was laid out. So the
   raw difference is not the keyboard, and is never set as --kb.

   What is the keyboard is the difference from REST. Whatever the two
   viewports disagree by while nothing is focused is the phone's own, and it
   is re-read every time focus leaves — so it stays right across a rotation
   or a resize rather than being sampled once at boot and trusted forever.
   On top of that, a lift only counts if something focused could have raised
   a keyboard, and if it clears what a keyboard is. */

const KEYBOARD_MIN = 120;   /* an iOS keyboard is ~300px. Nothing else is. */

function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;

  /* How far the two viewports stand apart when no keyboard can be up. */
  let atRest = 0;

  const typing = () => {
    const active = document.activeElement;
    return !!active && (active.tagName === 'TEXTAREA'
                     || active.tagName === 'INPUT'
                     || active.isContentEditable);
  };

  const set = (px) => document.documentElement.style.setProperty('--kb', `${px}px`);

  const update = () => {
    const apart = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

    if (!typing()) { atRest = apart; set(0); return; }

    const lift = Math.round(apart - atRest);
    set(lift >= KEYBOARD_MIN ? lift : 0);
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  /* The viewport resize and the focus change arrive in either order, so ask
     again on both. focusout runs before focus lands — read it on the far
     side, the same way update.js does. */
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 0));
  update();
}

/* ------------------------------------------------------------------ boot */

function boot() {
  store.load();

  /* Before the first render, so no screen is ever painted in one palette and
     corrected into another. index.html has already set the attribute inline;
     this is what keeps the status bar in step with it from here on. */
  theme.start();

  window.addEventListener('hashchange', render);
  screenHost.addEventListener('scroll', onScroll, { passive: true });

  /* iOS can suspend the app without another frame — flush before it does. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') current?.onHide?.();
  });
  window.addEventListener('pagehide', () => current?.onHide?.());

  /* update.js is about to reload the page under us. Same flush, same reason:
     the screen is going away and this is the last frame we get. */
  window.addEventListener('dj:flush', () => current?.onHide?.());

  window.addEventListener('dj:write-failed', () => {
    toast('Could not save — device storage is full', 6000);
  });

  /* Which entry is open, so a sync round cannot overwrite what is being typed
     into it. The entry screen is the only view that answers. */
  sync.setGuard(() => current?.entryId ?? null);

  /* Entries that arrived from another device. Only the screens that are a
     view OF the journal are redrawn — never the entry screen, which may have
     a caret in it, and never the settings screen, which may have half a
     password in it. Both of those pick the change up when they are next
     opened, which is the moment they are next correct anyway. */
  window.addEventListener('dj:sync-changed', () => {
    if (route?.name !== 'home' && route?.name !== 'calendar') return;
    /* Keep the reading position: an entry landing from the iPad must not
       throw the list back to the top under someone's thumb. */
    const at = screenHost.scrollTop;
    render();
    screenHost.scrollTop = at;
    onScroll();
  });

  trackKeyboard();
  render();

  /* Last, so the first paint never waits on a network. Everything sync does
     is behind the screen that is already up. */
  sync.start();

  /* Said here rather than in update.js because a toast raised before the
     first screen exists has nothing to sit above and nobody to read it. */
  if (consumeUpdateNotice()) toast('Updated');
}

boot();
