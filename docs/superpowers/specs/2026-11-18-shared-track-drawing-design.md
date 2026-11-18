# Shared-track drawing — design

Date: 18 Nov 2026. Owner's go-ahead: "Ok start with shared track drawing" (18 Nov 2026). The design was argued across five Gemini roadmap revisions and four reviews, kept in the owner's records (`Map Building/Ai opinions/`). This file is the version the code follows.

## Why

Where two lines run on the same track (or within a few metres of each other), one is drawn on top of the other and hides it. Measured on 18 Nov 2026 (`checks_2026-11-18.md`, check 4): Antalya T1A+T1B 18.8 km, İstanbul M1A+M1B ~11 km, Bursa B1+B2 ~10.8 km, Kocaeli T1+T2 7.6 km, plus a short İzmir M1/İZBAN stretch.

## Goals

- On a shared stretch, the two lines sit **side by side** with a constant few-pixel gap at every zoom.
- **Only the shared stretch moves.** Each line returns to its true path over a 150 m taper where they part, and stays offset to the end where both lines end together (a shared terminus).
- **When zoomed in far enough that the real tracks are already apart on screen, the shift fades to zero** (shift = only the shortfall below the minimum gap).
- **The two lines always go to opposite sides**, whatever direction each line's points happen to run in.
- **Everything drawn along a line moves with it:** glow/casing, core, the selection glow (`12a-line-glow.js`), disruption stripes (`17-boot.js`), and the moving trains (`09-simulation.js`).
- Works with map turning (`07y-map-turn.js` rotates the panes by CSS, after projection).

## Non-goals

- Ferries (31 İstanbul / 27 Kocaeli overlaps): a separate design ("ferry lane"), not side-by-side.
- Three or more lines on one stretch: none exist on rail today; if found, only the longest pair's run is kept.
- The grey "ghost" network in the Vision tab, station dots and labels stay on the true geometry. Station dots sit between the two lines, which reads as a shared station.

## Approach (chosen)

Screen-space pixel offset applied in Leaflet's projection step, from per-vertex values worked out once at start-up. This was preferred over shifting the coordinates in metres at build time, which looks cramped zoomed out and too wide zoomed in.

- **Detection at start-up**, for live non-ferry line pairs that share at least 2 station names. Sample each line's pieces every 20 m; a sample is "shared" if it is within 10 m of the partner. Runs shorter than 300 m are dropped; gaps up to 400 m inside a run are merged.
- **Distance parameter `s`** along each drawn piece (`line.paths[p]`). Trains move on `line.coords`, which is `line.paths[0]`, so trains and the first piece use the same `s`.
- **Side:** for each pair, the line with the lower ref (A) moves away from the side where B mostly lies; if they coincide, A moves to its left. B moves to the opposite side in A's frame, converted to B's own drawing direction by the sign of the two directions' dot product.
- **Shift in px** = `w(s) × max(0, (targetPx − dGeo/metresPerPx) / 2)`, where `targetPx` = the average of the two lines' core widths at this zoom + 1 px, `w(s)` is the 150 m taper weight, and `dGeo` is the real distance to the partner at `s`.
- **Offset maths:** along the bisector of the neighbouring segments' normals, with a miter scale of 1/cos(half-angle) capped at 1.5×.
- **Vertices are inserted at the taper break-points**, so a 150 m taper is drawn as 150 m even on a long straight segment.

## Left to the builder

Exact constant tuning by eye (gap px, taper length), and the names of functions and regions.
