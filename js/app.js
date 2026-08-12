/* ============================================================================
   app.js — boot, routing, the composer bar, and the keyboard.

   Routes are hashes because this is a static site: GitHub Pages will not
   rewrite /entry/abc123 back to index.html, so a real path would 404 the
   moment anyone reloaded on an entry.

     #/                  the list
     #/e/<id>            one entry
     #/calendar          this month
     #/calendar/2026-08  a specific month

   A view is a plain object: { node, title, bar, toolbarLeft, toolbarRight,
   onLeave, onHide }. `bar` and the toolbar slots may be getters, which is
   how the entry screen changes the button under itself without re-rendering.
   ========================================================================= */

import { el, icon, toast } from './ui.js';
import * as store from './store.js';
import { requireUnlock } from './gate.js';
import * as home from './home.js';
import * as entry from './entry.js';
import * as calendar from './calendar.js';

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
  return { name: 'home', params: {} };
}

const VIEWS = { home, entry, calendar };

function go(hash, { replace = false } = {}) {
  if (location.hash === hash) { render(); return; }
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else {
    depth++;
    location.hash = hash;   /* hashchange drives the render */
  }
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
  screenHost.dataset.enter = '';

  refreshToolbar();
  refreshBar();
  onScroll();

  /* Move focus to the top of the new screen so a screen reader announces it
     and the keyboard doesn't stay on the button that got us here. */
  screenHost.focus({ preventScroll: true });
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
   the bar (and shortening the scroll pane) by that much is the fix. */

function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;

  const update = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(covered)}px`);
    bar.dataset.kb = covered > 40 ? 'true' : 'false';
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  store.load();
  await requireUnlock();

  window.addEventListener('hashchange', render);
  screenHost.addEventListener('scroll', onScroll, { passive: true });

  /* iOS can suspend the app without another frame — flush before it does. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') current?.onHide?.();
  });
  window.addEventListener('pagehide', () => current?.onHide?.());

  window.addEventListener('dj:write-failed', () => {
    toast('Could not save — device storage is full', 6000);
  });

  trackKeyboard();
  render();
}

boot();
