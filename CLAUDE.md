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
index.html          entry point, the Apple metas that make the URL
                    installable, the two module tags, and four inline lines
                    that apply the chosen palette before the first paint.
                    There is deliberately NO web app manifest — read the
                    note in its head
icons/              the homescreen icon; iOS reads icon-180.png
sw.js               the offline guarantee — nothing else provides one
js/update.js        how a deploy reaches the phone — registers the worker
                    and reloads the app when the files really changed
css/tokens.css      the entire visual language — every value lives here,
                    including all eight palettes
css/base.css        reset, @font-face, focus, reduced motion
css/app.css         every component
fonts/              DM Sans, variable, self-hosted (two files, all weights)
js/app.js           boot, hash routing, the composer bar, the keyboard
js/store.js         every entry; the ONLY file that touches localStorage
js/ui.js            el(), icon(), dates, toast, menu — the shared vocabulary
js/home.js          the list, with today's rating card above it
js/entry.js         reading and writing one entry  ← the subtle file
js/mood.js          the rating card. It rates a DAY, and lives on the list
js/calendar.js      the month, coloured by mood
js/theme.js         which palette the app is wearing — names only, never
                    colours; and the one thing CSS cannot reach, the
                    status bar
js/settings.js      one screen for everything that is not an entry: the
                    palette picker, and signing in. The only screen in the
                    app that knows there is a server
js/config.js        the Supabase URL and anon key. Both are public by design;
                    the RLS policy is what makes that safe
js/net.js           Supabase over plain fetch — the five requests, by hand,
                    so the app still has no dependencies
js/sync.js          the journal on more than one device
supabase/schema.sql the entire server side: one table, one policy. Not served
                    to anyone — it is run once in the Supabase SQL editor
tools/test.html     the headless suite (see Testing)
tools/edges.html    what the phone will actually give the app — add it to the
                    homescreen and screenshot it when an edge is wrong. It
                    carries the same launch chrome as index.html on purpose;
                    opened in a Safari tab it measures a different app
```

### The data model

```js
{ id, title, body, day, createdAt, updatedAt, published, deletedAt }   // an entry
{ day, mood, updatedAt }                                              // a rating
```

`day` is the calendar day the entry is **about**, fixed at creation.
`updatedAt` is when it was last touched. They are deliberately separate: the
list sorts and dates by `updatedAt`, the calendar plots by `day`. Fixing a
typo in Monday's entry on Friday must not move Monday's entry to Friday.

**The rating is a property of the day, not of an entry** — separated on
13 Aug 2026. It used to be a `mood` column on the entry, which meant rating a
day you never wrote about had to invent a blank draft to hold the rating, and
writing twice on one day gave the day two moods and a tiebreak to pick
between them. One row per day, keyed by the day, is the shape the thing
actually has. The consequences, all of them wanted:

- **The card wears the rating; the faces do not.** `data-mood` on the
  radiogroup sets one custom property, `--mood-rgb`, and the pane's wash, the
  chosen swatch's fill and its glow are all an alpha of it — so a rated day
  has one colour instead of five options having one each. The tokens it is
  mixed from are declared for `.mood` as well as `:root`, because a custom
  property inherits its *substituted* value: declared only at the root they
  would resolve against the ink before the card had an opinion, and every
  rating would paint grey. How dense the wash may be is set by the card's own
  type clearing 4.5:1 on it, and by nothing else.
- The card is on **the list**, above the journal, and rates **today** only.
  There is no way to go back and colour in last Tuesday; the calendar is a
  record, not a form.
- Rating a day writes no entry, and deleting a day's entry leaves the day's
  colour alone.
- The calendar carries two independent facts per cell: the **fill** is the
  rating, the **ring** is that something was written.
- A dot on a list row is that entry's **day's** rating, which is why two
  entries written on one day wear the same one.
- A rating is never deleted, only set to `null` with a fresh `updatedAt` —
  that row is how "I cleared this" reaches the other device, the same job the
  tombstone does for an entry. Ratings are not swept.
- `SCHEMA` is 2. A journal written before the split still has a `mood` on each
  entry, and `adopt()` folds those into day ratings on the one load that finds
  them, so no history is lost.

A **draft** is `published: false`. It is not a separate species — it is a row
in the list with a quiet flag on it. An untouched draft (no title, no body) is
swept away when you leave it, so tapping "Start writing…" and changing your
mind leaves nothing behind. `isEmpty()` asks about words alone now — a rating
is no longer something an entry can be holding.

**`deletedAt` is what sync cost the model.** Deleting no longer removes the
entry from the array — it blanks the text and stamps `deletedAt`, leaving a
**tombstone**. Every read in `store.js` goes through `live()`, so a deleted
entry is gone from the list, the calendar and `get()` exactly as before; what
changed is that there is now a row saying *it was deleted* rather than the
entry simply being absent. Without one, the iPad still holds the entry, sees
the phone doesn't, and helpfully sends it back on the next round.

Tombstones are swept for good after `DELETED_TTL` (90 days) — long past when
a phone could plausibly have been in a drawer since before the deletion.
The one hard delete left is `discardIfEmpty()`, and it is safe because an
empty unpublished draft is never pushed in the first place (see `pushable()`).

### The palette

Eight of them: `paper` — off-white and off-black, the default — and the seven
plastics the iMac came in, Bondi Blue (1998), Blueberry, Grape, Tangerine,
Lime and Strawberry (1999), Graphite (2000).

**Two of them wear a different name than their id.** `grape` is offered as
**Lavender** and `lime` as **Forest**, which is what they were re-hued into on
12 Aug 2026. The ids did not move and must not: the id is what is written down
under `digijournal.palette`, so renaming one turns a phone's saved choice into
an unrecognised palette and the app opens in Paper instead. A name is free to
change; an id is a phone's memory of a choice. `tokens.css` and the suite both
key on the ids.

**A palette is a set of tokens swapped on `<html>`, and nothing else.**
`js/theme.js` puts a `data-palette` on the root; `[data-palette='lime']` in
`tokens.css` wins and the whole app repaints. No view holds a colour, so
nothing has to be told to reconsider one — there is deliberately no
`dj:palette` event.

Each palette declares **eleven** values and no more. The hairlines, the glass,
the shadows, the scrim, the selection wash and `--mood-none` are all derived
from those with an alpha of `--ink-rgb` or `--glass-rgb`, so a hairline on
Grape is grape and a new palette cannot forget to tint its own shadows.

**`--accent` and `--accent-deep` are two different colours on purpose.**
`--accent` is a FIELD — what a Publish button is filled with — and is allowed
to be as bright as the plastic. `--accent-deep` is a MARK on paper: a link,
the focus ring, the pencil. Tangerine cannot be one token, because a tangerine
bright enough to be a tangerine button is 2.3:1 on paper. On Bondi, Tangerine
and Grape the two differ; everywhere else they are the same colour. Lime used
to be in that group and left it when it became a forest green — a green that
dark is already both. Grape joined it going the other way: a lavender pale
enough to read as lavender is nowhere near a mark on paper.

**The mood ramp does not change with the palette.** It is data, not chrome — a
year of Mondays in the calendar has to mean the same thing in Lime as it did
in Blueberry. All five steps clear 4:1 on all eight papers, which is measured,
not assumed.

**Every number in `tokens.css` was solved for, not picked.** Each palette's
ink lands at 15:1 on its own paper in *both* schemes, `--ink-2` at 5.7:1 light
and 7.5:1 dark, `--ink-3` at 5:1 light and 6:1 dark against the darkest ground
it ever sits on. That is why the eight papers do not read as eight different
levels of legibility. The suite re-measures all of it from the computed values
— see Testing.

**The dark papers commit to their colour.** A first pass sat them all near
black and every one came back as mud; they are held at a lightness where the
page still reads as dark but with enough chroma to be a colour. `paper` is the
exception and stays the near-black it is named for — a plain background is
what it is *for*.

**The dark grounds came down a stop on 12 Aug 2026**, at Zoe's ask: every dark
paper, well and card is about half the luminance it was. The hue and the
chroma were held while the lightness fell, which is the whole trick — dropping
lightness alone is how the first pass turned into mud. Dark body text used to
sit at 13.5:1 against the 15:1 it got in the light; the darker grounds bought
that back, and `--ink-2` and `--ink-3` were **re-solved** against the new
papers rather than left where they were, so the three grades of ink stay the
distance apart they were solved for instead of flattening as the ground fell.

**The choice is a property of the phone, not of the journal.** It lives under
`digijournal.palette`, it does not sync, signing out does not undo it, and
`store.clearJournal()` leaves it alone.

**The two things that are easy to get wrong:**

- **The status bar.** Under `apple-mobile-web-app-status-bar-style: default`
  that strip is iOS's, above the web view, painted from `theme-color` alone —
  **no stylesheet reaches it.** `theme.js` replaces the two static metas with
  one it keeps equal to `--paper`. Whether iOS re-reads it while a homescreen
  app is running is not documented by Apple; if it doesn't, the bar catches up
  on the next launch.
- **The first paint.** `js/app.js` is a module, so it runs after layout —
  long enough for a Blueberry install to flash cream on every launch. The four
  inline lines in `index.html` are what buy that frame back. They are the only
  code outside `store.js` that touches storage, they only ever read, and
  deleting them would leave the app correct and one frame uglier.

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
| every entry, again | Supabase, once signed in | yes |
| the session | `localStorage['digijournal.session']` | no, and fine |
| the sync watermarks | `localStorage['digijournal.sync']` | no, and fine |
| the app itself | files in the repo, cached by `sw.js` | yes |

The second row arrived on 12 Aug 2026 and is what closes the hole the rest of
this section describes. **It does not change the first row.** localStorage is
still what every screen reads and writes; Supabase is a mirror `sync.js`
pushes to and pulls from behind the screen that is already up. Nothing on the
writing path waits for a network, and signed out the app is exactly what it
was before any of it existed.

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

**Signing in is what makes any of that survivable.** Once there is a session,
every entry is mirrored to Supabase, so a swept storage, a lost phone or a new
one all end the same way: sign in, and the journal comes back. Signed out,
everything above still applies in full and the entries live on one device
alone.

Export and import were removed from the UI on 11 Aug 2026 at Zoe's request,
along with the ⋯ menu that held them. `store.exportBundle()` and
`store.importBundle()` survive in `store.js` and the suite still covers them
— restoring the feature is a menu and two handlers, not a rewrite. Do not add
it back on your own initiative.

**Entries do leave the phone now, and that is the point.** What that costs
her, said plainly and not buried: the journal exists on Supabase's servers,
readable in their dashboard by anyone holding that account. Protecting the
Supabase login is now as load-bearing as the phone's passcode. The alternative
— end-to-end encryption — was offered and declined on 12 Aug 2026, because a
forgotten passphrase would have meant the journal was gone with no reset.

**The repo still ships the app, never the journal.** No entry is ever in git.

---

## There is no password

The gate was removed on 12 Aug 2026 at Zoe's request — `js/gate.js` and its
stylesheet block are gone, and the app opens straight onto the list. It had
been a deterrent rather than a lock in any case: the repo is public, so the
check ran on the reader's own machine and could be stepped over in the dev
tools.

**What that costs: anyone holding the unlocked phone can read the journal.**
That was the one real risk the gate addressed, and it is now the phone's
passcode's job alone. A stranger who finds the URL still sees an empty
journal, their own — entries are not in the repo, and the RLS policy means
the shipped key cannot reach anyone else's.

**Sync did not put the gate back, and must not be allowed to.** There is now
a password field in the app, on `#/settings`, and it is a door rather than a
gate: a cold launch still opens straight onto the list whether or not anyone
has ever signed in. Four checks in the suite hold that line — if a change
ever makes `boot()` await a session, they are the ones that will fail, and
they are right and the change is wrong.

Do not add the gate back on your own initiative. If it is ever wanted again,
it is one module and one `await` in `boot()`; `git show 3e2f1f3:js/gate.js`
has the last version, password `digijournal`.

---

## Syncing

Added 12 Aug 2026. The project is `uwfskykrayezjcazmlrw`; `supabase/schema.sql`
is the whole server side.

**It is now two tables, and the second one has to be created.** `days` holds
the ratings, and `schema.sql` must be pasted into the Supabase SQL editor and
run again before they leave the phone. Until it is, the entries sync exactly
as before and the ratings stay on the device that made them — `syncRatings()`
steps over a missing table rather than failing the round, so nothing looks
broken and nothing is lost locally.

**RLS is the only lock there is.** The anon key ships in `js/config.js`, in a
public repo, and anyone can read it out of the running page in ten seconds.
That is safe for exactly one reason: the policy scopes every row to
`auth.uid()`, so the key gets a stranger as far as "prove who you are" and no
further. Measured against the live project, not assumed — an anonymous read
returns `[]`, an anonymous write is refused with `42501`, and signups are
closed. **If that policy is ever dropped, the key becomes a skeleton key to
every entry.** Two checks in the suite guard the schema file and two more
guard the key itself; `service_role` must never appear in the repo. **Both
tables are checked**, not just the first — a table added later without a
policy of its own is the one way the shipped key stops being safe to ship.

**Last edit wins, per entry.** The same rule `importBundle` always used, and
the only one that behaves after a phone has been offline. What it costs:
editing the *same* entry on two devices while one is offline loses the older
edit, silently. Underneath it is an assumption about clock skew — `updatedAt`
is written by whichever device made the edit — which `SKEW` (2 minutes) is
sized to absorb.

**The open entry is never overwritten.** `app.js` tells `sync.js` which entry
is mounted and `mergeRemote` steps over it. Without that, a round landing
mid-sentence replaces the paragraph under the caret with the server's older
copy and the next keystroke is typed into it.

Three smaller things worth not rediscovering:

- **`sw.js` never sees a Supabase request** — it returns early on any
  cross-origin URL, so nothing about sync is cached or replayed.
- **Push watermarks advance past pulled rows.** A row that arrived *from* the
  server is already on it; without `pushedThrough` moving past it, every round
  echoes the other device's entries straight back.
- **A different account clears the journal first.** The entries in storage
  belong to whoever was signed in before, and merging one person's journal
  into another's account is the worst bug this app could have.

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

**`black-translucent` is what cost the bottom of the screen, and it is not
coming back.** It is the obvious-looking way to draw under the status bar and
it does do that — by making the web view the screen's height *minus the
status bar* and anchoring it at the top. An equal strip at the bottom then
belongs to nobody, and iOS paints it with the theme colour. Measured on the
phone, in points:

```
screen          393 x 852
window.inner    393 x 793     ← 59 short
fixed bottom:0  lands at 793  ← the composer, 59 above the screen's edge
```

**59 is the status bar's height, not the home indicator's 34** — that
arithmetic is how you recognise it, and `viewport-fit=cover` does not rescue
it. `default` lays the view out below the status bar and runs it to the
physical bottom instead. The top does not move: the 59pt inset that was
pushing the first line down is replaced by the status bar drawn in the same
space, `env(safe-area-inset-top)` reads 0, and `--chrome-top` stops paying
for it on its own. The status bar takes the `theme-color` metas, which are
`--paper` in both schemes, so it does not seam.

**If a band ever appears again, suspect the shortcut before the CSS.** It is
off-white in light and navy in dark whatever is causing it — every candidate
paints in the page's own colour, so the colour identifies nothing. The five:

| what | where | who can fix it |
|---|---|---|
| `black-translucent` | the status bar meta — it must be `default` | a deploy, then re-adding the icon |
| a linked web app manifest | `index.html` — there must not be one | a deploy, then re-adding the icon |
| `viewport-fit=cover` missing | the viewport meta | a deploy, then re-adding the icon |
| `--kb` lifting the bar when no keyboard is up | `app.js` | a deploy alone |
| `--bar-bottom` | `tokens.css` — the indicator's band via `max()`, never summed with a pad | a deploy alone |

The first three are read by iOS at Add to Home Screen time and frozen into
the shortcut, so **fixing them in the repo is only half the job — the icon
has to be deleted and added again** before the change reaches the phone.

Do not reason about which one it is from a screenshot. `tools/edges.html`
answers it in one reading, and its verdict line now names the
black-translucent signature specifically. Three rounds were lost to guessing
before it existed.

Keep the viewport meta to `viewport-fit=cover` and nothing else. It used to
also carry `interactive-widget=resizes-content`, which is a Chrome feature
that did nothing on the only device this app targets, and an unrecognised
directive sitting next to the one that matters is a risk with no upside.

**There is no web app manifest, and adding one back will bring the band
back.** A linked manifest takes iOS down its modern path, where the manifest
configures the app and `apple-mobile-web-app-status-bar-style` is ignored.
The app is still standalone — but the web view is laid out *inside* the safe
area, and iOS fills the leftover strip around the home indicator with the
theme colour itself. That is a block of off-white in light and navy in dark
sitting under the composer, and **no stylesheet can reach it**: it is screen
the app was never given.

Everything the manifest carried is in the Apple metas instead — standalone
from `-capable`, the name from `-title`, the icon from `apple-touch-icon`.
What was genuinely lost: the portrait lock, and installability on Android and
desktop. Neither is a target; the iPhone homescreen is the only one.

If a change appears not to land: `sw.js` is network-first, so it serves the
cache only when the network fails. A stale screen means the request failed,
not that the cache is stuck. Bumping `VERSION` in `sw.js` drops every cached
byte and is the blunt instrument if one is ever needed — it drops *files*,
never entries.

Network-first was not sufficient on its own. GitHub Pages sends `max-age=600`,
so "go to the network" could be answered by Safari's own HTTP cache with a
build ten minutes old — indistinguishable from a deploy that failed. The
worker now fetches the app's own source (`.html`, `.css`, `.js`) with
`cache: 'no-cache'`: always ask the server, and let it
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
what was being typed and gives the whole journal back afterwards.

The rating card is exercised where it now lives: that it is on the list and
not on the entry, that rating a day with an empty journal writes no entry and
leaves the list empty, that clearing travels between devices as a null, that
deleting a day's entry leaves the rating standing, and that an old entry's
mood is adopted as its day's rating.

Sync added a second half: that a delete leaves a tombstone the app never shows
and sync always pushes, that the later edit wins from either direction, that a
deletion cannot be undone by an older copy, that a round landing mid-sentence
leaves the open entry alone, that an untouched draft is never pushed, that the
sync screen is a door off the list rather than a gate in front of it, that the
shipped key decodes to `role: anon`, that `schema.sql` still enables RLS with
both `using` and `with check`, that every import is still a relative file in
this repo, and that a different account starts empty. **295 checks.**

**The suite cannot see an edge problem.** It runs in a browser that reports
no safe-area inset, so it pins our own arithmetic and nothing else — every
bottom check can pass while the phone still keeps a band. `tools/edges.html`
is the instrument for that half: add it to the homescreen and read it there.
Three rounds were spent guessing at that band from screenshots before it
existed; do not spend a fourth.

The browser it runs in reports **no safe-area inset**, which is the point for
the bottom checks — it pins the case where nothing external is padding the
bar, so the only thing that can float the composer is our own CSS.

The half the suite can't reach is update *detection*, which needs a server
whose files can change mid-run. That was verified separately with a throwaway
harness and a POST hook that touches a stylesheet: an unchanged deploy does
not reload, a changed one does, and one that arrives while the caret is in a
field waits until the field is blurred.

**The suite never signs in and never touches the network.** It exercises the
sync *rules* — tombstones, the merge, the guard, the watermarks — against the
store directly, which is where the logic that can be wrong actually lives. It
cannot tell you the policy on the live project is correct. That was measured
separately with curl, and is worth repeating after any change to
`schema.sql`: an anonymous read must return `[]`, and an anonymous insert must
be refused with `42501`.

```sh
URL=https://uwfskykrayezjcazmlrw.supabase.co; KEY=<the anon key from config.js>
curl -s "$URL/rest/v1/entries?select=id&limit=5" -H "apikey: $KEY"     # []
curl -s -X POST "$URL/rest/v1/entries" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' -d '[{"id":"probe","user_id":"00000000-0000-0000-0000-000000000000","day":"2026-08-12","created_at":1,"updated_at":1}]'
# {"code":"42501", ... "violates row-level security policy" ...}
```

**It erases this browser's journal before it runs**, so it does nothing until
told: open it and press the button, or load it with `?run=1`.

```sh
python3 -m http.server 8777 --bind 127.0.0.1   # then open:
#   http://127.0.0.1:8777/tools/test.html
```

Headless, it posts its results to a server that accepts POST — the plain
`http.server` above will 501 the beacon, so read the results in a browser
unless you stand up something that accepts it (twenty lines of
`socketserver`, with `allow_reuse_address` or the second run dies on the port
the first one is still holding).

**Never launch Zoe's Chrome.** She works with tabs open and a headless run out
of `/Applications/Google Chrome.app` is not worth the risk of disturbing them.
Use the Playwright headless shell already on the machine, which is a wholly
separate binary:

```
~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

Two things about driving it. **Give it a throwaway `--user-data-dir` each
time** — reusing one serves `test.html` from its own HTTP cache and you will
spend an hour reading the results of the edit before last. And **do not use
`--virtual-time-budget`**: it kills the page before an async suite full of
real `await`s and real fetches has finished, and you get silence rather than a
failure. Launch it in the background, poll the results file for the verdict
line, then kill it.

---

## Accessibility

The contrast ratios in `tokens.css` are **measured**, not estimated. Body text
clears 4.5:1 and non-text UI clears 3:1 in both schemes. If you change a
colour, re-measure it — do not eyeball it.

Colour is never the only channel: a mood dot in the list is paired with a
`.sr-only` label naming whose rating it is ("That day: Good"), and a calendar day keeps its numeral on top of the fill.
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
- **The composer's floor is the home indicator's band, and nothing more.**
  `--bar-bottom` is `max(var(--s-3), env(safe-area-inset-bottom))`. The
  capsule floats, so it *clears* the indicator rather than sharing it — that
  band is a live gesture target, and a 44pt control overlapping it gives its
  lower third away to the system. On a device with no indicator the inset is
  0 and the 12pt takes over, so the capsule never sits on the glass edge.
  **`max()`, never a sum.** The inset *is* the clearance; adding our own pad
  on top of it is what floats the bar a thumb's width up the page. The suite
  pins all of it: the bar element's rect must still reach `innerHeight`, the
  capsule must clear the edge by exactly `padding-bottom`, and
  `safe-area-inset-bottom` may appear in exactly one declaration, inside a
  `max()`.
  This was `0px` for one deploy while the bottom of the screen was being
  hunted. **It was never the cause** — see the status bar note above. Do not
  reach for it again when an edge looks wrong; reach for `tools/edges.html`.
  (Whatever the value, a bare `0` is not one — `--bar-h` adds it inside a
  `calc()`, where a `<number>` is not a `<length>` and quietly invalidates
  every screen's padding shorthand. `0px` if it ever must be zero.)
- **`--kb` is a keyboard, not a measurement.** Both `.bar` and `.screen` sit
  on it, so any stray value lifts the composer off the bottom edge and leaves
  a band of bare `--paper` under it — which looks exactly like iOS padding
  the app, and is not. `window.innerHeight` and `visualViewport.height` do
  not reliably agree by zero on iOS, so `app.js` acts on the difference only
  when something focusable is focused *and* the gap clears `KEYBOARD_MIN`.
  Never set `--kb` straight from a measurement.
- **`env(safe-area-inset-top)` stays in `--chrome-top`, and reads 0 today.**
  Under `default` the status bar has its own space above the web view, so
  there is no unsafe area inside it and the term costs nothing — the first
  line sits 76pt down, below a status bar iOS draws in `--paper`. Leave the
  term in. It is what makes the same stylesheet correct on a device or a
  future iOS that *does* hand the app that strip, without anyone having to
  notice the difference. What it must never do is measure the same distance
  twice: the inset, then a screen header's own top padding on top of it.
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
