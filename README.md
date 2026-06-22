# İstanbul Ray-Net — Live Rail Network Map & Simulation

An interactive map of Istanbul's rail network (metro, Marmaray, trams, funiculars,
Metrobüs and ferries) on a real dark basemap, with animated "live" carriages,
multimodal trip planning, a searchable İETT bus directory, and a Vision & Expansion
tab showing official future projects.

**Live site:** _(GitHub Pages URL appears here once Pages is enabled)_

It's a single self-contained file — open [`index.html`](index.html) in any modern
browser (it needs internet for the map tiles, the Leaflet library, and on-demand
bus-route lookups).

## Features
- Real OpenStreetMap-derived geometry for every operational line.
- Animated carriages with station dwell + predictive arrivals.
- Trip planner (Dijkstra over the whole network) with refresh-safe history & favourites.
- **Tabs:** Active Network · Vision & Expansion (official + İBB projects, dashed) · Bus Directory (855 İETT lines, click to draw the real route).
- Light/Dark/Satellite basemaps, zoom-responsive line thickness, station service hours.

## How it's built
The map is generated from data in [`transit_data/`](transit_data/):

| script | input | output |
|---|---|---|
| `process.cjs` | `network.json` (Overpass) | `lines.json` (active lines) |
| `process-ferry.cjs` | `ferry.json`, `piers.json` | `ferry-lines.json` |
| `process-planned.cjs` | `planned.json` | `planned-lines.json` |
| `process-bus.cjs` | `bus-probe.json` | `bus-directory.json` |
| `build.cjs` | the JSONs + `app.template.html` | **`index.html`** |

`planned-manual.json` holds the hand-placed (approximate) future lines.

### To rebuild after editing the template or data
```bash
cd transit_data
node build.cjs            # regenerates ../index.html
```

### To refresh the source data from OpenStreetMap
The raw Overpass dumps are not committed (large, regenerable). Re-fetch with the
`.overpassql` query files, e.g.:
```bash
curl -s -A "rail-map/1.0" --data-urlencode "data@geom.overpassql" \
  https://overpass-api.de/api/interpreter -o network.json
node process.cjs && node build.cjs
```

## Data sources
OpenStreetMap (geometry & stops), Metro İstanbul project pages (future lines),
İETT (bus directory). Future-line alignments are approximate.
