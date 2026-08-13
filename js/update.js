/* ============================================================================
   update.js — how a deploy reaches the phone.

   Tapping the homescreen icon usually RESUMES the app rather than loading it,
   so without something like this you can push a change, tap the icon, and be
   looking at last week's design with no way to tell. This is that something:
   when the app comes back to the foreground it asks the server whether the
   files it is made of have changed, and if they have it reloads itself.

   It asks with HEAD requests and compares ETags — nothing to remember to bump
   on a deploy, no version file to keep in step. If a byte of any stylesheet
   or module changed, the fingerprint changed.

   NOTHING HERE CAN COST YOU AN ENTRY. Three separate reasons:

     · the reload is announced first — `dj:flush` makes the open editor write
       to storage before anything else happens, the same path as backgrounding
     · it will not fire while a field has focus; if you are typing, it waits
       for the caret to leave and applies then
     · a reload re-reads localStorage. Entries are not in the cache the
       service worker clears, and never were.
   ========================================================================= */

/* Every file that decides how the app looks and behaves. Fonts and icons are
   left out on purpose: they are large, they never change, and the reload
   picks them up anyway if they ever do. */
const WATCHED = [
  'index.html',
  'css/tokens.css',
  'css/base.css',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/ui.js',
  'js/home.js',
  'js/entry.js',
  'js/mood.js',
  'js/calendar.js',
  'js/settings.js',
  'js/theme.js',
  'js/config.js',
  'js/net.js',
  'js/sync.js',
  'js/update.js',
  'sw.js',
];

/* Also poll while the app is sitting open, so a push lands on a phone that is
   already awake on the screen you changed. Header-only requests, and only
   while the app is actually on screen. */
const POLL_MS = 60_000;

const NOTICE = 'digijournal.updated';

/* The reading the running app was built from. Null until the first successful
   check — offline, we simply don't know yet, and not knowing is not a reason
   to do anything. */
let stamp = null;
let pending = false;
let applying = false;

/** A file's identity as the server reports it. Empty string means the server
 *  answered but told us nothing useful; null means we couldn't reach it. */
async function stampOf(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return '';
    return res.headers.get('etag')
        || res.headers.get('last-modified')
        || res.headers.get('content-length')
        || '';
  } catch {
    return null;
  }
}

async function fingerprint() {
  const parts = await Promise.all(WATCHED.map(stampOf));
  /* One unreachable file and the whole reading is untrustworthy — half a
     fingerprint would read as a change and reload for no reason. */
  if (parts.some((part) => part === null)) return null;
  /* A server that sends no validators at all (python's http.server sends
     Last-Modified, but not everything does) can't answer this question. */
  if (parts.every((part) => part === '')) return null;
  return parts.join('|');
}

/** Is the person in the middle of something a reload would interrupt? */
function busy() {
  const active = document.activeElement;
  if (!active) return false;
  return active.tagName === 'TEXTAREA'
      || active.tagName === 'INPUT'
      || active.isContentEditable;
}

function apply() {
  if (!pending || applying) return;
  if (document.visibilityState !== 'visible') return;
  if (busy()) return;

  applying = true;

  /* Write anything the editor is holding, before the page goes away. */
  window.dispatchEvent(new CustomEvent('dj:flush'));

  /* Survives the reload, dies with the app session — so the new build can say
     what just happened, and a launch tomorrow says nothing. */
  try { sessionStorage.setItem(NOTICE, '1'); } catch { /* private mode */ }

  location.reload();
}

async function check() {
  if (applying) return;
  if (pending) { apply(); return; }

  const now = await fingerprint();
  if (now === null) return;          /* offline, or nothing to compare with */

  if (stamp === null) { stamp = now; return; }
  if (now === stamp) return;

  pending = true;
  apply();
}

/** True once, if this launch is the result of an update landing. Read by
 *  app.js once the first screen is mounted — a toast raised before that has
 *  nothing to sit above. */
export function consumeUpdateNotice() {
  try {
    if (sessionStorage.getItem(NOTICE) !== '1') return false;
    sessionStorage.removeItem(NOTICE);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ wiring */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* Deliberately no `controllerchange` reload. A new worker taking over is not
   the same question as "are my files out of date" — it fires on the very
   first launch, when nothing is stale, and it does NOT fire when only a
   stylesheet changed, which is most deploys. sw.js is in WATCHED instead, so
   the one path to a reload is the one that flushes first. */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  /* Let the browser re-fetch sw.js too, so a change to the offline rules
     installs alongside everything else. */
  navigator.serviceWorker?.getRegistration()
    .then((reg) => reg?.update())
    .catch(() => {});
  check();
});

/* Back from the page cache — the app never unloaded, so nothing else fires. */
window.addEventListener('pageshow', (event) => { if (event.persisted) check(); });

/* An update that arrived mid-sentence takes the first moment the caret is
   somewhere harmless. focusout runs before focus lands, so ask on the far
   side of it. */
document.addEventListener('focusout', () => setTimeout(apply, 0));

setInterval(() => { if (document.visibilityState === 'visible') check(); }, POLL_MS);

/* The baseline reading, once the launch has settled. */
window.addEventListener('load', () => { check(); });
