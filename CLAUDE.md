# Digijournal

A private daily journal, installed to the iPhone homescreen from its URL.
**That is the only target.** No native build, no App Store, no Xcode.

No build step. No framework. No bundler. **No dependencies at all** — there is
no `package.json` and nothing to install. ES modules, three stylesheets, two
font files. `index.html` is the whole entry point.

---

## Who you're working with

**Zoe is a designer.** She owns the visual and interaction decisions and is
sharp about them. The doctrine in `css/tokens.css` is the visual language;
every value in the app resolves to a token declared there.

She does not necessarily read the storage or routing layers the way she reads
the CSS, and should not have to. So:

- **Lead with the consequence, not the mechanism.** Not "localStorage is
  origin-scoped" — *"entries written in Chrome will never appear on your
  phone."* Not "the service worker is network-first" — *"a push reaches your
  phone on the next launch."*
- **Say what a technical choice costs her in the product.** Storage limits,
  offline behaviour, what happens if the phone is lost.
- **Never let a backend decision quietly narrow the design.** If something
  can't be built the way she drew it, say so plainly and say what *can* be.
- **Don't ask her to arbitrate implementation detail.** Pick the sound option,
  say which you picked in a sentence, move on. Ask when the answer is a product
  or taste decision — that's hers.

---

## Architecture

```
index.html          entry point, PWA meta, the two module tags
manifest.webmanifest  } together, these make the URL installable
icons/                }
sw.js               the offline guarantee — nothing else provides one
js/update.js        how a deploy reaches the phone — registers the worker
                    and reloads the app when the files really changed
css/tokens.css      the entire visual language — every value lives here
css/base.css        reset, @font-face, focus, reduced motion
css/app.css         every component
fonts/              DM Sans, variable, self-hosted (two files, all weights)
js/app.js           boot, hash routing, the composer bar, the keyboard
js/store.js         every entry; the ONLY file that touches localStorage
js/ui.js            el(), icon(), dates, toast, menu — the shared vocabulary
js/home.js          the list
js/entry.js         reading and writing one entry  ← the subtle file
js/calendar.js      the month, coloured by mood
tools/test.html     the headless suite (see Testing)
```

### The data model

```js
{ id, title, body, mood, day, createdAt, updatedAt, published }
```

`day` is the calendar day the entry is **about**, fixed at creation.
`updatedAt` is when it was last touched. They are deliberately separate: the
list sorts and dates by `updatedAt`, the calendar plots by `day`. Fixing a
typo in Monday's entry on Friday must not move Monday's mood to Friday.

A **draft** is `published: false`. It is not a separate species — it is a row
in the list with a quiet flag on it. An untouched draft (no title, no body, no
mood) is swept away when you leave it, so tapping "Start writing…" and
changing your mind leaves nothing behind.

### Reading and editing are one screen

`entry.js` keeps two textareas mounted and toggles `readOnly`. A textarea and
a paragraph never wrap identically, so swapping them moves every line by a
hair — which on a phone reads as the page flinching each time you tap edit.
`readonly` raises no keyboard on iOS, so read mode stays quiet. **Do not
replace this with a render-two-ways approach.**

Everything saves as you type (400ms debounce, plus a flush on
`visibilitychange: hidden`). **Publish is not the save** — it only moves a
draft into the list.

Which mode you are in is the whole navigation. Reading offers one control, the
pencil; editing swaps it for the bar, where Delete sits beside Done. There is
no ⋯ on an entry and nothing hidden behind one — if you can do it to an entry,
you can see it. The capsule beside the composer is the one slot that changes
job by screen: calendar on the list, back on the calendar, delete while
editing.

---

## Storage, and what it costs her

| what | where | durable? |
|---|---|---|
| every entry | `localStorage['digijournal.v1']` | **no** |
| the app itself | files in the repo, cached by `sw.js` | yes |

iOS treats script-written storage as reclaimable: Safari clears it after
roughly seven days without opening the app, "Clear Website Data" takes it
instantly, and none of it is in an iCloud backup. A homescreen app opened
daily is unlikely to be swept — but *unlikely* is not a promise you want
holding a year of journal entries.

**This is reasoning from documented WebKit behaviour, not a measurement on
Zoe's phone.** Treat it as a risk to design around, not a fact to quote at
her.

`store.load()` asks for persistent storage — `navigator.storage.persist()`,
which tells a browser this origin is worth keeping rather than reclaiming.
Only the installed app asks; in a tab it would be a permission prompt for a
stranger who is only looking at the URL. Safari does not implement it today,
so on the phone it is a no-op that costs nothing and starts working the day
it isn't. **Do not describe it as a fix.**

**There is no longer a way to get the journal off the phone.** Export and
import were removed on 11 Aug 2026 at Zoe's request, along with the ⋯ menu
that held them — the list's toolbar is deliberately empty now. What that
costs: if iOS sweeps the storage, or the phone is lost or replaced, the
entries are gone, and moving to a new phone starts an empty journal.

`store.exportBundle()` and `store.importBundle()` survive in `store.js` and
the suite still covers them, including the merge rule that keeps whichever
copy of an entry was edited later. So restoring the feature is a menu and two
handlers, not a rewrite — but do not add it back on your own initiative.

**Entries never leave the browser they were written in.** There is no server.
The repo ships the app, never the journal.

---

## There is no password

The gate was removed on 12 Aug 2026 at Zoe's request — `js/gate.js` and its
stylesheet block are gone, and the app opens straight onto the list. It had
been a deterrent rather than a lock in any case: the repo is public, so the
check ran on the reader's own machine and could be stepped over in the dev
tools.

**What that costs: anyone holding the unlocked phone can read the journal.**
That was the one real risk the gate addressed, and it is now the phone's
passcode's job alone. Nothing else changed — entries were never in the repo
or on a server, so a stranger who finds the URL still sees an empty journal,
their own.

Do not add it back on your own initiative. If it is ever wanted again, it is
one module and one `await` in `boot()`; `git show 3e2f1f3:js/gate.js` has the
last version, password `digijournal`.

---

## The workflow

**Claude builds. Zoe reviews the deployed site.** Do not screenshot every
change; screenshots are for when *you* need to see something to debug it.

1. Make the change locally.
2. Run the suite if the change has behaviour (see Testing).
3. Commit and push to `main`.
4. GitHub Pages redeploys in ~30–60s.
5. Zoe reviews at **https://zoeallgaier.github.io/digijournal/**

There is nothing to build before pushing. What is in the repo is what ships.

### How a deploy reaches the icon on her homescreen

Step 5 used to require deleting the app from memory and relaunching it,
because tapping the homescreen icon *resumes* the app rather than loading it.
`js/update.js` closes that: when the app comes back to the foreground — and
once a minute while it is sitting open — it HEADs every file the app is made
of and compares the ETags to the reading it booted with. Different bytes
anywhere, and it reloads itself and toasts **Updated**.

Nothing to bump on a deploy. A stylesheet edit changes the stylesheet's ETag,
and that is the whole signal.

**It cannot cost her an entry.** It fires `dj:flush` first, which app.js turns
into the same `onHide` the editor already runs when the phone is locked, so
what is on screen is in storage before the page goes. It will not fire at all
while a field has focus — an update that arrives mid-sentence waits for the
caret to leave and lands then. And a reload re-reads localStorage, which no
cache operation has ever touched.

There is deliberately **no `controllerchange` reload**. It fires on the first
launch, when nothing is stale, and it does *not* fire when only a stylesheet
changed — which is most deploys. `sw.js` is in `update.js`'s watch list
instead, so the one path to a reload is the one that flushes first.

### Getting it onto the phone

Safari → the URL → Share → **Add to Home Screen**. Once.

**What a deploy CANNOT change is the launch chrome.** The status bar style,
the icon, the app name and `display: standalone` are read by iOS at Add to
Home Screen time and frozen into the shortcut. A change to
`apple-mobile-web-app-status-bar-style` has no effect on an icon created
before it — the only fix is to delete the icon and add it again.

**So if the app is inset from the top or bottom edge, suspect the shortcut
before the CSS.** Full-bleed rests on three things, and the first two are
frozen at Add to Home Screen time:

| what | where | effect if lost |
|---|---|---|
| `viewport-fit=cover` | the viewport meta | iOS lays the web view out *inside* the safe area and paints the bands itself; `env(safe-area-inset-*)` all report 0 and no stylesheet can reach the gap |
| `apple-mobile-web-app-status-bar-style: black-translucent` | its own meta | the status bar stops being transparent over the page |
| `--bar-bottom: 0px` | `tokens.css` | ours, and the only one a deploy can fix |

Keep the viewport meta to `viewport-fit=cover` and nothing else. It used to
also carry `interactive-widget=resizes-content`, which is a Chrome feature
that did nothing on the only device this app targets, and an unrecognised
directive sitting next to the one that matters is a risk with no upside.

`manifest.webmanifest` deliberately carries **no `theme_color`**. A single
hard-coded one there outranks the two scheme-aware `<meta name="theme-color">`
tags in `index.html`, so the light-mode status bar would be painted the dark
scheme's navy — and a painted status bar is one iOS insets the app below.

If a change appears not to land: `sw.js` is network-first, so it serves the
cache only when the network fails. A stale screen means the request failed,
not that the cache is stuck. Bumping `VERSION` in `sw.js` drops every cached
byte and is the blunt instrument if one is ever needed — it drops *files*,
never entries.

Network-first was not sufficient on its own. GitHub Pages sends `max-age=600`,
so "go to the network" could be answered by Safari's own HTTP cache with a
build ten minutes old — indistinguishable from a deploy that failed. The
worker now fetches the app's own source (`.html`, `.css`, `.js`,
`.webmanifest`) with `cache: 'no-cache'`: always ask the server, and let it
answer 304 in a few bytes when nothing changed. Fonts and icons keep normal
caching; they never change.

---

## Testing

`tools/test.html` drives the real app in an iframe — that a cold launch opens
straight onto the list with nothing to unlock, writing, publishing, drafts,
mood, the calendar, the store's bundle merge, tap-target sizes, horizontal
overflow, where each screen's first line sits relative to the toolbar, that
the composer reaches the physical bottom edge with nothing under it, that no
control borrows the system blue, the delete sheet's surface, that the toast
stays centred through its animation, and that an update-driven reload flushes
what was being typed and gives the whole journal back afterwards. 122 checks.

The browser it runs in reports **no safe-area inset**, which is the point for
the bottom checks — it pins the case where nothing external is padding the
bar, so the only thing that can float the composer is our own CSS.

The half the suite can't reach is update *detection*, which needs a server
whose files can change mid-run. That was verified separately with a throwaway
harness and a POST hook that touches a stylesheet: an unchanged deploy does
not reload, a changed one does, and one that arrives while the caret is in a
field waits until the field is blurred.

**It erases this browser's journal before it runs**, so it does nothing until
told: open it and press the button, or load it with `?run=1`.

```sh
python3 -m http.server 8777 --bind 127.0.0.1   # then open:
#   http://127.0.0.1:8777/tools/test.html
```

Headless, it posts its results to a server that accepts POST — the plain
`http.server` above will 501 the beacon, so read the results in a browser
unless you stand up something that accepts it. **Run headless Chrome with a
throwaway `--user-data-dir` each time.** Reusing one serves `test.html` from
Chrome's own HTTP cache, and you will spend an hour reading the results of
the edit before last.

---

## Accessibility

The contrast ratios in `tokens.css` are **measured**, not estimated. Body text
clears 4.5:1 and non-text UI clears 3:1 in both schemes. If you change a
colour, re-measure it — do not eyeball it.

Colour is never the only channel: a mood dot in the list is paired with a
`.sr-only` label, and a calendar day keeps its numeral on top of the fill.
Every control is at least 44×44. The mood control is a real `radiogroup` with
arrow-key support and a roving tabindex.

---

## House style

- **No small all-caps subheadings.** Anywhere. Zoe has asked for this
  specifically.
- Titles are DM Sans **Black (900)**, body is **Light (300)**. The type scale
  in `tokens.css` carries the hierarchy — do not introduce a size outside it.
- One easing curve and three durations, all in `tokens.css`.
- Liquid glass is one primitive, `.glass`. The tint is doing the legibility
  work — **never lower its alpha to show more of the blur.**
- **Glass needs the journal behind it.** Over a `--scrim` there is nothing to
  refract, and white tint over a dimmed page cannot get the paper's warmth
  back: it lands at a dead neutral, *darker* than the page it claims to float
  above. A surface over a scrim is a `--card` — that is what the action sheet
  is, and the blur lives on the scrim instead, where the journal actually is.
- **Nothing is centred with `transform`.** Both keyframes in the app animate
  transform, so a translate-centred element is shoved half its width sideways
  for as long as the animation fills, then snaps back — which is what the
  toast used to do. Centring is layout's job: auto margins, or flex.
- **Two layers that must sit concentric get one box, not two mechanisms.** The
  mood face and its swatch are both absolutely positioned to the same offset
  and size. They used to be a centred grid item plus a positioned glyph, and
  they disagreed twice over: a `<button>` keeps the UA's `1px 6px` padding
  unless told otherwise, and WebKit resolves the resulting overflow towards
  the start edge, so the face sat left of its own circle; then a `transform`
  on the swatch promoted it into the positioned layer, where — being later in
  tree order — it painted over the face entirely. Hence `padding: 0`, hence
  the swatch is `::before`, and hence a chosen face scales from the button
  rather than from the swatch.
- **The chrome is measured once.** Both fixed bars are `--tap` plus air, so
  their heights are calculated, not chosen; `--chrome-top` and
  `--chrome-bottom` are what they cover, safe area included. `.screen-inner`
  pays for both in one declaration — `--chrome-top` plus `--chrome-air` at the
  top, `--chrome-bottom` plus a screen's worth of air at the bottom — and **a
  screen's own header adds no top padding of its own**. That measures the same
  distance twice, and is what used to slide the entry title under the floating
  back button. A new screen inherits the right top edge by having no opinion
  about it.
- **`--toolbar-pad` and `--chrome-air` are two numbers, not one.** The pad is
  the air around the button *inside* the top bar; the air is the gap between
  that bar and the page's first line. Growing the pad to buy the gap looks
  right at rest and then hands you a 90px slab of glass the moment you scroll.
- **Nothing goes under the composer bar. `--bar-bottom` is `0px`.** Not our
  own pad, not `env(safe-area-inset-bottom)`, not a `max()` of the two — that
  inset reserves the whole 34pt band around the home indicator, and any
  fraction of it floats the bar a thumb's width up the page. The pill's lower
  edge is the phone's lower edge and the indicator draws across it, which is
  what Apple's own bottom bars do. The suite pins this: the bar's
  `padding-bottom` must be `0`, its rect must reach `innerHeight`, and no
  stylesheet may mention `safe-area-inset-bottom` at all.
  (`0px`, never `0` — `--bar-h` adds it inside a `calc()`, where a bare
  `<number>` is not a `<length>` and quietly invalidates every screen's
  padding shorthand.)
- **The top inset is not the same question.** `env(safe-area-inset-top)` stays
  in `--chrome-top`. The page already draws *under* the status bar — that is
  what `black-translucent` buys — and the inset only steps the toolbar buttons
  and the first line of type out from behind the clock. Removing it does not
  make the app more full-bleed; it puts the title under the time.
- **No borrowed system blue.** iOS supplies three highlights of its own and
  the app suppresses all three: the tap flash (`-webkit-tap-highlight-color`,
  declared on `html` so links and form controls inherit it — they do not
  inherit it from `body`), the long-press callout, and the text-selection
  wash, which is `--selection`, an ink tint rather than the phone's accent.
  The fourth was ours: `#screen` is `inset: 0` and `app.js` focuses it on
  every navigation for screen readers, so the global `:focus-visible` ring
  drew a blue rectangle around the whole phone. It keeps `tabindex="-1"` and
  loses the outline. **The ring itself stays** everywhere else — it is how a
  keyboard user knows where they are.
- Nothing is sized at the point of use. A glyph is `--icon` or `--icon-sm` at
  `--stroke`; a press is `--press`; a spacing value is a step on the 4pt
  scale. `--s-05` is the one half-step, for optical work next to type only.
- No inline `style=` in the JS. If a thing needs a width, it needs a class.
- Do not add a dependency without asking. Having none is a property of this
  app, not an accident.
