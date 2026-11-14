# Accounts, friends and location sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TurkMaps V4.6.3. Firebase email+password accounts (email confirmed), friends added through one-time links, and opt-in, time-limited location sharing that only accepted friends can see.

**Architecture:**
- No Firebase SDK. Two new source files talk to Firebase's REST endpoints with `fetch`:
  - `26-account.js`: auth, session, the account UI.
  - `26b-friends.js`: invites, friends, sharing, markers.
- Every safety guarantee is enforced in `firebase/firestore.rules` on Google's servers, not only in the app.
- The app stays dormant (no request to Google) until the Firebase config exists **and** the person opens Friends.

**Tech Stack:** Vanilla JS concatenated by `transit_data/build.cjs`; Leaflet markers; `node:test` via `npm test`; Firestore Security Rules v2.

**Spec:** `docs/superpowers/specs/2026-11-14-friends-location-design.md` (approved 14 Nov 2026).

## Global Constraints

- **CSP `connect-src`:** add exactly `https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com`. Nothing in `script-src` changes, and no vendored SDK.
- **No secret key anywhere.** Only the public web config (`apiKey`, `projectId`) is allowed, in `transit_data/firebase-config.json`. The build injects `null` when the file is absent.
- **Password:** minimum 8 characters, never stored by the app.
- **localStorage `irn_account`:** holds `{ uid, email, refreshToken, idToken, idExp, name }` only.
- **Sharing:**
  - durations are exactly 15, 60 or 480 minutes (no other value);
  - **Approximate** rounds lat/lng to 0.01° on the device before sending;
  - send when moved > 25 m, or ≥ 120 s since the last send; never more often than every 30 s.
- **Invites:**
  - the id is 32 hex chars from `crypto.getRandomValues` (128 bits);
  - `expires` = `created` + 48 h;
  - the link is `<app url>#invite=<id>`.
- **Friendship doc id:** the two uids sorted, joined by `_`.
- **Rules:**
  - the location is visible to a friend only while `until > request.time` **and** `at > request.time - 3 min`;
  - `until ≤ at + 8 h`;
  - every rule requires `request.auth.token.email_verified == true`.
- **Strings:** every visible string is in `01-i18n.js` in all 4 languages; Arabic entries contain Arabic letters.
- **Escaping:** every name from Firestore goes through `svgEsc`/`attrEsc` before `innerHTML`.
- **Process:** PRs only. Commit sources, then a separate "rebuild" commit. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Real clock times in the journal.
- **Not legal advice.** The privacy text is not lawyer-reviewed.

## Review Focus

1. **Token expiry mid-session.** An ID token lives 1 h. Any call that returns 401 must refresh once and retry once. Otherwise sharing silently stops sending, and friends lose you while your pill says "Sharing".
2. **A friend who stops sharing (403 / missing doc) during polling.** They must disappear from the map. The other friends must not be affected and no error toast should appear.
3. **Location permission denied or unavailable.** Sharing must not start, the pill must not show, and the person gets a clear message.
4. **Opening an invite link while signed out, or unconfirmed.** The invite id must survive sign-up and confirmation, then show Accept. It must not be lost or auto-accepted.
5. **The app reopened after a crash while sharing.** The stale `locations/{uid}` must be deleted on start, and the pill must not come back by itself.

Each line has its test in the owning task. They are marked **(RF1)** to **(RF5)**.

---

### Task 1: The access rules

**Files:**
- Create: `firebase/firestore.rules`, `firebase/README.md` (one paragraph: what the rules guarantee, and how to paste them in the console)
- Test: `transit_data/test/v463.test.cjs` (create; this task adds the `rules:` tests)

**Interfaces:** Produces the data model from spec §6. The collection and field names below are used verbatim by Tasks 3–5:
- `profiles/{uid}`: `name`
- `invites/{id}`: `from`, `fromName`, `created`, `expires`, `usedBy`
- `friendships/{lo}_{hi}`: `a`, `b`, `inviter`, `acceptor`, `invite`, `created`
- `locations/{uid}`: `lat`, `lng`, `acc`, `approx`, `at`, `until`

- [ ] **Step 1: Write failing text tests.** Read the rules file and assert that each of these is present:
  - `rules_version = '2'`;
  - a `function verified()` using `request.auth.token.email_verified == true`;
  - the default deny `match /{document=**} { allow read, write: if false; }`;
  - in `locations`: `resource.data.until > request.time`, `resource.data.at > request.time - duration.value(3, 'm')`, and `request.resource.data.until <= request.resource.data.at + duration.value(8, 'h')`;
  - in `friendships`: `getAfter(` and `allow update: if false`;
  - in `invites`: `duration.value(48, 'h')`;
  - every `allow` line except the deny contains `verified()`;
  - in `profiles` and `locations`: `request.resource.data.keys().hasOnly(`.

  Test names start with `rules:`.
- [ ] **Step 2:** Run `node --test transit_data/test/v463.test.cjs`. Expected: FAIL (file missing).
- [ ] **Step 3: Write `firebase/firestore.rules` from spec §6.**
  - A helper `isFriend(other)` = `exists(/databases/$(database)/documents/friendships/$(pair(request.auth.uid, other)))`, where `pair(x,y)` = `x < y ? x + '_' + y : y + '_' + x`.
  - **Friendship create:** `request.auth.uid == request.resource.data.acceptor`.
    - `a < b`, the doc id `== a + '_' + b`, and `{a,b} == {inviter,acceptor}`.
    - `get(invite).data.from == inviter`, `get(invite).data.usedBy == null`, `getAfter(invite).data.usedBy == acceptor`, and `get(invite).data.expires > request.time`.
  - **Invite claim (update):** `diff(...).affectedKeys().hasOnly(['usedBy'])`, `resource.data.usedBy == null`, `request.resource.data.usedBy == request.auth.uid`, `resource.data.from != request.auth.uid`, and `resource.data.expires > request.time`.
  - **List reads:** allowed by `resource.data.a == request.auth.uid || resource.data.b == request.auth.uid` (friendships) and `resource.data.from == request.auth.uid` (invites). Invites may also be GET by any verified user.
  - **Location write:** `request.resource.data.at == request.time`, `lat`/`lng` within range, `acc` within 0–5000, `approx is bool`, and `until > request.time`.
- [ ] **Step 4:** Run the same command. Expected: the `rules:` tests PASS.
- [ ] **Step 5:** Commit: `V4.6.3: Firestore access rules`.

### Task 2: Config, security policy and privacy texts

**Files:**
- Modify: `transit_data/build.cjs`
  - CSP `connect-src` (~line 263);
  - new token `__FIREBASE_JSON__` read from `firebase-config.json` if it exists, else `null`, injected next to the other `__*_JSON__` tokens (~line 204).
- Modify: `transit_data/app.template.html` (one line `const FIREBASE = __FIREBASE_JSON__;` beside the other injected constants).
- Modify: `transit_data/legal-content.cjs`
  - a `HOSTS` entry `{ hosts: ['identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com'], name: 'Google Firebase', optional: true, en/tr: { when, sees } }`;
  - a `STORAGE` row `irn_account`;
  - a new privacy section "Accounts, friends and sharing your location" (EN/TR): what is stored at Google, where (Firestore region chosen at setup; Authentication in Google's data centres), retention (until deleted; position hidden 3 min after the last update and deleted on Stop/Sign out/Delete), who sees what.
- Modify: `transit_data/legal-config.json`: `policyVersion` "2" → "3"; `appVersion` → "V4.6.3".
- Test: `transit_data/test/v463.test.cjs`

**Interfaces:** Produces the global `FIREBASE` (`{apiKey, projectId}` or `null`).

- [ ] **Step 1: Failing tests** (`config:`):
  - the built CSP `connect-src` contains each of the 3 hosts;
  - `H.html()` contains `const FIREBASE = ` followed by `null` or an object with only `apiKey`/`projectId`;
  - the built page and the repo contain no `private_key` and no `"type": "service_account"`;
  - `legal-content` STORAGE has `irn_account`;
  - HOSTS names `firestore.googleapis.com`;
  - `policyVersion === '3'`.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL. Existing tests that compare CSP hosts against HOSTS must still pass after Step 3.
- [ ] **Step 3: Implement.** `firebase-config.json` is NOT created in this task; the owner supplies it in Task 8.
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `V4.6.3: Firebase hosts, config slot, privacy and storage texts`.

### Task 3: Account core and UI (`src/26-account.js`)

**Files:**
- Create: `transit_data/src/26-account.js`. It wraps the pure part in `/* ==ACCOUNT-PURE-START== */ … /* ==ACCOUNT-PURE-END== */`.
- Modify: `transit_data/app.template.html`: an "Account" `sp-item` in Settings › You (`<div class="sp-item" id="accRow">`) and its CSS.
- Modify: `transit_data/src/01-i18n.js`: `acc*` keys, ×4 languages.
- Test: `transit_data/test/v463.test.cjs`

**Interfaces — Produces:**
- Pure:
  - `fsEncode(obj) -> {fields}` and `fsDecode(doc) -> obj` (Firestore typed values: string, integer, double, boolean, null, timestamp as `{timestampValue}` for `Date`);
  - `fsDocPath(projectId, ...segs) -> string` (`projects/<p>/databases/(default)/documents/<segs>`);
  - `pairId(u1, u2) -> string` (sorted, `_`-joined);
  - `pwOk(s) -> boolean` (length ≥ 8).
- Runtime:
  - `acct` (the session object or `null`);
  - `async fbAuth(method, body) -> json` (POST `https://identitytoolkit.googleapis.com/v1/accounts:<method>?key=`);
  - `async idToken() -> string` (refreshes via `https://securetoken.googleapis.com/v1/token?key=` when `idExp - 60 s` has passed);
  - `async fsFetch(path, opts) -> Response` (adds `Authorization: Bearer`; on 401 refreshes once and retries once — **RF1**);
  - `async fsCommit(writes) -> json` (POST `…/documents:commit`);
  - `async fsQuery(structuredQuery) -> [obj]` (POST `…/documents:runQuery`);
  - `accSignUp(email, pw, name)`, `accSignIn(email, pw)`, `accSignOut()`, `accResendVerify()`, `accRecheckVerified() -> boolean` (forces a refresh and reads `email_verified` from the new ID token), `accResetPassword(email)`, `accDelete(pw)`;
  - `accReady() -> boolean` (`FIREBASE && acct && acct.verified`);
  - `onAccountChange(fn)` (subscribers, used by Task 4).

**Steps:**

- [ ] **Step 1: Failing tests** (`account:`). They run the pure block in `vm`, plus the runtime functions with a fake `fetch` and `localStorage`:
  - `fsEncode({a:'x', n:3, d:1.5, b:true, z:null})` gives `stringValue`, `integerValue:'3'`, `doubleValue:1.5`, `booleanValue`, `nullValue`; `fsDecode` round-trips it.
  - `pairId('b','a') === 'a_b'`; `pwOk('1234567') === false`; `pwOk('12345678') === true`.
  - Sign-up calls `accounts:signUp`, then `accounts:sendOobCode` with `requestType:'VERIFY_EMAIL'`, then commits `profiles/<uid>` with only `name`.
  - The saved `irn_account` has no `password` key.
  - **RF1:** a fake `fetch` returns 401 once, then 200. `fsFetch` calls `securetoken` once and retries once. A second 401 surfaces as an error and does not loop.
  - `accDelete`:
    - calls `accounts:signInWithPassword` first;
    - then deletes `locations`, `friendships` (via query), `invites` (via query) and `profiles`;
    - only then `accounts:delete`;
    - a failing `accounts:delete` leaves `irn_account_pending_delete` set and does not clear the data steps' result.
  - With `FIREBASE = null`, nothing calls `fetch` at load.
- [ ] **Step 2:** Run `node --test transit_data/test/v463.test.cjs`. Expected: `account:` FAIL.
- [ ] **Step 3: Implement as specified.** UI in `#accRow`:
  - signed out: email, password, name (sign-up only), the buttons **Sign up** / **Sign in** / **Forgot password**;
  - unconfirmed: "Check your email" + **Resend** + **I've confirmed**;
  - signed in: name + **Sign out** + **Delete my account** (asks for the password in a field, then confirms);
  - not configured (`!FIREBASE`): one line, "Friends is not set up yet".

  Firebase error codes map to i18n messages (`EMAIL_EXISTS`, `INVALID_LOGIN_CREDENTIALS`, `WEAK_PASSWORD`, `TOO_MANY_ATTEMPTS_TRY_LATER`, else generic). Names are escaped.
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: all pass, including the i18n parity and Arabic tests.
- [ ] **Step 5:** Commit: `V4.6.3: accounts (sign up, confirm email, sign in, reset, delete)`.

### Task 4: Friends and invites (`src/26b-friends.js`, part 1)

**Files:**
- Create: `transit_data/src/26b-friends.js` (pure block `/* ==FRIENDS-PURE-START== */ … END`)
- Modify: `src/01-i18n.js` (`fr*` keys ×4), `app.template.html` (the Friends panel markup `#friendsBox` + CSS)
- Test: `transit_data/test/v463.test.cjs`

**Interfaces:**
- Consumes (Task 3): `fsCommit`, `fsQuery`, `fsFetch`, `fsEncode`, `fsDecode`, `fsDocPath`, `pairId`, `acct`, `accReady`, `onAccountChange`.
- Produces:
  - Pure:
    - `newInviteId(rand) -> string` (32 hex; `rand` = a `Uint8Array(16)` filler, injected for tests);
    - `parseInviteHash(hash) -> id|null` (accepts only `#invite=` + exactly 32 hex chars);
    - `inviteLink(base, id) -> string`;
    - `acceptWrites(projectId, invite, me) -> writes[]`: the claim write (`updateMask: ['usedBy']`, precondition `updateTime` from the read invite), plus the friendship create with `currentDocument: {exists:false}`, both in one commit.
  - Runtime:
    - `friends` (`[{uid, name}]`);
    - `async loadFriends()`;
    - `async makeInvite() -> link` (uses `navigator.share` when present, else copies to the clipboard);
    - `async cancelInvite(id)`;
    - `async removeFriend(uid)`;
    - `async openInvite(id)` (the Accept dialog).
  - The pending invite id is kept in `sessionStorage` key `irn_pending_invite` until accepted or declined.

**Steps:**

- [ ] **Step 1: Failing tests** (`friends:`):
  - `newInviteId` with a fixed filler gives a fixed 32-hex string;
  - `parseInviteHash('#invite=' + 'a'.repeat(32))` gives the id; `'#invite=xyz'`, `'#invite=' + 'g'.repeat(32)` and `''` give `null`;
  - `acceptWrites` has exactly 2 writes. The friendship doc name ends with `pairId(...)`. Its `a < b`, `inviter` = the invite's `from`, `acceptor` = me.
  - **RF4:** with no session, `openInvite(id)` stores `irn_pending_invite` and opens the account sign-in. After a simulated sign-in **and** confirmation, the Accept dialog appears for the same id. `fsCommit` is never called before Accept is pressed.
  - The `removeFriend` commit deletes only `friendships/<pairId>`.
  - A friend name `'<img src=x onerror=1>'` renders escaped in the friends list (reuse the `security.test.cjs` `danger()` helper pattern).
- [ ] **Step 2:** Run `node --test transit_data/test/v463.test.cjs`. Expected: `friends:` FAIL.
- [ ] **Step 3: Implement.**
  - `#friendsBox` shows: the friends list (name, a "sharing" dot, **Remove**), the open invites (expiry, **Cancel**), and **Invite a friend**.
  - On boot, `parseInviteHash(location.hash)` runs, then `history.replaceState` removes the hash.
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `V4.6.3: friends through one-time links`.

### Task 5: Sharing and friends on the map (`src/26b-friends.js`, part 2)

**Files:**
- Modify: `transit_data/src/26b-friends.js`, `app.template.html` (the `#sharePill` markup + CSS; marker CSS `.friend-dot`), `src/01-i18n.js`
- Test: `transit_data/test/v463.test.cjs`

**Interfaces:**
- Consumes: Task 3 and Task 4 functions.
- Produces:
  - Pure:
    - `SHARE_DURATIONS = [15, 60, 480]`;
    - `approxPos(lat, lng) -> [lat, lng]` (rounded to 2 decimals);
    - `metersBetween(a, b)`;
    - `shouldSend(last, now, pos) -> boolean` (spec values: 25 m, 120 s, 30 s floor);
    - `locationWrite(projectId, uid, pos, approx, untilMs) -> write` (with `updateTransforms: [{fieldPath:'at', setToServerValue:'REQUEST_TIME'}]`);
    - `ageText(ms) -> string`.
  - Runtime:
    - `sharing` (`{until, approx, watchId}` | `null`);
    - `async startSharing(minutes, approx)`;
    - `async stopSharing(reason)` (deletes `locations/<uid>`);
    - `pollFriends()` (every 20 s while the Friends sheet or card is open, or while any friend marker is shown);
    - `friendLayer` (`L.layerGroup`).

**Steps:**

- [ ] **Step 1: Failing tests** (`sharing:`):
  - `startSharing(30, false)` rejects. `startSharing(480, …)` sets `until` = now + 480 min. Nothing above 480 is accepted.
  - `approxPos(41.012345, 28.987654)` deep-equals `[41.01, 28.99]`. With approx on, the commit body never contains the unrounded numbers.
  - `shouldSend`:
    - false at 10 s after the last send, even when moved 100 m;
    - true at 31 s after the last send when moved 30 m;
    - false at 60 s when moved 10 m;
    - true at 121 s when moved 0 m.
  - `locationWrite` has the `REQUEST_TIME` transform on `at`, and its fields are exactly `lat`, `lng`, `acc`, `approx`, `until`.
  - `stopSharing` commits a delete of `locations/<uid>`, clears the watch, and hides the pill. Sign out and delete both call it.
  - **RF3:** if the geolocation error callback fires (permission denied), `sharing` stays `null`, the pill stays hidden, and the `shareDenied` message is shown.
  - **RF2:** in `pollFriends` with 3 friends where one GET returns 403 and one 404, only the 200 friend has a marker. Previously drawn markers for the other two are removed. No toast is shown.
  - **RF5:** at boot with a session and no `sharing`, a delete of `locations/<uid>` is committed once, and the pill is hidden.
  - The pill shows the minutes left and a **Stop** button with `aria-label`.
- [ ] **Step 2:** Run `node --test transit_data/test/v463.test.cjs`. Expected: `sharing:` FAIL.
- [ ] **Step 3: Implement.**
  - `navigator.geolocation.watchPosition` with `enableHighAccuracy: !approx`.
  - Time runs out → `stopSharing('expired')`.
  - The pill sits fixed above the bottom bar on a phone and top-centre on a computer, in a theme colour token.
  - Friend markers are an `L.divIcon` with the initial (escaped) and a tooltip "<name> · <ageText>".
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `V4.6.3: share your location with friends, and see theirs`.

### Task 6: The Friends button, sheet and desktop card

**Files:**
- Modify: `transit_data/src/18-mobile-shell.js`
  - the `mSheets` add `friends: mkSheet('friends')`;
  - an `ICON.friends` SVG (two heads);
  - `const items=[ ['map','mMap'], ['friends','mFriends'], ['layers','mLayers'], ['alerts','mAlerts'] ];`
  - `#friendsBox` is moved into the sheet.
- Modify: `app.template.html`
  - `.mnav-ind` width `calc((100% - 12px) / 4)`, plus `data-on="3"` → `translateX(300%)`;
  - a desktop `<div class="card glass" id="cardFriends">` holding `#friendsBox` in `.controls`.
- Modify: `src/21-history.js` (`NAV_LAYERS` friends sheet), `src/23-a11y.js` (Escape closes the accept dialog; a `DIALOGS` entry for `#inviteDlg`), `src/01-i18n.js` (`mFriends` ×4).
- Modify the older tests that pin three buttons: `test/navigation.test.cjs`, `test/v462.test.cjs`.
- Test: `transit_data/test/v463.test.cjs`

**Interfaces:** Consumes `pollFriends`, `loadFriends` and `accReady` (Tasks 3–5). Opening the friends sheet or card calls `loadFriends()` and starts `pollFriends()`; closing it stops the polling unless sharing.

**Steps:**

- [ ] **Step 1: Update failing tests** (`ui:`):
  - the bottom bar keys deep-equal `['map','friends','layers','alerts']`;
  - the marker CSS divides by 4;
  - `openSheet('friends')` closes the line panels (reuse the plansheet stub world);
  - **RF dormant:** with `FIREBASE = null`, opening Friends shows the not-set-up line and calls no `fetch`.
- [ ] **Step 2:** Run `npm test`. Expected: those FAIL (and the old 3-button tests fail until updated).
- [ ] **Step 3: Implement.** Update the two old tests' expected lists to 4 buttons, saying so in their messages.
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `V4.6.3: Friends in the bottom bar and on the computer`.

### Task 7: Mutation rows, rebuild, full checks, browser check

**Files:**
- Modify: `transit_data/testkit/verify-suite.cjs` (a `V4.6.3` block before the closing `];`, using the same CRLF-safe patch-script approach as V4.6.2)

**Steps:**

- [ ] **Step 1: Add one row per safety measure that lives in the built page.** Each row's `expect` is the `v463` test name that must catch it:
  - CSP host dropped;
  - approx rounding removed;
  - an 8-hour cap raised to 24 h;
  - `shouldSend` floor removed;
  - REQUEST_TIME transform removed;
  - `stopSharing` no longer deletes;
  - boot cleanup removed (RF5);
  - the 401 retry removed (RF1);
  - a name not escaped;
  - the invite auto-accepted (RF4);
  - `pairId` unsorted;
  - `password` saved to `irn_account`;
  - delete order swapped (auth before data);
  - the dormant check removed.

  The rules-file rows cannot be mutated through `index.html`; Task 1's text tests cover the rules.
- [ ] **Step 2:** Run the scratchpad `runrows.cjs "<new row regex>" v463.test.cjs navigation.test.cjs v462.test.cjs`. Expected: N/N caught.
- [ ] **Step 3:** Run `npm run build && npm test`. Expected: all pass.
- [ ] **Step 4:** Run the scratchpad `anchors.cjs` to a file, then `grep -cE "^STALE|^ERR"`. Expected: `0`.
- [ ] **Step 5: Browser preview** (`istanbul-rail`, 375×812 and desktop):
  - With no config: Friends shows "not set up yet", and the network log shows no googleapis request.
  - With a temporary local `firebase-config.json` pointing to a fake project, stub `fetch` in the page to check the sign-up → "check your email" → confirmed → invite → share pill → stop flow visually.
  - Delete the temp config before committing.
- [ ] **Step 6: Commit** the sources: `V4.6.3: accounts, friends and location sharing`. Then commit the rebuild separately: `V4.6.3: rebuild (index.html, sw.js, legal pages)`.

### Task 8: Owner setup, live rules check, PR, records

**Files:**
- Create: `firebase/rules-check.cjs`
  - Node, run by hand: `node firebase/rules-check.cjs`.
  - It reads `firebase/.test-accounts.json` (gitignored: `{ apiKey, projectId, a:{email,pw}, b:{email,pw} }`).
  - It signs in both accounts by REST and runs every allowed and forbidden case in spec §6, printing `PASS`/`FAIL` per case. It exits 1 on any FAIL.
- Modify: `.gitignore` (`firebase/.test-accounts.json`)
- Create: `Desktop\Career building\Project Sectors\Map Building\Firebase-Setup-Guide.md` (the spec §10 steps, click by click)
- Update the records: `Update-Journal.txt` (real times), `Changelog.md`, `README.md`, `Open-Issues-and-Next-Steps.md`, `Asked-For-But-Not-Built.md` (spec §11 drafts; "remind the owner" note), `Licences-and-Data-Sources.md` (Firebase terms), `Play-Store-Readiness-Checklist.md`.
- Update memory.

**Steps:**

- [ ] **Step 1:** Run the full test suite again, then push `v4-6-3` and open the PR "V4.6.3: accounts, friends and location sharing". The body ends with the 🤖 line. Then run `ccd_pr get_status`.
- [ ] **Step 2: Merge when green** (the owner's standing order for this update, 14 Nov 2026):
  - wait on the CI run with `gh run watch` in the background;
  - on green, run `gh pr merge --merge --match-head-commit <sha>`;
  - check the deploy and the live page (curl for `const FIREBASE = null`, the Friends button, the CSP hosts).
  - On red: fix, push, wait again. Never merge red.
- [ ] **Step 3: Owner setup.** Guide the owner through `Firebase-Setup-Guide.md`. They paste the public config, then:
  - add `firebase-config.json` in a follow-up PR (V4.6.3.1);
  - the owner approves two test accounts;
  - create them with generated passwords into `firebase/.test-accounts.json`;
  - verify them by clicking the confirmation links in the browser pane;
  - run `node firebase/rules-check.cjs`. Expected: every case PASS.
  - Record the results in the journal, then delete the two test accounts (via the app's Delete my account).
- [ ] **Step 4: Report to the owner,** listing every safety measure as in spec §8, with what was verified live and what was not (a real phone).
