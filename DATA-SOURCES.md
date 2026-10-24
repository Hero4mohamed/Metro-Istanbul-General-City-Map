# Data sources and their terms

The **code** in this repository is MIT (see `LICENSE`). The **data** is not — it comes from
several third parties on different terms, and some of those terms follow the data when you
redistribute it.

> **This is a record of what each provider states, not legal advice.** Two questions below are
> flagged as needing a qualified Turkish lawyer, and neither should be treated as settled.

## Summary

| Source | Used for | Stated terms | Attribution shown in-app |
|---|---|---|---|
| **OpenStreetMap** (via Overpass) | Rail, tram, ferry and funicular geometry; station positions; Ankara/İzmir/Bursa/Antalya bus routes; **every named street, district, neighbourhood, landmark, shop, café, pharmacy, school, mosque and so on that the search runs on, on the device** (`places-<city>.json`, refreshed monthly by `places.yml`; the processor assigns each place to its district and neighbourhood by point-in-polygon and ranks well-known ones, with a Wikidata entry, higher); **forest, park, campus and airport outlines** painted into the basemap (`landuse-<city>.json`, refreshed monthly by `landuse.yml`) | ODbL 1.0 — attribution **and share-alike** | yes, map credit |
| **OpenFreeMap** (tiles.openfreemap.org) · **OpenMapTiles** schema | The day and night basemaps: vector tiles of OpenStreetMap data, drawn on the device by MapLibre in the app's own palette (`transit_data/src/08-basemap-vector.js`), so names are real text that grows as you zoom and can be thinned out, not a picture. Only the tile files and a small index naming the current data version are fetched; nothing about the user is sent. Tiles stop at zoom 14 and are enlarged beyond that | Free, no key, commercial use stated as allowed, attribution required and shown (its own site, checked 24 Oct 2026). **No SLA** ("I don't offer SLA guarantees or personalized support"); its software is MIT-licensed open source and the public instance can be replaced by a self-hosted one, which a release with real traffic should do (see *Basemap provider risk*) | yes, map credit: OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors |
| **Esri** World Street Map | The **fallback** day and night basemap, used only when the device cannot draw the vector map (no WebGL) or its tiles cannot be reached. The tiles are **recoloured in the browser** into the app's own palette (see `transit_data/src/08-basemap.js`); only Esri's original tiles are fetched and cached, never the recoloured result. Anonymous use of this endpoint in a commercial app is **not something Esri's published terms clearly grant**, which is one reason it is no longer the default | Esri's published terms for its basemap tile services; the keyless endpoint is used as published | yes, map credit: © Esri, HERE, Garmin, USGS, © OpenStreetMap contributors |
| **Esri / Maxar / Earthstar** | Satellite imagery layer | Esri World Imagery terms of use | yes, map credit |
| **İETT** (via İBB Open Data) | İstanbul bus routes, stops and GTFS timetables | İBB Open Data portal terms | yes, "İETT GTFS" on the bus panel |
| **İBB Open Data** | Station registry, lift/escalator counts, live arrivals | İBB Open Data portal terms | yes |
| **İETT service notices** (`api.ibb.gov.tr`, İBB Open Data) | Bus detours, delays, cancelled departures and terminal changes, **read live in the browser** (CORS-open SOAP method `GetDuyurular_json`; nothing is stored in this repository). A detour is drawn on the route only when both stops it names are found on that route's stop list, in order; everything else is shown in İETT's own words | İBB Open Data portal terms | yes, "İETT" on the announcement and the bus panel |
| **Şehir Hatları announcements** (sehirhatlari.istanbul) | Ferry timetable changes, extra and cancelled trips, scraped by `scrape-ferry.cjs` and kept only while their own dates say they matter. The page keeps its text in an ASP.NET view-state (not a documented interface), so a page that cannot be read gives no notice, never a wrong one. Translated into English, Arabic and French by whole-sentence templates for the shapes the operator keeps using (timetable change, event re-routing, cancellation, extra trips, season change, a stop added or restored); every time and date is carried across by capture and a translation whose numbers differ from the original is rejected. Wording the templates do not know (a card-check reminder, an assembly call) stays in the operator's Turkish, labelled as such | No published open-data licence | yes, linked to the announcement |
| **metro.istanbul** | Live service disruptions (scraped); the Vision tab's project facts (contractor, cost, stations) from its public project pages | No published open-data licence | yes, source linked |
| **Municipal, ministry and press sources** (EGO, İzmir BB, Bursa BB, Kocaeli BB, news reports) | Vision tab status, progress and opening targets, read by hand and cited per entry with an as-of date in `planned-registry.json` | n/a: facts cited, nothing copied or scraped | yes, each source linked in the line panel |
| **Kocaeli Büyükşehir / UlaşımPark** | Kocaeli bus routes (scraped from published route pages) | No published open-data licence | yes, operator named |
| **TCDD Taşımacılık** | Intercity rail lines | No published open-data licence | yes |
| **Photon** (komoot) | Optional top-up only: when the offline places file has fewer than two answers, or the query has a number in it (a house number is the one thing the file does not hold), what the user typed (plus the city centre, never their own position) is sent here for what the file cannot hold, such as a house number or a shop that opened last week. Switchable off in Settings → "Look places up online". **Not a dependency**: its own README says heavy use "will be throttled or completely banned" and it promises no availability, so nothing relies on it. A commercial release should self-host Photon, use a paid geocoder, or ship with this off | Free for reasonable use, no guarantee; underlying data ODbL; software Apache-2.0 | yes |
| **Open-Meteo** (forecast + air-quality services) | The Weather tab, for every city: now, the next 24 hours and 7 days for the city centre and each district, plus the European Air Quality Index. One request per refresh (all places at once), nothing stored. The "hints" on the card (rain, gusts, heat, frost, UV, poor air) are arithmetic on those numbers with the thresholds written in the code and tests; they are labelled as not being warnings, and link to the State Meteorological Service for the official ones | Free for non-commercial use, CC-BY 4.0 | yes |
| **OSRM** (routing.openstreetmap.de) | Walking-leg geometry refinement | Public demo server, no SLA; ODbL data | yes |
| **Leaflet** | Map rendering | BSD-2-Clause | in the map credit |
| **MapLibre GL JS** 4.7.1 · **maplibre-gl-leaflet** 0.0.22 | Draws the vector basemap inside the Leaflet map. Shipped in `vendor/` (not loaded from a CDN) with the version and a hash of each file recorded in `vendor/README.md`; a test fails if a file changes without the record | BSD-3-Clause · BSD-2-Clause (licence files in `vendor/maplibre/`) | no |
| **Noto Sans** (as MapLibre glyph files) | The typeface of the map's names, shipped in `vendor/glyphs/` so every name draws offline and a cold start never waits on a font server | SIL Open Font License 1.1 (`vendor/glyphs/LICENSE-NotoSans-OFL.txt`) | no |

## The two things that actually need a decision

**1. ODbL share-alike on the derived data.** A large part of `transit_data/` is a *derived
database* of OpenStreetMap: the stitched line geometry, station registry, and the Ankara bus
graph. ODbL requires that a derived database be offered under ODbL. In practice this repository
already publishes that data openly, which is consistent with it — but "the code is MIT" must not
be read as placing the data under MIT, which is why `LICENSE` says so explicitly. **Whether the
current arrangement fully satisfies ODbL §4.4 is a question for a lawyer**, particularly if the
project is ever monetised or a data file is reused elsewhere.

**2. Scraped operator content.** The disruption text from metro.istanbul, and the Kocaeli route
pages, are scraped from sites with no published open-data licence. The app stores only short
factual service statements, attributes the source, links back, and refreshes rather than
archiving. That is a narrow and conventional use, **but it rests on no explicit permission**. If
this becomes a public product with real traffic, this is the item to raise with a lawyer first,
and the cleaner path is to ask İBB and Kocaeli BB for permission or an API.

## Tile usage policy

Esri's and OpenStreetMap's tile policies prohibit bulk downloading. The offline feature is
deliberately built to respect this: it caches only tiles the user has actually viewed, the
"Save this area" action is user-initiated and capped (~340 tiles for the current view across
four zoom levels), and the cache is LRU-trimmed at 3,000 tiles. Do not raise those limits
without re-reading the providers' terms.

The vector map keeps its tiles the same way, in a cache of its own (`raynet-vtiles-v1`, trimmed at
3,000 files). OpenFreeMap states its limit for apps that keep tiles offline: at most 3,000 tiles or
50 MB, at most 4 requests in parallel, and larger downloads by arrangement with the operator.
"Save this area" stays inside that: it asks for the tile each view will use, once, with four
requests at a time, so saving a screenful fetches about seventy small files (about 2 MB, measured on
Bursa) instead of hundreds of pictures. (A browser cannot set its own User-Agent, which the
operator also asks for; the page's own origin is what the service sees. Another reason to host the
tiles for a release.)
A vector tile's address carries its data version, so a saved tile is never stale; the small index
that names the current version is read from the network whenever there is one.

## Third-party services the browser contacts

Every host the app can reach at run time is enumerated in the Content-Security-Policy emitted by
`transit_data/build.cjs`. Nothing else can be contacted, by design. No user location, saved
place or trip is transmitted to any of them.

The one exception is entirely user-driven: if you paste your own Anthropic API key into
Settings, your assistant questions go to `api.anthropic.com`. The key is stored only in that
browser and is never committed, bundled or sent anywhere else.

## If you reuse this

- **Code**: MIT, keep the notice.
- **OSM-derived data**: ODbL, keep the attribution and honour share-alike.
- **Operator data** (İETT, İBB, metro.istanbul, Kocaeli, TCDD): go to the source. Do not assume
  this repository's copy grants you anything.

## Why Bursa and Antalya have rail but no buses

Not an oversight, and not worth re-investigating without new information. Probed 2026-08-22,
with İzmir's portal as a control so that a local network or TLS problem could be told apart
from a genuinely missing feed:

| Endpoint | Result | Reading |
|---|---|---|
| `acikveri.bursa.bel.tr`, `data.bursa.bel.tr`, `openfiles.bursa.bel.tr` | DNS does not resolve | these hosts do not exist |
| `www.bursa.bel.tr` | 200 | the site is up; its only data link is one meteorology page |
| `acikveri.antalya.bel.tr` | resolves, never answers | portal host exists but is unreachable |
| `ulasim.antalya.bel.tr` | 200 | a DataTables web app — timetables behind a UI, not a feed |
| `api.transit.land` (both cities) | 401 | needs an API key |
| `acikveri.bizizmir.com` (control) | 200 | so the path out is fine |

So neither city publishes an open bus feed that can be fetched. İzmir does, and is now wired in
at operator depth. The remaining route for Bursa/Antalya would be scraping the transport sites
the way Kocaeli was scraped — possible, but unlicensed and fragile, so it is a deliberate
choice not taken rather than a gap nobody looked at.

## Basemap provider risk

CARTO withdrew keyless access in September 2026 by serving an "API KEY REQUIRED" placeholder
image with HTTP 200 for roughly a third of tiles — a failure no status code can see. The app is a
public static site, so a provider that needs a key cannot be used at all (a key in the page is a
key given away). Esri's endpoints are keyless today and the same thing could happen to them.

`npm run check-tiles` (and the daily *Basemap health* workflow) is the alarm: it hashes a grid of
tiles over inland İstanbul and fails if any image repeats, because a placeholder is the same
bytes everywhere and a real map never is. A green run means "not serving placeholders right
now", not "healthy" — the CARTO degradation was intermittent. It watches the Esri raster
tiles, which are now the fallback; the vector map's equivalent failure is a tile service that
does not answer, which the page already handles by switching to the raster map after the first
tile errors (`vecFallback` in `08-map.js`).

**The vector map's provider.** OpenFreeMap's public instance promises no availability (it says so,
and mentions a possible paid plan). That is fine for a project like this one and not for an app people *depend on*.
Before a Play Store release with real traffic, host the tiles yourself — OpenFreeMap's own
software is open source and publishes how, and the style in `08-basemap-vector.js` reads the tiles
from one constant (`VEC_TILEJSON`) — or buy a vector-tile plan from a provider that signs a
service agreement. Nothing else in the app changes: the style asks only for the standard
OpenMapTiles layers, which any such provider serves.
