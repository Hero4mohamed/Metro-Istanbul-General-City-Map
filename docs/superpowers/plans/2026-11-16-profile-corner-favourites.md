# V4.7 Profile corner and favourite places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-right profile button + sheet for the account and friends; the Friends tab keeps only location sharing and gains device-only Favourites.

**Architecture:** One new source file `src/22e-favourites.js` (pure store in a `FAV-PURE` region + page wiring) placed before `25-map-keyboard.js`. The existing `22c-account.js` / `22d-friends.js` keep their logic; only where things render changes (new `.fr-share-box` / `.fr-list-box` containers, a new `profile` sheet on phones and `#profilePanel` on computers). Save buttons are added to the existing pin pop-up (`dropPin`) and station panel (`#stn`).

**Tech Stack:** Plain browser JS concatenated by `transit_data/build.cjs`, Leaflet, `node:test` + `vm` sandboxes (`testkit/helpers.cjs`), mutation rows in `testkit/verify-suite.cjs`.

**Spec:** `docs/superpowers/specs/2026-11-16-profile-corner-favourites-design.md`

## Global Constraints

- Edit `transit_data/src/*.js`, `transit_data/app.template.html`, `transit_data/legal-content.cjs`; never `index.html` (rebuild with `npm run build`).
- `25-map-keyboard.js` stays the LAST source file; the new file is `22e-favourites.js`.
- Every new visible string exists in `I18N.en`, `I18N.tr` and `I18N.ar` (`src/01-i18n.js`).
- Every `localStorage` key has a STORAGE row in `legal-content.cjs` (EN+TR); new key: `irn_favplaces`, `personal: true`.
- Favourites make NO network request (save, list, open, rename, remove).
- Error codes / own identifiers lower case; no method shorthand in objects (`show: x => {}`); no inline handlers (CSP) — delegate clicks with `data-*` attributes.
- `irn_home`, `irn_work`, `irn_favourites` (saved routes) keep their format and meaning.
- After renaming any test, grep `testkit/verify-suite.cjs` for the old name; run the counted stale-anchor scan written to a file.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; branch `v4-7`; PR, merge only on the owner's "merge once green".

## Review Focus

1. A corrupt or hand-edited `irn_favplaces` (not JSON, not an array, entries missing lat/lng) — the list must show the valid ones and never throw (Task 1 test).
2. Names with HTML/quotes in a favourite or a dropped-pin name — escaped everywhere (Task 3 test).
3. A 320 px wide phone — the search input stays at least 150 px wide with the profile button beside it (Task 5 CSS test + browser check).
4. Signing out while the profile sheet is open — the friends list empties and positions stop being read (Task 4 test).
5. A right-drag that turns the map on a computer must not drop a pin; only a still right-click does (Task 2 test).

---

### Task 1: The favourites store (pure)

**Files:**
- Create: `transit_data/src/22e-favourites.js`
- Modify: `transit_data/legal-content.cjs` (STORAGE row after `irn_favourites`)
- Test: `transit_data/test/v47.test.cjs` (new; reuse the `region()` + `vm` pattern of `v463.test.cjs`)

**Interfaces:**
- Produces (inside `/* ==FAV-PURE-START== */ … /* ==FAV-PURE-END== */`):
  - `const FAV_KEY = 'irn_favplaces', FAV_MAX = 200, FAV_SAME_M = 30;`
  - `favLoad() -> Fav[]` — reads `localStorage[FAV_KEY]`; non-JSON / non-array → `[]`; drops entries without finite `lat`/`lng` or empty `name`.
  - `favSave(list: Fav[]) -> void`
  - `favFind(list, p:{name,lat,lng}) -> Fav|null` — same `name` (trimmed, case-insensitive) within `FAV_SAME_M` metres.
  - `favAdd(list, p:{name,lat,lng,kind,ic,ctx,city}, now:number) -> {list, fav, dropped:boolean}` — returns the existing one if `favFind` hits; new `id` = `'f' + now.toString(36) + random 4 chars`; newest first; over `FAV_MAX` drops the oldest and sets `dropped`.
  - `favRemove(list, id) -> Fav[]`, `favRename(list, id, name) -> Fav[]` (trim, max 60 chars, empty name ignored).
  - `Fav = {id, name, lat, lng, kind:'place'|'station'|'pin', ic, ctx, city, saved}`

- [ ] **Step 1: Write the failing tests** in `test/v47.test.cjs`:
  - `fav: a missing, broken or non-array store reads as an empty list` — store values `undefined`, `'{oops'`, `'{"a":1}'` → `[]`.
  - `fav: entries without a name or coordinates are skipped, the rest kept` — `[{id:'a',name:'',lat:1,lng:1},{id:'b',name:'X',lat:'n',lng:1},{id:'c',name:'Ok',lat:41,lng:29}]` → ids `['c']`.
  - `fav: adding the same place twice keeps one; a different name at the same spot is a new one` — add `{name:'Moda Cafe',lat:40.98,lng:29.02}` twice → length 1; `'moda cafe '` at 20 m → length 1; `'Moda Park'` same spot → length 2.
  - `fav: newest first; past 200 the oldest is dropped and reported` — add 201 → length 200, first is the 201st, `dropped === true`.
  - `fav: rename trims, caps at 60 characters and ignores an empty name; remove deletes only that id`.
  - `fav: the store makes no network request` — sandbox `fetch` that throws; run load/add/save/rename/remove; no throw.
- [ ] **Step 2: Run** `node --test transit_data/test/v47.test.cjs` — Expected: FAIL ("the FAV-PURE block is missing").
- [ ] **Step 3: Implement** the functions above in `22e-favourites.js` (metres via the same equirectangular formula as `posMeters` in `22d-friends.js`). Add the STORAGE row: `{ key: 'irn_favplaces', en: 'Your favourite places: name, coordinates, type and city.', tr: 'Favori yerleriniz: ad, koordinatlar, tür ve şehir.', when: 'You save a place. Personal.', whenTr: 'Bir yeri kaydettiğinizde. Kişisel.', personal: true }`. Add `'irn_favplaces'` to the forbidden list in `test/hardening.test.cjs:125` and the personal-keys regex in `test/privacy.test.cjs:181`.
- [ ] **Step 4: Run** `npm run build && npm test` — Expected: all pass (legal storage pages regenerate with the new row).
- [ ] **Step 5: Commit** `feat(v4.7): device-only favourites store`.

### Task 2: Saving — pin pop-up, station panel, dropped pin

**Files:**
- Modify: `transit_data/src/19-assistant.js` (`dropPin` pop-up actions; the `[data-pin]` click delegate)
- Modify: `transit_data/app.template.html` (`#stn .rowbtns`: add `<button id="stnFav" data-fav-toggle>`)
- Modify: `transit_data/src/22e-favourites.js` (page part, after `FAV-PURE-END`)
- Test: `transit_data/test/v47.test.cjs`

**Interfaces:**
- Consumes: Task 1 store.
- Produces: `favToggle(p) -> boolean` (saved after?), `favIsSaved(p) -> boolean`, `favChanged()` (re-renders every `.fav-box` and every visible ☆/★ button; Task 3 hooks the list into it), `dropPinAt(latlng)` (names the pin `t('favPinName')` + coordinates to 3 dp, `kind:'pin'`, `ic:'📍'`), `favAskName(def, cb)` (small inline dialog `#favNameDlg`, Enter saves, Escape cancels).

- [ ] **Step 1: Failing tests:**
  - `fav ui: the place pop-up has Save beside Route from, Route to and Near here` — `dropPin` source contains `data-pin="S"`.
  - `fav ui: the station panel has a Save button` — template has `id="stnFav"` inside `#stn .rowbtns`.
  - `fav ui: a dropped pin is offered on a long press or a still right-click, never after turning the map` — `22e` registers `map.on('contextmenu'` and checks the turn flag (expose `turnMoved` from `07z-map-turn-input.js`: true when the last right-button gesture rotated the map); sandbox: `turnMoved=true` → no pin; `false` → `dropPin` called with `kind:'pin'`.
  - `fav ui: saving a dropped pin asks for its name; the name is stored escaped-safe` — saving with name `<b>"x"` stores the raw text; rendered pop-up contains `&lt;b&gt;`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Pop-up: add `<button data-pin="S">☆ {favSave}</button>` (★ {favSaved} when `favIsSaved(pinPlace)`); the delegate handles `S` by `favToggle(pinPlace)` (pins of `kind:'pin'` go through `favAskName` first). Station: `#stnFav` toggles the selected station (`kind:'station'`, `ic:'🚉'`, `ctx` = its line refs). `favToggle` shows a toast `favAdded` / `favRemoved` and `favDropped` when the cap dropped one. Pop-up places carry `ic`, `ctx` from the search result (`p.ic`, `p.ctx`), `city: CITY_ID`.
- [ ] **Step 4: Run** `npm run build && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(v4.7): save places, stations and dropped pins`.

### Task 3: The favourites list

**Files:**
- Modify: `transit_data/src/22e-favourites.js`, `transit_data/app.template.html` (`#cardFriends`: `<div class="fav-box"></div>` after the share box; CSS for `.fav-row`, `.fav-menu`), `transit_data/src/02-settings.js` (`useSavedPlace` → generalise to `goToPlace(p)`), `transit_data/src/17-boot.js` (read `?fav=`)
- Test: `transit_data/test/v47.test.cjs`

**Interfaces:**
- Consumes: Task 1–2, `homePlace`, `workPlace`, `setPlaceFromOrigin`-style writers, `switchCity(id)` (reloads the page), `dropPin(p, zoom)`, `openSheet(name)`.
- Produces: `favListHTML(list, home, work, cityId) -> string` (pure, inside `FAV-PURE`), `renderFavs()`, `goToPlace(p)` (destination = p; route at once if an origin exists, else open the planner — today's `useSavedPlace` body), `favMakeHome(id)`, `favMakeWork(id)`.

- [ ] **Step 1: Failing tests** (on `favListHTML`):
  - `fav list: Home and Work come first, then favourites newest first`.
  - `fav list: empty shows the how-to hint` — contains `favEmpty`.
  - `fav list: a favourite from another city is marked with its city and dimmed` — row has class `fav-other` and the city name.
  - `fav list: names and districts are escaped` — `<img src=x>` never appears raw.
  - `fav list: every row has Go and a menu with Rename, Make Home, Make Work, Remove` — `data-fav-act="go|rename|home|work|remove"`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Row tap (`data-fav-open`): same city → on a phone `setDragDetent(mSheets.friends,'low')`, then `dropPin(fav, 16)`; other city → `switchCity(fav.city)` with `?fav=<id>` added, and boot (`17-boot.js`) opens that favourite once, then `history.replaceState` removes `fav`. Remove asks once inline (`favRemoveAsk` row state). Make Home/Work write `irn_home`/`irn_work` exactly like `setPlaceFromOrigin` and call `renderPlaces()`. `favChanged()` calls `renderFavs()`.
- [ ] **Step 4: Run** `npm run build && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(v4.7): favourites list in the Friends tab`.

### Task 4: The Friends tab keeps only sharing

**Files:**
- Modify: `transit_data/src/22d-friends.js` (`renderFriends` split; new `sharingNowHTML`), `transit_data/app.template.html` (`#friendsBox` → `<div class="fr-share-box"></div><div class="fav-box"></div>`), `transit_data/src/18-mobile-shell.js` (comments only if needed)
- Test: `transit_data/test/v463.test.cjs` (update the "Friends card" UI test), `transit_data/test/v47.test.cjs`

**Interfaces:**
- Produces: `renderShare()` (fills `.fr-share-box` with `shareViewHTML() + sharingNowHTML()` when `accReady()`, else `shareSignInHTML()`), `renderFriendList()` (fills `.fr-list-box` with `friendsViewHTML()`), `renderFriends()` kept as `renderShare(); renderFriendList();` so existing callers still work. `sharingNowHTML()` lists friends with `f.pos`, each `data-fr-fly="<uid>"` → `map.flyTo`. `shareSignInHTML()` = hint `shareSignIn` + button `data-prof-open`.

- [ ] **Step 1: Failing tests:**
  - `friends tab: signed out it shows the sign-in line and no account form` — `.fr-share-box` HTML contains `shareSignIn` and not `acc-form`.
  - `friends tab: signed in it shows Share my location and who is sharing now, not the friends list or Add friend` — contains `data-sh="start"`, not `data-fr="invite"`.
  - `friends tab: the card holds no account box` — template `#cardFriends` has no `acc-box`.
  - `friends tab: signing out empties the friends list and stops reading positions` (Review Focus 4) — sandbox: `onAccountChange` with `acct=null` → `friendPoll` cleared, `.fr-list-box` empty.
- [ ] **Step 2: Run** — FAIL. Update the existing V4.6.3 `ui: on a phone the Friends card lives in its own sheet…` test to the new containers (keep its name; check `verify-suite.cjs` rows that `expect` it still find their anchor).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `npm run build && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(v4.7): Friends tab is location sharing + favourites`.

### Task 5: Profile button, sheet and panel

**Files:**
- Modify: `transit_data/app.template.html` (`#profileBtn` in `.topbar`; `#profilePanel` + `#profileOverlay` beside `#settingsPanel`; CSS), `transit_data/src/18-mobile-shell.js` (`mSheets.profile = mkSheet('profile')`; move `#profileBody` into it; on phones move `#profileBtn` after `.omni-bar`), `transit_data/src/22e-favourites.js` or a new section of `22c-account.js` for `openProfile`, `transit_data/app.template.html` Settings › You (`#accRow` → a row button `data-prof-open` "Account and friends ›")
- Test: `transit_data/test/v47.test.cjs`

**Interfaces:**
- Produces: `openProfile()`, `closeProfile()`, `profileVisible() -> boolean`, `renderProfileBtn()` (initial of `acct.name` / outline icon / class `unconfirmed` when `acct && !acct.verified`), subscribed via `onAccountChange`. `#profileBody` = `<div class="acc-box"></div><div class="fr-list-box"></div>`. Opening calls `renderAccount(); renderFriendList();` and, when `accReady()`, `loadFriends()` — never `startFriendPolling()`.
- Consumes: `openSheet`, `mkSheet`, the settings panel's open/close/focus-trap helpers (reuse, do not copy), `onAccountChange`, `loadFriends`.

- [ ] **Step 1: Failing tests:**
  - `profile: the button is in the top bar with an accessible name, and shows the initial when signed in` — template `id="profileBtn"` with `aria-label`; `renderProfileBtn` with `acct.name='ayşe'` → text `A`.
  - `profile: an unconfirmed account marks the button` — class `unconfirmed`.
  - `profile: the account box and friends list live only in the profile` — exactly one `acc-box` outside `#profileBody` is gone: template `acc-box` count === 1 and inside `#profileBody`.
  - `profile: opening it loads friends but does not read their positions` — sandbox: `openProfile()` calls `loadFriends`, not `startFriendPolling`.
  - `profile: on a phone it is a sheet of its own, not a bottom-bar button` — `mSheets` has `profile`; `items` list unchanged (Map, Friends, Layers, Alerts).
  - `profile: on a 320 px phone the search box keeps at least 150 px` (Review Focus 3) — CSS for `body.mobile .omni-bar` uses `flex:1 1 auto; min-width:150px` and `#profileBtn` `flex:0 0 34px`.
  - `profile: Escape and Back close it` — reuses the settings panel's handlers (`back-button.test` style).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per Interfaces; i18n keys `profile`, `profileTitle`, `accAndFriends`.
- [ ] **Step 4: Run** `npm run build && npm test` — PASS.
- [ ] **Step 5: Commit** `feat(v4.7): profile corner`.

### Task 6: Mutation rows, docs, browser check, PR

**Files:**
- Modify: `transit_data/testkit/verify-suite.cjs` (V4.7 rows), `README.md` (features), records folder: `Update-Journal.txt`, `Changelog.md`, `Asked-For-But-Not-Built.md` (favourites done; "favourites synced with account" and "rename the Friends tab" listed as not built), `Open-Issues-and-Next-Steps.md`

- [ ] **Step 1: Add deliberate-break rows**, each must be caught: favourites store calls `fetch`; Save removed from the pin pop-up; `#stnFav` removed; account box back in `#cardFriends`; `openProfile` starts polling; dropped pin ignores the turn flag; `favListHTML` stops escaping; corrupt store throws.
- [ ] **Step 2: Run** `npm run verify` and the counted stale-anchor scan to a file — Expected: tests pass, every row caught, 0 stale (report the count).
- [ ] **Step 3: Browser check** (`preview_start istanbul-rail`): 375 px and 320 px phone + computer; light and dark: profile button, sheet (signed out form), Friends tab (sign-in line + favourites), save from a search pin, a station, a long-press pin (name dialog), tap a favourite, Go, Rename, Make Home, Remove; no network request on any favourite action (`read_network_requests`). Screenshot proof.
- [ ] **Step 4: Docs + journal** with real clock times; NOT verified list (real phone long-press, real friends).
- [ ] **Step 5: Commit, push `v4-7`, open the PR** (body ends with the Claude Code line); bind it with `ccd_pr`; wait for the owner's "merge once green".
