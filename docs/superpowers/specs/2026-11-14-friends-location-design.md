# V4.6.3 — Accounts, friends and location sharing (design)

Date: 14 Nov 2026. Status: for the owner's approval. Not legal advice; the privacy wording that follows from this is not lawyer-reviewed.

## 1. Intent

The owner asked for:
1. Accounts made with an email address, in the app.
2. A new button in the phone's bottom bar to share your location and see it on the map, **only with friends**. Friends are added through links.
3. Favourite places (make, customise, visit), **later, not in V4.6.3**.

Who it is for now: the owner and a few friends, as a trial. The app is not on the Play Store.

The owner made three choices:
- **Firebase** (option 1 of 3).
- **Email + password with the email confirmed** (option 1 of 3, after the free plan's 5-a-day limit on sign-in-link emails was found).
- **Build every safety and protection measure, and explain each one exactly.**

Standing rule from the owner: if a step needs a **secret key**, do not do it now. Write it as a draft for later and remind them. With this design **no secret key is needed** (§5). The keyed alternative is a draft (§11).

## 2. Goals, non-goals, anti-goals

Goals:
- Sign up with an email and a password (at least 8 characters). Firebase emails a "confirm your address" link, and Friends stays locked until the address is confirmed. "Forgot password" sends a reset email.
- Friends:
  - Make a friend link and send it any way (WhatsApp, SMS…).
  - The other person accepts it.
  - Either side can remove the friendship.
- Share your location with all your friends for a chosen time. See the friends who are sharing on the map, with their name and how old each position is.
- Delete the account and everything stored about you, from inside the app.

Non-goals (V4.6.3):
- Favourite places.
- Sharing with only some friends.
- Location history.
- Chat.
- Push notifications.
- Sharing while the app is closed (a web app cannot send its location from the background).
- Play Store readiness.

Anti-goals (a failure even if it "works"):
- Anyone who is not your accepted friend can read your location, by the app or by calling Firebase directly.
- Sharing turns on, or stays visible, without the person knowing. This includes after they closed the app.
- Your email is shown to friends or anyone else.
- A secret key is put into anything the app runs, or into the repo.
- People who never sign in are affected. No Firebase request is made until someone opens the Friends feature.

## 3. Constraints found in the code

- **Static PWA on GitHub Pages.** The only server today is the Cloudflare bus relay.
- **Content-Security-Policy:** `script-src 'self'` plus one hash. No third-party script hosts are allowed, and tests enforce this (`vendor.test.cjs`, `security.test.cjs`). `connect-src` lists outside hosts by name (`transit_data/build.cjs`).
  - So: no Firebase SDK (~150 KB, and it would have to be vendored).
  - The app talks to Firebase's **REST endpoints** with `fetch`, in our own code.
  - `connect-src` gains exactly `https://identitytoolkit.googleapis.com`, `https://securetoken.googleapis.com` and `https://firestore.googleapis.com`.
- **Firestore REST has no live push**, so friends' positions are re-read every 20 s while Friends is open.
  - Use `documents:commit` for every multi-document write, because it is atomic (`batchWrite` is not).
  - Read each friend's location with its own GET, not `batchGet`, because one denied document would fail the whole request.
- **Java 8 on this machine.** The rules emulator needs Java 11+, so the rules are tested **live** on the owner's project (§9).
- **Firebase free (Spark) plan limits** (checked on Firebase's limits page, 14 Nov 2026):
  - address-confirmation emails: 1,000 a day;
  - password-reset emails: 150 a day;
  - new accounts: 100 per hour per IP.

  These are ample for a few friends.
- Code conventions:
  - Sources go in `transit_data/src/*.js`.
  - Strings in 4 languages (`01-i18n.js`).
  - The storage and privacy pages are built from `legal-content.cjs`.
  - Mutation rows for every safety rule.
  - PRs only.

## 4. Approaches

Backend (the owner picked 1):
1. **Firebase.** Google runs sign-in and sends the emails, so we hold no secret key. Data is guarded by rules stored at Firebase. Trade-off: emails and positions sit on Google's servers, outside Türkiye.
2. **Supabase.** Its free plan only emails the owner's own team.
3. **Our own Cloudflare Worker.** It needs secret keys, so it is a **draft for later**.

Sign-in (the owner picked 1):
1. **Email + password, address confirmed.** Free; 1,000 confirmation emails a day.
2. **Emailed sign-in link on the paid Blaze plan.** Needs a payment card, with no hard spending cap.
3. **Emailed link on the free plan.** Only 5 emails a day for the whole project, so it would fail within a day.

## 5. Why no secret key is needed

The Firebase **web API key** is public by Google's design: it names the project and is shipped in every Firebase web app. Protection comes from four things:
- the **Firestore Security Rules** (§6), checked on Google's servers for every read and write;
- **email enumeration protection** (on by default for new projects; the owner confirms it), so nobody can probe which emails have accounts;
- confirmed emails (§7.1);
- **API key restriction** to the app's website (§10 step 6).

Never created, used or stored:
- the service-account (admin) key;
- anyone's password in readable form (Firebase stores it hashed; the app never stores it, only Firebase's session tokens);
- the owner's Google login.

## 6. Data and the access rules (the core of the safety)

`uid` = Firebase's random account id. Every rule below also requires `request.auth != null` and `request.auth.token.email_verified == true`. Firestore holds:

| Path | Fields | Who can read | Who can write |
|---|---|---|---|
| `profiles/{uid}` | `name` (1–30 chars, chosen by the person) | the person; their friends | only the person; only `name` |
| `invites/{inviteId}` | `from`, `fromName`, `created`, `expires` (≤ 48 h after `created`), `usedBy` (null until claimed) | its maker (may list their own with `where from == me`); any signed-in person who knows the id (a GET only; 128-bit random id) | create: only as yourself, `created == request.time`, `expires` ≤ 48 h. Claim: only setting `usedBy` from null to yourself, before `expires`, never on your own invite. Delete: only the maker |
| `friendships/{lo}_{hi}` (the two uids **sorted**, so one pair = one document) | `a`, `b` (the two uids, sorted), `inviter`, `acceptor`, `invite`, `created` | `a` and `b` (each may list their own with `where a == me` / `where b == me`) | create: only by `acceptor`, in the same `commit` that claims the invite: `getAfter(invite).usedBy == acceptor` and `get(invite).data.from == inviter`, the invite still null-claimed in `get(...)`, and unexpired. Delete: `a` or `b`. Update: never |
| `locations/{uid}` | `lat`, `lng`, `acc` (metres, 0–5000), `approx` (bool), `at`, `until` | the person; a friend **only while `until` > now AND `at` > now − 3 min** | only the person, via `commit` with `at` set to the server time (`REQUEST_TIME` transform). `until` ≤ `at` + 8 h. Numbers range-checked. No other fields |

- **Friendship check:** `exists(/friendships/{sorted pair})`. One document per pair: if both people invite each other, the second accept finds the friendship already there and only consumes its invite. **Remove** deletes the single document, so access ends both ways.
- **Lists:** a person can list only their own invites and friendships. Nothing can list all profiles or all locations; those are read by exact id only.
- **Emails** are never in Firestore. They live only in Firebase Authentication, which no client can read for other people.
- The rules file is `firebase/firestore.rules` in the repo.

## 7. Behaviour

### 7.1 Account (Settings › You › Account, and from the Friends sheet)

- **Sign up:** email + password (min 8; the app shows the rule) + display name. Firebase sends "confirm your email". Until confirmed, the Friends sheet shows "Check your email" with **Resend** and **I've confirmed**.
- **Sign in / Sign out / Forgot password** (Firebase's reset email).
- **Session:** Firebase's refresh token is kept on the device in localStorage `irn_account`, which is listed on the storage page. The password is never stored. Sign out wipes the session.

### 7.2 Friends via links

- **Inviting:** "Invite a friend" makes an invite and opens the phone's share sheet (or copies the link). The link looks like `…/#invite=<id>`. It is valid 48 h, once.
- **Accepting:** opening the link shows "<Name> wants to be friends on TurkMaps. Accept?". It needs a confirmed account first. Nothing happens without pressing Accept.
- **Friends list:** each friend's name, whether they are sharing now, and a **Remove** button.
- **Your open invites,** each with a **Cancel** button.

### 7.3 Sharing (new bottom-bar button "Friends")

- **The bottom bar** becomes **Map, Friends, Layers, Alerts**. On a computer, a Friends card sits in the right column.
- **Off by default.** To start, press **Share my location**, then pick:
  - a duration: 15 min, 1 h or 8 h (no "forever");
  - **Exact** or **Approximate (about 1 km)**.

  Then the browser asks for location permission.
- **While sharing:**
  - a **"Sharing" pill** stays on top of the map, showing the minutes left and a **Stop** button;
  - the position is sent when it moved more than 25 m, and at least every 2 minutes (a heartbeat), at most every 30 s.
- **Stops when:**
  - Stop is pressed, the time runs out, or the person signs out or deletes the account. The stored position is **deleted** at once.
  - The app is closed or the phone sleeps. No heartbeat comes, and **the rule hides the position from friends within 3 minutes.** The record is deleted the next time the app opens.
- **Friends on the map:** a round marker with their initial, name and "2 min ago". Friends who are not sharing are absent.
- **Approximate mode** rounds to about 1 km **on the phone, before sending.**

### 7.4 Deleting the account

Settings › You › Account › **Delete my account**:
1. The app asks for the password again. This signs the person in fresh, which Firebase requires for deletion.
2. It deletes, in this order: the location, every friendship, their invites, and their profile, all in Firestore.
3. Then it deletes the Firebase account (`accounts:delete`).
4. Then it clears the local session.

If step 3 fails, the app keeps a "deletion not finished" state, says so, and offers **Try again**. The data is already gone by then. Finally, the app lists what was deleted.

## 8. Every safety and protection measure (listed to the owner one by one)

1. **Only accepted friends can see your location.** Firebase's server rules enforce this, not the app.
2. **Friends see it only while your chosen time runs**, and only while your app is actually sending. Within 3 minutes of closing it, you disappear. This is enforced in the rules.
3. **Sharing is off by default** and never starts by itself. There is no "forever": the longest choice is 8 h.
4. **A "Sharing" pill with Stop** stays visible the whole time.
5. **Approximate mode** blurs your position to about 1 km on your phone before anything is sent.
6. **Friend links:** they expire after 48 h, work once, cannot be guessed, need Accept, and can be cancelled.
7. **Removing a friend** cuts access at once, both ways, even if you had invited each other.
8. **Your email is never shown** to friends or stored with your location. Friends see only the name you choose.
9. **Confirmed emails only:** nothing works for an account until its owner confirms the address.
10. **Passwords:** at least 8 characters, stored by Firebase only in hashed form, never kept by the app. You type it again before deleting the account.
11. **No secret key** anywhere in the app or the repo. The admin key is never created.
12. **People who never sign in are untouched:** no request goes to Google.
13. **Delete my account** wipes everything stored about you.
14. **Stop, Sign out and Delete** erase the stored position at once.
15. **Only your latest point is kept:** no history, no trails.
16. **Names are escaped wherever they are shown**, so a friend's name cannot inject code.
17. **Privacy and storage pages** (EN/TR) say what goes to Google, where, why and for how long. The privacy question is asked again.
18. **Firebase's own protections:**
    - email enumeration protection;
    - the API key restricted to the app's website and to the two Firebase APIs it uses;
    - Firebase's built-in limit of 100 new accounts per hour per IP.
19. **Tests:**
    - the rules are tested live against the real project;
    - mutation rows break each safety line on purpose and check that a test notices.

## 9. Testing

- **Unit tests** (`v463.test.cjs`) on the REAL built code:
  - REST request shapes (sign-up, sign-in, refresh, commit with `REQUEST_TIME`, delete order);
  - approximate rounding;
  - duration caps;
  - heartbeat timing;
  - the sharing pill;
  - invite-link parsing;
  - sorted friendship ids;
  - escaping of names;
  - the CSP lists exactly the three new hosts;
  - the rules file's text for each rule in §6.
- **Mutation rows** for each measure in §8 that lives in the code.
- **Live rules check** (`firebase/rules-check.cjs`):
  - It runs by hand after setup, with **two test accounts the owner approves**.
  - They are made by me with generated passwords, recorded only in an untracked local file (never committed, never shown in chat), and deleted afterwards.
  - It tries every forbidden read and write in §6 and expects "permission denied". It tries every allowed one and expects success.
  - The results go in the journal.
- **Browser preview:**
  - sign up, confirmation state and sign in;
  - invite and accept;
  - the sharing pill;
  - the friend marker (with the second test account);
  - delete account.

## 10. What the owner does (the builder cannot)

About 10 minutes in the Firebase console, with step-by-step guidance:
1. Create a project with their Google account (Spark plan, no card). Google Analytics off.
2. In Authentication › Sign-in method, turn on **Email/Password** (not "Email link").
3. Check that **email enumeration protection** is on (Authentication › Settings).
4. Create the **Firestore** database in production mode, in a European region (suggested `europe-west3`, Frankfurt).
5. Paste `firebase/firestore.rules` into Firestore › Rules and publish.
6. In Google Cloud › Credentials, restrict the web API key:
   - **websites:** `https://hero4mohamed.github.io/*` and `http://localhost:8470/*`;
   - **APIs:** Identity Toolkit and Token Service and Cloud Firestore.
7. Give the **public** web config (apiKey, projectId) by chat. It goes in `transit_data/firebase-config.json`.
8. Approve the two test accounts for the live rules check.

Until step 7 is done, Friends shows "not set up yet" and nothing is sent.

## 11. Drafts for later (to remind the owner)

- **Option 3, our own Cloudflare server:** it needs secret keys. Recorded in `Asked-For-But-Not-Built.md`, with a reminder offered after V4.6.3 merges.
- **Sharing while the app is closed:** needs a packaged Android app.
- **Favourite places:** the next update.
- **Play Store:** needs a lawyer's read, the data-safety form, and the KVKK questions (data stored abroad by Google). Recorded in the Play Store checklist.

## 12. Builder's calls (made after the review; the owner can overrule any)

- The rules hide a position **3 minutes** after the last heartbeat, and the app sends a heartbeat every 2 minutes.
- One friendship document per pair, with the uids sorted, so Remove works both ways.
- People can list only their own invites and friendships.
- Delete asks for the password again, deletes the data first, then the account, and offers retry.
- Test accounts use generated passwords kept only in an untracked local file.
- Minimum password length is 8, with no other rules.
- File layout: `src/26-account.js` (REST, session, account UI) and `src/26b-friends.js` (invites, friends, sharing, markers).
- Icons, styling, retry/back-off, offline behaviour and wording in 4 languages are left to the builder.
