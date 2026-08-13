/* ============================================================================
   app.js — boot, routing, the bar, and the keyboard.

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

   THE BAR HAS TWO STATES AND THERE IS NO THIRD. `bar` is either the string
   'nav' — the three peer screens, Journal, Calendar and Settings, with the
   quill beside them — or an object, which is a screen with a primary action
   in front of it. Only the entry is the second kind, and it is the only
   screen you go INTO rather than across to. Rebuilt 13 Aug 2026; before it,
   one capsule in one position was the calendar on the list, back on the
   calendar and DELETE in the editor, so muscle memory built on the list
   landed on a destructive action inside an entry.
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
   gesture that asked for it, so the quill opened a draft with a caret
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

/* The three peer screens, in the order they sit in the bar. That order is
   also what the enter animation reads to decide which way a screen comes
   in, so moving a tab moves the motion with it. */
const TABS = [
  { route: 'home',     hash: '#/',          icon: 'journal',  label: 'Journal' },
  { route: 'calendar', hash: '#/calendar',  icon: 'calendar', label: 'Mood calendar' },
  { route: 'settings', hash: '#/settings',  icon: 'palette',  label: 'Settings' },
];

const TAB_INDEX = Object.fromEntries(TABS.map((t, i) => [t.route, i]));

/* A tab REPLACES rather than pushes: the three are peers, not a trail, so
   stepping between them must not stack history to be walked back through.
   Which also means the entry's back button always finds the tab you left —
   the entry is the one thing in the app that is pushed. */
function goTab(index) {
  depth = 0;
  go(TABS[index].hash, { replace: true });
}

const api = { go, back, refreshBar, refreshToolbar, compose: startWriting };

/* Which way the new screen arrives, and it is information rather than
   decoration: across between peers, up into a detail, back down out of one.
   Same route (a month step, a sync repaint) keeps the plain rise it always
   had — a lateral slide there would be describing a move that didn't
   happen. */
function enterDirection(from, to) {
  const a = TAB_INDEX[from?.name];
  const b = TAB_INDEX[to.name];
  if (a !== undefined && b !== undefined) return a === b ? 'rise' : (b > a ? 'right' : 'left');
  if (b === undefined) return 'in';
  return 'out';
}

/* ---------------------------------------------------------------- render */

function render() {
  const next = parse(location.hash);
  const previous = current;
  const from = route;

  current = null;                 /* so onLeave can't re-enter render()     */
  previous?.onLeave?.();

  route = next;
  current = VIEWS[next.name].view(next.params, api);

  /* Set before the node lands, so the animation is right from its first
     frame rather than restarting one frame in. It is CSS on an element that
     is already in the document — nothing here waits for it, and nothing may
     ever be made to. See onMount below. */
  screenHost.dataset.enter = enterDirection(from, next);

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
   The whole of the app's navigation, and one of two shapes at any moment.

   NAVIGATE — the three peers. A glass pill holding Journal, Calendar and
   Settings, with the quill beside it. Every screen is then one tap from
   every other, which is what retired the gear from the list's toolbar (the
   only door Settings had) and the back button from three screens that no
   longer have anywhere to go back to.

   ACT — the entry. The pill is the action and the capsule is Delete, which
   is the bar as it always was. It is deliberately the only screen of this
   kind: a bar that is navigation everywhere else must not be an action
   somewhere you can get stranded, which is why signing in is a button in
   its own form rather than borrowing this pill.

   The two are separate elements sharing one slot rather than one element
   morphing — a three-cell group and a labelled pill cannot be the same
   node. They cross-fade, so the bar still reads as one surface changing
   its mind rather than two bars swapping. */

const compose = el('button.compose.glass', { type: 'button' });

const navSel = el('span.bar-nav-sel', { 'aria-hidden': 'true' });

const tabButtons = TABS.map((tab, i) =>
  el('button.bar-tab', { type: 'button', onclick: () => goTab(i) }, icon(tab.icon)));

/* Not role=tablist: these are four separate screens, not panels of one, and
   aria-current="page" is what says which you are on. */
const navPill = el('nav.bar-nav.glass', { 'aria-label': 'Sections' }, navSel, ...tabButtons);

/* The capsule. In the nav state it is the quill on all three screens — one
   job, one position, everywhere — and in the act state it is whatever the
   entry has for it. */
const sideButton = el('button.bar-side.glass', { type: 'button' });

bar.append(el('div.bar-inner', navPill, compose, sideButton));

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

/* The sync state has to reach someone who cannot see the tone on the gear,
   so it is in the tab's NAME rather than only in its colour. It moved here
   from the list's toolbar with the gear itself. */
function settingsLabel(status) {
  if (status === 'off')     return 'Settings — not signed in';
  if (status === 'syncing') return 'Settings — syncing now';
  if (status === 'offline') return 'Settings — no connection';
  if (status === 'error')   return 'Settings — sync needs attention';
  return 'Settings — sync up to date';
}

/* Nothing about the selection's POSITION lives here: CSS moves it from
   `data-tab`, the same way the mood card's thumb is moved. */
function paintNav() {
  const at = TAB_INDEX[route?.name];
  navPill.dataset.tab = at ?? '';

  const { status } = sync.state();
  tabButtons.forEach((btn, i) => {
    const here = i === at;
    btn.setAttribute('aria-label', TABS[i].route === 'settings'
      ? settingsLabel(status)
      : TABS[i].label);
    if (here) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
    if (TABS[i].route === 'settings' && status === 'error') btn.dataset.tone = 'danger';
    else delete btn.dataset.tone;
  });
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

  if (spec === 'nav') {
    navPill.hidden = false;
    compose.hidden = true;
    paintNav();
    /* THE ONE VERB, and it must stay synchronous: startWriting creates the
       draft and navigates inside the tap, which is the only way iOS raises
       a keyboard for the caret entry.js takes on the far side. */
    paintSide({ icon: 'quill', label: 'Write a new entry', tone: 'accent', onSelect: startWriting });
    return;
  }

  navPill.hidden = true;
  compose.hidden = false;
  compose.dataset.mode = spec.mode === 'quiet' ? 'quiet' : 'publish';
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
   a keyboard, and if it clears what a keyboard is.

   A KEYBOARD-SIZED GAP IS NEVER REST, and forgetting that is what put Done
   behind the keyboard. `focusout` re-samples rest one task later, and one
   task is nowhere near the ~300ms an iOS keyboard takes to animate shut —
   so tapping Done sampled a viewport that was still 300pt short and wrote
   that down as the phone's standing disagreement. The next keyboard then
   measured 300 against a rest of 300 and lifted the bar by nothing.

   That is why this only ever showed up on an entry that already existed. A
   new draft is written once and published, and you leave the screen; an
   existing entry is the only one you can edit, finish, and edit AGAIN
   without the screen ever being rebuilt — which is the second keyboard, on
   the poisoned reading. Fixed 13 Aug 2026.

   Rest is small by definition, so a sample that is keyboard-sized is thrown
   away rather than believed. No timer, and nothing to tune. */

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
    /* THE KEYBOARD'S HEIGHT, AND offsetTop IS NOT PART OF IT. This used to
       subtract it, which is the formula every article gives — and it is what
       put Done behind the keyboard on a long entry.

       offsetTop is a SCROLL POSITION: how far iOS has panned the visible
       area within the layout viewport. It grows when the caret would land
       under the keyboard and iOS shoves the whole view up to reveal it,
       which is exactly what editing an existing entry does and what a new
       empty draft never does. Subtracting it made a 365pt keyboard measure
       as nothing, --kb fell under KEYBOARD_MIN, and the bar dropped flat.

       Measured on the phone with tools/edges.html, both ways round: with the
       field at the top of the page (no pan) offsetTop is 0 and the bar lands
       exactly on the keyboard; with the field below the fold it panned and
       the lift collapsed to 0. The keyboard did not change size between
       those two — only the scroll did. */
    const apart = Math.max(0, window.innerHeight - vv.height);

    if (!typing()) {
      /* Only believe a reading that could actually be rest. A keyboard-sized
         gap with nothing focused is a keyboard on its way out, and writing
         it down here is what makes the NEXT keyboard measure as nothing. */
      if (apart < KEYBOARD_MIN) atRest = apart;
      set(0);
      return;
    }

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

  /* The Settings tab carries how sync is doing, in its name and — when
     something needs looking at — in its tone. It is in the bar on every
     screen now, so repainting it is the bar's job rather than the list's. */
  window.addEventListener('dj:sync', refreshBar);

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
