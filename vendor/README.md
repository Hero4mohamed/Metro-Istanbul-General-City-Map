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

## fonts/

The app's own three typefaces — **Inter** (text), **Space Grotesk** (headings) and **JetBrains Mono** (numbers) — as variable
WOFF2 files, Latin and Latin-Extended only (the second holds the Turkish letters İ ı ş ğ). They are taken, unchanged, from the Google
Fonts CDN on 3 Nov 2026 and are licensed under the SIL Open Font License 1.1 (`fonts/LICENSE-OFL.txt`). The `@font-face` rules that
use them are at the top of the stylesheet in `transit_data/app.template.html`.

**Why they are shipped rather than loaded from Google Fonts.** Until V4.3 the page loaded them from `fonts.googleapis.com` /
`fonts.gstatic.com` on every visit, which tells Google the address of every visitor (and a German court has held that a breach of
privacy law). The app's rule is that it contacts only the services it needs to do its job, so a typeface is not one of them. The
Content-Security-Policy no longer allows either Google host, and a test fails if a font file changes without a new hash here.

| File | What | SHA-384 |
|---|---|---|
| `Inter-latin-ext.woff2` | Inter variable (400 800), latin-ext | `r0EoKgCx3XyQjhJdTJ6FDE+8mEZrV95dM7cWvqLDUVdqzM44cq76qdOaYiA3sebS` |
| `Inter-latin.woff2` | Inter variable (400 800), latin | `l0ql7Q1zqvX5klAVRwYjcMVCkCxg5dMTdghsIlC3pYkX6wwEHerh2bP/4yAao3Im` |
| `JetBrainsMono-latin-ext.woff2` | JetBrains Mono variable (500 800), latin-ext | `md7lI+WpzcaSgfuu+hCajR6cBH9KQiGR2BEnokGhah1MOLT+PY8Tb5r5PUYGeiuQ` |
| `JetBrainsMono-latin.woff2` | JetBrains Mono variable (500 800), latin | `9wWypBPwJyfsOnJFplExHD+Wz+6/I6+rtL7ITgA/6wSPgpj+tnQovOLWM9j2rhOF` |
| `SpaceGrotesk-latin-ext.woff2` | Space Grotesk variable (500 700), latin-ext | `pfXgxFzpO9ikTCbPzbYqL7ZT41jx4+WxzPypqQTlIdFkwrkLyP7wn+Ud0dNmATFv` |
| `SpaceGrotesk-latin.woff2` | Space Grotesk variable (500 700), latin | `bFyCnQmP7dzdczmuaRhRu9VULfsqiMtFsiHv7/FBcJIjF1yOWpNedOO2AvXF0RfE` |

## leaflet/

The map engine itself. [Leaflet](https://leafletjs.com/) 1.9.4, unmodified, byte for byte the files the page used to load from
`unpkg.com` (the old pinned integrity values, `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=` for the script and
`sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` for the stylesheet, still match them). Taken on 3 Nov 2026. BSD-2-Clause
(`leaflet/LICENSE`).

**Why it is shipped rather than loaded from unpkg.** Every visit used to tell a third party the visitor's address, and the app could
not start at all if that host was down or blocked. The Content-Security-Policy no longer allows `unpkg.com`, and the service worker
no longer caches third-party hosts; a test fails if the page names a script or stylesheet on another host.

| File | What | SHA-384 |
|---|---|---|
| `leaflet.js` | `dist/leaflet.js` | `cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH` |
| `leaflet.css` | `dist/leaflet.css` | `sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H` |
| `LICENSE` | BSD-2-Clause text | `CXYK4I2izUBQWizu8sKhYyBLtabBOMnWJhiEcYE2hnY+ov3P+/NGnAkucH4hN0hK` |
| `images/layers.png` | layers control icon | `80x85ZS+G189o0xL8E8D7BnfhuNss6EwUPHzG7e+qByRD2xnpxikZ6UQU4Re5nNy` |
| `images/layers-2x.png` | same, high-density screens | `+F2ZWK/HTpkV9kN2HnMGCQOTM/cnQJLs770FLOeHznwVWRfDESI8z4JwcGYmy2Au` |
| `images/marker-icon.png` | default marker | `wg83fCOXjBtqzFAWhTL9Sd9vmLUNhfEEzfmNUX9zwv2igKlz/YQbdapF4ObdxF+R` |
| `images/marker-icon-2x.png` | same, high-density screens | `bDEa1RhAAKIr/VQnMZ7gUhhXwmKYB4V0g8AsxOvCEPwGxfHCUEzAEMAEEzkjuxiA` |
| `images/marker-shadow.png` | marker shadow | `dB8ivfvPGb1MSIzX8oWTakCxmq+VwqP/QL1TX4jT4INR3pM5T4FgF3Gx4mN3NTMq` |

To upgrade: download the new files from the same package paths, update the version and the hashes above, and run `npm test`.
