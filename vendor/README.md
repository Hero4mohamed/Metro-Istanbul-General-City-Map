# vendor/

Third-party code the app ships itself rather than loading from a CDN at run time. A CDN is one more thing that can be
down, blocked or changed under a release, and an app inside a Play Store wrapper has to start with no network at all.

## maplibre/

The vector base map. Unmodified files from the npm packages, at exactly these versions:

| File | From | Version | SHA-384 |
|---|---|---|---|
| `maplibre-gl-csp.js` | [maplibre-gl](https://www.npmjs.com/package/maplibre-gl) `dist/maplibre-gl-csp.js` | 4.7.1 | `wkz3bHd2XHn0zfBLsJfGiElUhnowWv/hdfV/QfPpaQXPrS1euKdOIZFHNVrbocON` |
| `maplibre-gl-csp-worker.js` | same package, `dist/maplibre-gl-csp-worker.js` | 4.7.1 | `nihfgYxLAwZc2OGkDb9/UgCi7mzsDxEbeUKuYBlMywKVRZPdD1dNli4fql0bu19P` |
| `maplibre-gl.css` | same package, `dist/maplibre-gl.css` | 4.7.1 | `MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V` |
| `leaflet-maplibre-gl.js` | [@maplibre/maplibre-gl-leaflet](https://www.npmjs.com/package/@maplibre/maplibre-gl-leaflet) | 0.0.22 | `4CB9Vtol9LN6lGgBCvmPLbUEZwilrqIvPieSRurgAXAB7FVJaLS9n8WyAIA5wjQ+` |

The **CSP build** of MapLibre is used on purpose: it runs its worker from a separate same-origin file instead of a `blob:`
URL, so the page's Content-Security-Policy does not have to allow `blob:` workers (`worker-src 'self'` is unchanged).

Licences: `LICENSE-maplibre-gl.txt` (BSD-3-Clause) and `LICENSE-maplibre-gl-leaflet.txt` (BSD-2-Clause).

To upgrade: download the new files from the same paths, update the versions and hashes above, and run `npm test` (a test
checks that the files on disk match the hashes recorded here).

## glyphs/

The font files the vector map draws its names with: Noto Sans (regular, bold, italic) as MapLibre "glyph" files (`.pbf`), for
Latin, Latin Extended-A (the Turkish letters ı ş ğ İ), Cyrillic, Greek / combining marks, Arabic and general punctuation. They are
taken, unchanged, from the OpenFreeMap font service (`https://tiles.openfreemap.org/fonts/Noto%20Sans%20<Style>/<range>.pbf`) on
24 Oct 2026 and are glyph-range encodings of Noto Sans, licensed under the SIL Open Font License 1.1 (`LICENSE-NotoSans-OFL.txt`).

**Why they are shipped rather than fetched.** The font service answers a first request for a file in anywhere from half a second to
twenty-one seconds (measured), and a map tile cannot finish drawing until the fonts for its names have arrived — so a cold cache
meant a blank map. Shipping them also makes every name work offline. A range not listed here is simply drawn without that glyph
(the name is not lost; the one character is skipped).

Arabic names are included for completeness, but drawing Arabic properly (joined letters, right-to-left order) needs MapLibre's
right-to-left text plugin, which this app does not load; until it does, Arabic-script names on the map read as separate letters,
which is why the Arabic interface shows the local (Turkish) names on the map as the other languages do.
