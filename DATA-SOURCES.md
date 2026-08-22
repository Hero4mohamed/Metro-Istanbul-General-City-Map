# Data sources and their terms

The **code** in this repository is MIT (see `LICENSE`). The **data** is not — it comes from
several third parties on different terms, and some of those terms follow the data when you
redistribute it.

> **This is a record of what each provider states, not legal advice.** Two questions below are
> flagged as needing a qualified Turkish lawyer, and neither should be treated as settled.

## Summary

| Source | Used for | Stated terms | Attribution shown in-app |
|---|---|---|---|
| **OpenStreetMap** (via Overpass) | Rail, tram, ferry and funicular geometry; station positions; Ankara/İzmir/Bursa/Antalya bus routes; POI and category search via Photon | ODbL 1.0 — attribution **and share-alike** | yes, map credit |
| **CARTO** basemaps | Dark and Voyager raster tiles | CARTO basemap terms; free tier for non-commercial use, attribution required | yes, map credit |
| **Esri / Maxar / Earthstar** | Satellite imagery layer | Esri World Imagery terms of use | yes, map credit |
| **İETT** (via İBB Open Data) | İstanbul bus routes, stops and GTFS timetables | İBB Open Data portal terms | yes, "İETT GTFS" on the bus panel |
| **İBB Open Data** | Station registry, lift/escalator counts, live arrivals | İBB Open Data portal terms | yes |
| **metro.istanbul** | Live service disruptions (scraped) | No published open-data licence | yes, source linked |
| **Kocaeli Büyükşehir / UlaşımPark** | Kocaeli bus routes (scraped from published route pages) | No published open-data licence | yes, operator named |
| **TCDD Taşımacılık** | Intercity rail lines | No published open-data licence | yes |
| **Photon** (komoot) | Geocoding and category search over OSM | Free, keyless; underlying data ODbL | yes |
| **Open-Meteo** | Weather context | Free for non-commercial use, CC-BY | yes |
| **OSRM** (routing.openstreetmap.de) | Walking-leg geometry refinement | Public demo server, no SLA; ODbL data | yes |
| **Leaflet** | Map rendering | BSD-2-Clause | in the map credit |

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

CARTO's and OpenStreetMap's tile policies prohibit bulk downloading. The offline feature is
deliberately built to respect this: it caches only tiles the user has actually viewed, the
"Save this area" action is user-initiated and capped (~340 tiles for the current view across
four zoom levels), and the cache is LRU-trimmed at 3,000 tiles. Do not raise those limits
without re-reading the providers' terms.

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
