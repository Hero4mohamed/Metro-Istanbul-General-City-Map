# Alerts badge counts only what is new to you + B2 works notice removed (short design, 21 Nov 2026)

## Why
The Alerts number on the bottom bar counts every live notice (rail faults, ferry notices, one per bus line with İETT
notices), so it sits at 50–60 all day and says nothing. The owner wants it to tell people about **actual new updates**.
B2 Halkalı–Bahçeşehir is running again, so its hand-written works notice must go.

## Goals
- The bottom-bar Alerts badge shows how many **notices you have not seen yet**; 0 (hidden) once you have looked.
- **Anything new or changed counts again**, including a new or changed İETT notice on a bus line already seen
  (owner's decision: "technically new").
- Opening the Alerts card marks everything in it as seen.
- Remove the expired `b2-works-2026` entry.

## Non-goals
- Notices for the other five cities (next piece, research first). Posts from X (parked: needs a secret key and a paid
  plan, owner's later list).
- Push notifications. Syncing "seen" between devices or with an account.

## Anti-goals
- Nothing about what a person has read leaves the device. No new data collected (privacy notice unchanged).
- The badge must never hide a notice that is new or changed. Better to count a reworded notice again than to miss one.

## Approaches (picked: A)
- **A. Remember fingerprints of seen notices on the device** (picked). Each notice → fingerprint of its identity plus its
  content; badge = live notices whose fingerprint is not in the seen set.
- B. Remember the time Alerts was last opened and count notices updated since. Rejected: Metro İstanbul rail notices
  carry no time of their own, so a changed rail notice would be missed.
- C. Remember the count last seen. Rejected: one notice ending as another starts leaves the number unchanged.

## Design
- **Fingerprint** = notice `id` + a short hash of the text a reader sees (message, Turkish message, severity, until,
  affected stations). Bus notices already have ids that include a hash of their text (and one per line for cancelled
  departures, whose hash covers the list of departures), so a new cancellation on the same line is a new fingerprint.
  Rail and ferry ids stay the same when the text changes, which is why the text is part of the fingerprint.
- **What is counted:** every individual live notice the card is built from: rail, ferry, and each bus notice (not
  bus groups). "Opening soon" lines are not notices and are not counted (as today).
- **Seen:** when the Alerts card is opened (bottom-bar Alerts on a phone, the card on a wide screen), every notice in it
  is marked seen. Notices that arrive **while the card is open** are marked seen too, since they are on screen. The bus
  section stays collapsed as today; opening the card counts as seeing it (its header says how many are new).
- **On the card:** rows that were new when you opened it get a small **NEW** tag for that visit; the bus section header
  reads e.g. "🚌 Bus notices · 42 · 3 new". The card header keeps the total.
- **Storage:** `localStorage` key `irn_ann_seen`: the seen fingerprints. *Changed during the build (21 Nov):* the list
  is rewritten only when the card is opened (live first, then older ones, cut at 2,000), never while it is closed. Pruning
  to "what is live" on every refresh threw away every seen bus notice at start-up, because the card is drawn before
  İETT's notices arrive (a reload showed 99+ again). Consequence: a notice that blinks out of a feed and comes back
  unchanged is not new; changed, it is. If storage is unavailable the badge behaves as today
  (counts everything). Clearing site data resets it: everything counts as new once.
- **First run after the update:** everything live is unseen once, so the first number is the full count; one look at
  Alerts brings it to 0.
- **B2:** remove `b2-works-2026` from `transit_data/disruptions-manual.json` (leaves `[]`); the next notices run and the
  build drop it from `disruptions.json` and the fallback copy in `index.html`.
- **Tests:** fingerprint changes when the text changes and not otherwise; badge counts only unseen; opening marks seen;
  a new bus cancellation on a seen line counts; pruning; storage unavailable → full count; B2 gone.

## Left to the builder
Hash function (reuse the existing `_hash`), exact NEW tag styling (follow the existing severity chips), translations of
"new" in the four languages (template strings, no free text).

## Release
**V4.8.3** (owner's name, approved 21 Nov 2026): small update from live `main` on branch `v4-8-3`, separate from V4.9 (PR #46).
