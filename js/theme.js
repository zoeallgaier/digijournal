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

   IOS READS THIS ONCE, AT LAUNCH, AND HOLDS IT FOR THE SESSION. Changing
   .content does nothing to a running homescreen app. Neither does removing
   the meta and inserting a fresh element — that was tried on 12 Aug 2026,
   on the theory that iOS might notice a new node even if it ignored an
   attribute, and it was reverted the same day. iOS is not watching the
   document at all, so there is no DOM shape that beats it: the bar catches
   up on the next launch and not before.

   DO NOT SPEND ANOTHER ROUND HUNTING FOR THE MUTATION THAT WORKS. Everything
   BELOW the status bar repaints the instant the palette changes, because
   that strip is the only part of the screen that is not ours. */
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
  return next;
}

export function start() {
  apply(current());
  /* The palette does not change when the phone goes dark, but the paper does
     — so the status bar has to be re-read, not just re-applied. */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintStatusBar);
}
