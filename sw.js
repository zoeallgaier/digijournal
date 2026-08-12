/* ============================================================================
   sw.js — the offline guarantee, and nothing else.

   Network-first for everything this app is made of. That ordering is the
   deploy story: push to main, and the next launch fetches the new files and
   updates the cache. The cache only answers when the network doesn't — on
   the tube, on a plane, on hotel wifi that resolves but never returns.

   Network-first is not enough on its own, though. GitHub Pages serves these
   files with `max-age=600`, so "go to the network" can be answered by
   Safari's own HTTP cache with a build up to ten minutes old — which looks
   exactly like a deploy that didn't land. So the app's own source is fetched
   with `cache: 'no-cache'`: always ask the server, and let it reply "still
   the same" in a few bytes when it is. Fonts and icons keep normal caching;
   they never change.

   So a stale screen means the request FAILED, not that the cache is stuck.
   If you ever need the blunt instrument, bump VERSION: it drops every
   cached byte on the next activate.

   Nothing you write passes through here, and bumping VERSION cannot cost you
   an entry. Entries live in localStorage; this worker only ever sees, caches
   and deletes the app's own static files.
   ========================================================================= */

const VERSION = 'digijournal-v2';

/* Relative so the app works at any base path — it is served from
   /digijournal/ on GitHub Pages, and from / when run locally. */
const SHELL = [
  './',
  'index.html',
  'css/tokens.css',
  'css/base.css',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/ui.js',
  'js/gate.js',
  'js/home.js',
  'js/entry.js',
  'js/calendar.js',
  'js/update.js',
  'fonts/dmsans-latin.woff2',
  'fonts/dmsans-latin-ext.woff2',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      /* One bad path must not fail the whole install — cache what resolves
         and let the rest arrive on first use. */
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The app's own source, as opposed to the things it is dressed in. These are
   what change when Zoe and Claude change something, so these are the ones
   worth a revalidation round trip. */
const SOURCE = /\.(?:html|css|js|webmanifest)$/;

function fromNetwork(request, url) {
  if (request.mode !== 'navigate' && !SOURCE.test(url.pathname)) {
    return fetch(request);
  }
  try {
    /* "Ask the server, but let it answer 304." Copying a navigation request
       with an init is legal but has been thin ice in older engines — if it
       ever throws, a plain fetch is still correct, just cacheable. */
    return fetch(request, { cache: 'no-cache' });
  } catch {
    return fetch(request);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fromNetwork(request, url)
      .then((response) => {
        /* Only cache a real answer. Opaque and error responses are exactly
           the ones you don't want to serve back offline. */
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        /* A navigation that missed the cache still has to land somewhere —
           the app shell can render every route from the hash. */
        if (request.mode === 'navigate') {
          const shell = await caches.match('index.html') || await caches.match('./');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
