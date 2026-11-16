# V4.7 — Profile corner and favourite places (design)

Date: 16 Nov 2026. Status: approved approach (A); this document awaits the owner's approval.

## Intent and why

The owner wants everything about *you* (your account and your friends) in one place, the **top-right corner**, and the
bottom **Friends** tab to be only about **sharing your location** plus a new **Favourites** list.

Favourites, in the owner's words: "A place I save, tap it to see it and add the choice to go to it, but the main objective
is to save it for later and as a side thing to make it easy to go to if I want to." Saving is the main job; going there is
a side job. Favourites stay **on this device only for now** (owner's choice).

Today the account box appears twice (Settings > You and the Friends sheet), and the Friends sheet mixes the account, the
friends list, invites and location sharing.

## Goals

1. A round **profile button** at the top right. Phone: at the end of the search row (the search box gets shorter).
   Computer: in the top bar beside Settings. It shows your initial when signed in, a person outline when not.
2. Pressing it opens the **profile sheet** (approach A, chosen by the owner): on a phone a sheet from the bottom like the
   others (draggable, closes with Back); on a computer a panel on the right like Settings. It holds:
   your name and email, sign in / sign up / forgot password / confirm email, sign out, delete account; your **friends
   list**, **Add friend** (the invite link), your open links, and removing a friend.
3. The **Friends tab** holds only: **Share my location** (time + exact/approximate, Stop), **who is sharing now**, and
   **Favourites**.
4. **Favourites**: save a place, see the list, tap one to see it on the map, and a **Go there** action.
5. **Settings > You** no longer has the account box (one place only).

## Non-goals (not in V4.7)

- Favourites synced with the account, or shared with friends (owner: device only "for now"; a later move is possible).
- Folders/lists, notes, photos, import/export, ratings.
- Renaming the Friends tab (owner said "for now"; a one-line change later).
- Any change to the Firestore rules or what is stored in Firebase.

## Anti-goals (a failure even if it "works")

- A favourite, or the list, ever leaves the device (no network request when saving, listing or opening one).
- The search box becomes too small to use on a narrow phone (320 px wide).
- Seeing or using favourites needs an account.
- Sharing loses any of its safety: the Sharing sign with Stop stays on top, sign out / delete still erase the position.
- Home/Work saved places or the planner's saved routes (`irn_favourites`) break or are lost.

## Constraints

- Static PWA; sources are `transit_data/src/*.js` + `app.template.html`, built by `transit_data/build.cjs`; never edit
  `index.html`. `25-map-keyboard.js` stays the last source file.
- Every `localStorage` key needs a STORAGE row (privacy test) and a line on the storage pages (`legal-content.cjs`, EN+TR).
- Every visible string in EN and TR. Error codes lower case (structure test). No inline handlers (CSP).
- Tests: `npm test`, mutation rows in `testkit/verify-suite.cjs` (check `expect` names after renames), counted stale scan.
- Branch `v4-7` + PR; merge only on the owner's "merge once green".

## Approaches (decided)

- **A. Profile opens as a sheet / side panel (chosen).** Same look and movement as every other panel; the sign-in form
  and friends list fit; one place for everything.
- B. A small drop-down menu under the button. Quicker for "sign out", but the form, friends list and delete check would
  be cramped and would each need a second panel. Rejected: two places again.

Storage approaches: **device only (chosen)** vs with the account (needs sign-in, new rules, a new live rules check).

## The design

### Profile button and sheet
- `#profileBtn` (round, 34 px) with `aria-label` "Profile" / "Profil". Content: the first letter of `acct.name` when
  signed in; a drawn person outline otherwise; a small amber dot when signed in but the email is not confirmed yet
  (builder's call: helps the "it says I didn't verify" case).
- Phone: placed after `.omni-bar` in the search row; the bar shrinks by the button's width + gap. Computer: in the top
  bar before `#settingsBtn`.
- Phone: a new sheet `mSheets.profile` made with `mkSheet('profile')`; it is **not** a bottom-bar button. Opening it closes
  other sheets as `openSheet` already does. Computer: `#profilePanel`, a right-side dialog reusing the settings panel's
  styles/overlay/Esc/focus behaviour.
- Contents: the existing `.acc-box` (account, unchanged logic) then a new `.fr-list-box` with the friends list + invites
  (today's `friendsViewHTML()`), shown only when signed in and confirmed.
- Opening the profile loads the friends list (`loadFriends`), but does **not** start reading friends' positions.

### Friends tab (sheet on phone, card on computer)
- `.fr-share-box`: today's `shareViewHTML()` + a **Sharing now** list: friends whose position is visible, each row taps
  to fly to their marker. Positions are read every 20 s only while this tab is open or while you share (unchanged rule).
- Signed out / not confirmed: one line "Sign in to share your location with friends" + a button that opens the profile.
- Below it, **Favourites** (always shown, no account needed).
- `renderFriends()` is split: `renderShare()` fills `.fr-share-box`, `renderFriendList()` fills `.fr-list-box`.
  `friendsVisible()` keeps meaning "the Friends tab is on screen" (positions); the profile has its own `profileVisible()`.

### Favourites
- Store: `localStorage['irn_favplaces']` = array of
  `{ id, name, lat, lng, kind: 'place'|'station'|'pin', ic, ctx, city, saved }` (`ic` emoji icon, `ctx` district or area
  text, `city` the city id at save time, `saved` ms). Different key from `irn_favourites` (saved routes). Pure module with
  `favLoad/favSave/favAdd/favRemove/favRename/favFind` — corrupt JSON reads as `[]`; at most 200 entries (oldest
  dropped, with a toast); the same place (same name within 30 m) is not added twice.
- **Saving** — a ☆ Save / ★ Saved toggle on:
  1. the place pin pop-up (`dropPin` in `19-assistant.js`, beside Route from / Route to / Near here);
  2. the station panel (`#stn`, beside Set as Origin / Set as Destination);
  3. a **dropped pin**: long-press on the map (phone) or right-click without dragging (computer) drops a pin named
     "Dropped pin" with its coordinates through `dropPin`, which then offers Save. Right-drag already turns the map
     (`07z-map-turn-input.js`): only a right-click with no movement drops a pin. Saving it asks for a name (prefilled).
- **The list** (Friends tab): Home and Work first when set (🏠 / 💼, from `irn_home` / `irn_work`, unchanged storage),
  then favourites newest first. Row: icon, name, `ctx`. Tap the row: the map flies there and the pin pop-up opens (on a
  phone the sheet drops to its low height so the map shows). Each row has **Go** (destination = this place; origin =
  current origin or your location, as `useSavedPlace` does today: route at once if an origin exists, otherwise open the
  planner) and a **⋯** menu: Rename, Make Home, Make Work, Remove (Remove asks once, inline).
- Favourites saved in another city: shown with the city name, dimmed; tapping switches city (`switchCity`) then flies.
- Empty list: a hint "Tap ☆ Save on a place, a station or a dropped pin (long-press the map)."
- **Settings > You**: the account box is removed (replaced by a row "Account and friends ›" that opens the profile); the
  Home/Work rows stay working as today (the planner chips still use them) — builder may move them only if nothing reads
  `#homeVal/#workVal` elsewhere.

### Legal / privacy
- Storage pages (EN/TR) and STORAGE rows: `irn_favplaces` — "your favourite places; stays on this device; delete by
  removing them or clearing site data". No privacy-policy version bump (nothing new leaves the device).

## Testing

- Unit tests for the pure favourites store (add, duplicate, rename, remove, cap, corrupt data, city field) and for the
  render split (signed-out Friends tab shows favourites + the sign-in line; profile shows account + friends list).
- Deliberate-break rows for: favourites making a network request, Save missing from the pin pop-up and station panel,
  the account box returning to Settings, positions polled while only the profile is open.
- Browser check at 375 px and 320 px (search still usable), computer width; dark and light.
- NOT verifiable here: a real phone's long-press feel; real friends.

## Left to the builder

Exact sizes/spacing, icons, the dropped-pin naming dialog's look, i18n wording (EN/TR), and how the "Account and
friends ›" row is drawn.
