/* ============================================================================
   theme.js — which of the eight palettes the app is wearing.

   The colours are NOT here. Every one of them lives in tokens.css, keyed by
   `[data-palette='…']`; this file's whole job is to put the right name
   in that attribute, remember it, and keep the phone's status bar the same
   colour as the page under it. A palette is a list of names and nothing more,
   which is what makes adding one a change to the stylesheet alone.

   Seven of the eight are the iMac plastics — Bondi Blue in 1998, the five
   fruits in 1999, Graphite in 2000. The eighth is `paper`: the off-white and
   off-black the app opens on, and the one that is not a colour.

   THE FIRST PAINT IS NOT OURS. This is a module, so it runs after the page
   has already been laid out — long enough for a Blueberry install to flash
   cream on every launch. index.html therefore carries four inline lines that
   read the same key and set the same attribute before the first stylesheet
   is applied. They are the only other code in the app that touches storage,
   they only ever read, and if they were deleted the app would still be
   correct — just one frame uglier.
   ========================================================================= */

import * as store from './store.js';

/** The name is the id; the colours are in tokens.css. Order is the order they
 *  are offered in: the paper first, then the plastics in the order Apple
 *  shipped them. */
export const PALETTES = [
  { id: 'paper',      name: 'Paper' },
  { id: 'bondi',      name: 'Bondi Blue' },
  { id: 'blueberry',  name: 'Blueberry' },
  { id: 'grape',      name: 'Grape' },
  { id: 'tangerine',  name: 'Tangerine' },
  { id: 'lime',       name: 'Lime' },
  { id: 'strawberry', name: 'Strawberry' },
  { id: 'graphite',   name: 'Graphite' },
];

export const DEFAULT = 'paper';

const known = (id) => PALETTES.some((p) => p.id === id);

/** What the app is wearing. Anything unrecognised — a palette that used to
 *  exist, a key edited by hand — reads as the default rather than as an
 *  attribute no stylesheet answers. */
export function current() {
  const stored = store.palette();
  return known(stored) ? stored : DEFAULT;
}

/* ------------------------------------------------------------- status bar
   Under `apple-mobile-web-app-status-bar-style: default` the status bar is
   iOS's strip of screen, above the web view, and it is painted from
   theme-color — no stylesheet can reach it. So the meta has to follow the
   palette, or Blueberry gets a cream bar over a blue page.

   index.html ships two of these metas, one per scheme, which are right for
   the default palette before any of this runs. The first matching meta in the
   document wins, so they are replaced by one that we keep in step rather than
   being left in front of it. The value is read back OUT of the stylesheet —
   --paper is the page's own colour, and asking the browser for it is what
   keeps this file from holding a second copy of the palette.

   IOS DOES NOT WATCH THIS META. Changing .content does nothing to a running
   homescreen app, and neither does removing the meta and inserting a fresh
   element — that was tried on 12 Aug 2026 and reverted the same day. There
   is no DOM mutation that reaches the strip; do not go looking for one.

   A SAME-DOCUMENT NAVIGATION IS NOT ENOUGH EITHER. pushState to the URL we
   are already on, popped straight back, was tried on 12 Aug 2026 on the
   theory that the bar caught up when you left Settings. It does not work.
   Two negative results, both measured on the phone, both worth keeping:
   iOS re-reads this meta on a DOCUMENT LOAD and on nothing else.

   So a palette change reloads the app — see relaunch(). That is a real cost
   and it is deliberate: the alternative is a strip that stays three colours
   behind until the next cold launch. */
let meta = null;

function paintStatusBar() {
  const paper = getComputedStyle(document.documentElement)
    .getPropertyValue('--paper').trim();
  if (!paper) return;

  if (!meta) {
    for (const old of document.querySelectorAll('meta[name="theme-color"]')) old.remove();
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = paper;
}

/** Load the app again, because that is the only thing the status bar reads.
 *
 *  The choice is already in storage before this runs, and the four inline
 *  lines in index.html read it before the first stylesheet is applied — so
 *  the app comes back up already wearing the colour, with iOS reading the
 *  meta fresh on the way in. What you see is a repaint, not a relaunch.
 *
 *  IT CANNOT COST AN ENTRY. `dj:flush` is the same signal update.js sends
 *  before its own reload, and app.js turns it into the onHide the editor
 *  already runs when the phone is locked, so anything half-typed is in
 *  storage before the document goes. A reload re-reads localStorage, which
 *  no part of this touches.
 *
 *  It does NOT set update.js's notice, so this reload is silent — "Updated"
 *  belongs to a deploy, and a palette is not one.
 *
 *  Installed app only. In a tab there is no strip to repaint, and the suite
 *  clicks all eight palettes in a row — unguarded, this would tear down the
 *  page mid-run. Never while a text field has focus, so this can never take
 *  a half-written email or password away with it. */
function relaunch() {
  if (!navigator.standalone) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
  window.dispatchEvent(new CustomEvent('dj:flush'));
  location.reload();
}

/* --------------------------------------------------------------- applying */

function apply(id) {
  document.documentElement.dataset.palette = id;
  paintStatusBar();
}

/** Choose a palette. Persists it, so the next launch opens wearing it.
 *
 *  There is no event to announce this and nothing subscribes to it. Swapping
 *  the attribute repaints every screen at once, because every colour in the
 *  app is a var() reading off this element — no view holds a colour it would
 *  have to be told to reconsider. */
export function set(id) {
  const next = known(id) ? id : DEFAULT;
  store.setPalette(next);
  apply(next);
  relaunch();
  return next;
}

export function start() {
  /* Nothing to force on boot: the launch IS the document load, and iOS has
     just read the meta the inline lines in index.html left it. */
  apply(current());
  /* The palette does not change when the phone goes dark, but the paper
     does, so the meta has to be re-read rather than just re-applied — and
     it is right for the next load even though the strip cannot act on it
     now. Deliberately NOT a relaunch: reloading the journal out from under
     someone who is reading, because the sun went down, is a worse thing
     than a strip that catches up when they next choose a colour or open
     the app. One line here if that trade is ever wanted the other way. */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintStatusBar);
}
