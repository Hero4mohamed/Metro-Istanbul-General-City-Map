# TurkMaps relay

The one server-side part of TurkMaps. It exists for a single job: **İstanbul's live bus positions**.

## Why it is needed, and why it has two halves

İETT publishes where every İstanbul bus is (İBB open data, no key). Two things stop the app from reading it directly:

1. İETT's server sends no CORS header, so a browser will not hand its answer to a web page.
2. İETT's server does not answer Cloudflare at all. Measured on 12 Nov 2026: requests from the Worker (which Cloudflare ran in
   Amsterdam, with and without a placement hint) timed out, while the same request from a home connection in Türkiye is answered
   in about a second. Metro İstanbul's site behaves the same way; the ferry site answers.

So the relay is:

| Half | Where it runs | What it does |
|---|---|---|
| **Worker** (`src/worker.mjs`) | Cloudflare (free plan) | The address the app asks. Keeps the list of lines people have open and the feeder's last answer for each (a small D1 database, `schema.sql`), and adds the header that lets the TurkMaps page, and only it, read the answer. |
| **Feeder** (`feeder.cjs`) | Any always-on computer **in Türkiye** | Every 5 s asks the Worker which lines are open, asks İETT about just those (each at most every 15 s), pushes the answers to the Worker. |

With no feeder running, the Worker answers `503 no-feed` and the app shows no buses and says so. Nothing is invented and an old
answer is never served as new (answers older than 60 s are dropped).

## What it keeps

Line codes and times: which lines were asked for in the last ten minutes, and İETT's last answer for each. Nothing about who
asked: no IP address, no identifier, no cookie. Logging (`observability`) is off. Cloudflare itself processes the visitor's IP
address to deliver the answer, as any host does.

## Running the feeder

It needs Node 18+ and `curl`, and two values, in the environment or in `relay/feeder.env` (git-ignored):

```
RELAY_URL=https://turkmaps-relay.turkmaps-relay.workers.dev
FEED_TOKEN=<the same secret the Worker holds>
```

```
node relay/feeder.cjs          # runs until stopped
node relay/feeder.cjs --once   # one round, for a test
```

While it runs, İstanbul's live buses work for everyone. While it is off, they do not. To keep it running it has to be started
with the computer (a scheduled task on Windows, a systemd service on a Raspberry Pi or a server); that is a decision for the
owner of the machine and is not set up by this repository.

Cost on the machine: with nobody looking at a bus line, one small request every 5 seconds. Per open line, one İETT request
every 15 seconds (a few kilobytes).

## Deploying the Worker

```
cd relay
npm install
npx wrangler login                 # once, opens the browser
npx wrangler d1 create turkmaps-relay                                  # once; put the id it prints into wrangler.toml
npx wrangler d1 execute turkmaps-relay --remote --file schema.sql      # once
npx wrangler secret put FEED_TOKEN                                     # once; a long random value, the same one the feeder holds
npx wrangler deploy
```

If the Worker's address changes (another account, or the account's `workers.dev` subdomain is renamed), three places must
change with it: `LIVE_RELAY` in `transit_data/src/16c-live-buses.js`, the `connect-src` list in `transit_data/build.cjs`, and
the host in `transit_data/legal-content.cjs`. Tests fail if they disagree.

## Limits (Cloudflare free plan, as published in Nov 2026; check before relying on them)

- 100,000 Worker requests a day. A phone with a line open asks every 20 s; the feeder asks every 5 s (about 17,000 a day).
- D1: 100,000 rows written a day. A running feeder costs about 17,000 a day by itself (its "I am alive" mark every 5 s); each
  line that is open costs up to 7 a minute (4 answers, 3 "wanted" marks). About seven lines open around the clock is the
  ceiling; beyond that the write limit is reached and the relay stops updating until the next day.

## Endpoints

| | | |
|---|---|---|
| `GET /iett/buses?line=34G` | public | `{ line, at, now, buses:[{ id, lat, lng, t, to, stop }] }`, or the same with `warming:true` while the first answer is on its way, or `503 {"error":"no-feed"}` |
| `GET /health` | public | whether a feeder is alive, and where the Worker ran |
| `GET /feed/wanted` | feeder (Bearer token) | the lines to fetch |
| `POST /feed/push` | feeder (Bearer token) | `{ lines: { "34G": [İETT's records] or null } }` |

Tests: `transit_data/test/relay.test.cjs` (run by `npm test` at the repository root).
