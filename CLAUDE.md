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
index.html          entry point, PWA meta, SW registration
manifest.webmanifest  } together, these make the URL installable
icons/                }
sw.js               the offline guarantee — nothing else provides one
css/tokens.css      the entire visual language — every value lives here
css/base.css        reset, @font-face, focus, reduced motion
css/app.css         every component
fonts/              DM Sans, variable, self-hosted (two files, all weights)
js/app.js           boot, hash routing, the composer bar, the keyboard
js/gate.js          the password screen — read its header before calling it
                    security
js/store.js         every entry; the ONLY file that touches localStorage
js/ui.js            el(), icon(), dates, toast, menu — the shared vocabulary
js/home.js          the list
js/entry.js         reading and writing one entry  ← the subtle file
js/calendar.js      the month, coloured by mood
js/backup.js        export/import — the thing standing between this journal
                    and an iOS storage sweep
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
her. The answer already in the app is **Export** (the ⋯ menu on the list):
one JSON file, into iCloud Drive or the repo. Import merges it back, keeping
whichever copy of an entry was edited later, so moving to a new phone works.

**Entries never leave the browser they were written in.** There is no server.
The repo ships the app, never the journal.

---

## The password

`js/gate.js` — **read its header before describing it as security.** The repo
is public, so the check runs on the reader's own machine and can be stepped
over in the dev tools. It is a deterrent.

What makes that acceptable is that there is nothing behind it: entries are on
the device, not in the repo, so a stranger who finds the URL and guesses the
password sees an empty journal, their own. The real risk it does address is
somebody picking up an unlocked phone — hence the re-lock after five minutes
in the background.

The password is **`digijournal`**. Change it: the header of `gate.js` has the
exact command to regenerate `SALT_HEX` and `HASH_B64`.

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

### Getting it onto the phone

Safari → the URL → Share → **Add to Home Screen**. Once.

**What a deploy CANNOT change is the launch chrome.** The status bar style,
the icon, the app name and `display: standalone` are read by iOS at Add to
Home Screen time and frozen into the shortcut. A change to
`apple-mobile-web-app-status-bar-style` has no effect on an icon created
before it — the only fix is to delete the icon and add it again.

If a change appears not to land: `sw.js` is network-first, so it serves the
cache only when the network fails. A stale screen means the request failed,
not that the cache is stuck. Bumping `VERSION` in `sw.js` drops every cached
byte and is the blunt instrument if one is ever needed.

---

## Testing

`tools/test.html` drives the real app in an iframe — the gate, writing,
publishing, drafts, mood, the calendar, export/import, tap-target sizes and
horizontal overflow. 66 checks.

**It erases this browser's journal before it runs**, so it does nothing until
told: open it and press the button, or load it with `?run=1`.

```sh
python3 -m http.server 8777 --bind 127.0.0.1   # then open:
#   http://127.0.0.1:8777/tools/test.html
```

Headless, it posts its results to a server that accepts POST — the plain
`http.server` above will 501 the beacon, so read the results in a browser
unless you stand up something that accepts it.

**Do not test the gate under `--virtual-time-budget`.** It fast-forwards the
clock past the 200k-iteration PBKDF2, and every assertion after it lies.

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
- Do not add a dependency without asking. Having none is a property of this
  app, not an accident.
