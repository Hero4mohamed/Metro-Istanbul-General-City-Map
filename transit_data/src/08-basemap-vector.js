/* ===========================================================================
   BASEMAP — the vector map ("Atlas, drawn" rather than "Atlas, regraded").

   WHY THIS EXISTS
   The raster map (08-basemap.js) is Esri's street map regraded as it arrives. Its place and street NAMES are part of
   the picture: a few pixels tall, soft on a phone screen, the same size at every zoom, and impossible to restyle or to
   thin out — "show only the important names from afar, more as you zoom in" is not something a picture can do. Esri's
   own terms for using its tiles in a commercial app are also unconfirmed.

   This draws the same OpenStreetMap data from vector tiles (OpenFreeMap: free, no key, commercial use allowed,
   attribution required) with MapLibre GL, in the SAME palette — every colour below comes from ATLAS_PAL, so the graphite
   night map and the ivory day map look like themselves — and with names that are real text: crisp at any screen
   density, growing as you zoom, and chosen by importance.

   HOW NAMES ARE CHOSEN
   • Areas (districts, neighbourhoods) and streets come from the tiles, each with its own zoom range and size ramp.
   • Everything else (shops, cafés, pharmacies, mosques, hospitals…) comes from the app's own places file — the SAME data
     the search runs on, so a name on the map is a name you can search for, and the other way round. Each type has a
     zoom at which it appears: landmarks and airports from afar, hospitals and malls closer, restaurants and
     pharmacies at street level, shops last.
   • MapLibre places labels so they do not collide, and an earlier layer wins a collision, so the layer order below is
     also the priority order.

   THE PURE BLOCK has no DOM dependency: it is data in, a style object out, so the tests can lift it out of the shipped
   page and check every layer against the tile schema.
   =========================================================================== */
/* ==VECTOR-BASEMAP-PURE-START== */
const VEC_SOURCE = 'openmaptiles', VEC_PLACES = 'places';
const VEC_TILEJSON = 'https://tiles.openfreemap.org/planet';
/* The fonts are shipped with the app (vendor/glyphs, see vendor/README.md): the font service's first answer for a file took
   between half a second and twenty-one, and a map tile cannot finish drawing until its fonts arrive. The page passes the absolute
   address (a worker resolves a relative one against its own file, not the page); this is the form it takes. */
const VEC_GLYPHS = 'vendor/glyphs/{fontstack}/{range}.pbf';
const VEC_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
                        '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
                        'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const VEC_FONT = ['NotoSans-Regular'], VEC_BOLD = ['NotoSans-Bold'], VEC_ITALIC = ['NotoSans-Italic'];

/* Zoom. The app's map (Leaflet) is one level ahead of MapLibre's — a 256-pixel tile against a 512-pixel one — so every
   zoom below is written as the app's own and shifted here, once. */
function vecZ(z) { return z - 1; }
function vecRamp(pairs, base) {
  const a = ['interpolate', base ? ['exponential', base] : ['linear'], ['zoom']];
  pairs.forEach(function (p) { a.push(vecZ(p[0]), p[1]); });
  return a;
}
function vecRgb(c, a) { return a == null || a >= 1 ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

/* The palette. Ground, water, the land-use colours and the road grey are ATLAS_PAL's own, so the two maps agree; what a
   vector map adds (building tone, the colour of writing) is chosen here. `ink` is the main name colour, `ink2` the
   quieter one for streets, and the halo is what keeps either legible over a road. */
function vecColours(tone) {
  const day = tone === 'day', P = day ? ATLAS_PAL.day : ATLAS_PAL.night, B = P.bands, U = P.landuse;
  return {
    day: day,
    ground: P.ground, water: B.water.c, urban: B.urban.c, forest: U.forest, park: U.park, campus: U.campus, airport: U.airport,
    road: day ? [255, 255, 255] : P.roadGrey, roadCasing: day ? [222, 215, 202] : P.roadHalo,
    roadMajor: day ? [251, 228, 184] : P.roadGrey, roadMajorCasing: day ? [226, 196, 140] : P.roadHalo,
    path: day ? [214, 207, 193] : [58, 64, 80],
    building: day ? [231, 225, 213] : [36, 40, 54], buildingEdge: day ? [214, 207, 193] : [24, 28, 38],
    runway: day ? [204, 209, 222] : [84, 94, 122],
    boundary: day ? [196, 190, 178] : [62, 68, 86],
    ink: day ? [27, 36, 51] : [232, 236, 244], ink2: day ? [78, 88, 104] : [174, 182, 199],
    inkWater: day ? [40, 92, 150] : [128, 158, 206], inkPark: day ? [46, 108, 70] : [134, 192, 158],
    halo: day ? [255, 255, 255] : [12, 15, 23], haloA: day ? .92 : .9
  };
}
/* the zoom (in the app's numbering) at which each kind of place first gets a name on the map. Landmarks and airports are
   readable from afar; what you would only want when you are close waits until you are. A type not listed is the last tier. */
/* V4.0: the map names far fewer places. Every shop, café, pharmacy, hotel and school made busy streets crowded, and they are still one
   search away. What stays on the map are the places people look for on a map: where they go as visitors, where they pray, where
   they get help. Kinds not listed here are not drawn at all (they remain searchable). */
/* kind: [zoom for an ordinary one, zoom for a well-known one, the rank that makes one well known]. The places file ranks a place from
   its kind (a museum starts at 2, a mosque at 0) and adds one for a Wikidata entry, so "well known" is a different rank per kind. A
   district view then shows the few that matter (the big museums, the Süleymaniye) and a street view shows the rest of the list. */
const VEC_TIER = {
  airport: [13, 13, 0], stadium: [14, 14, 0], university: [16, 15, 3],                      // big and far-seen
  attraction: [16, 15, 3], museum: [16, 15, 3], tower: [17, 16, 2], historic: [17, 16, 2], viewpoint: [17, 16, 2],   // visitors
  mosque: [16, 15, 1], church: [16, 15, 1], synagogue: [16, 15, 1], worship: [16, 15, 1],                           // worship
  hospital: [16, 15, 2], police: [16, 16, 0]                                                 // help
};
/* Kinds drawn only when well known: a famous park or square, not every pocket garden, gallery or mall. kind: [zoom, the rank needed]. */
const VEC_NOTABLE = { park: [16, 2], square: [16, 3], mall: [16, 2], beach: [17, 1], garden: [17, 2], theatre: [17, 2], gallery: [17, 2], library: [17, 2], government: [17, 2] };
const VEC_TIERS = [13, 14, 15, 16, 17];
/* the zoom a given place appears at, or 0 = not drawn on the map at all */
function vecTierOf(key, rank) {
  const k = VEC_TIER[key];
  if (k) return rank >= k[2] ? k[1] : k[0];
  const n = VEC_NOTABLE[key];
  return n && rank >= n[1] ? n[0] : 0;
}

/* the name in the reader's language. The tiles carry the local (Turkish) name as `name` and, where OpenStreetMap has one,
   an English one as `name_en`. French and Arabic readers get the local name, as they do from the raster map. */
function vecName(lang) {
  return lang === 'en' ? ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']] : ['coalesce', ['get', 'name']];
}

/* `part` splits one style into the two maps the page draws: 'base' (everything except names: land, water, roads, buildings) goes
   BELOW the metro lines, 'labels' (every name) goes ABOVE them, so a line never hides a street or a place. No part = the whole
   style, which is what the tests read. */
function vecStyle(tone, lang, glyphs, part) {
  const V = vecColours(tone), name = vecName(lang), L = [];
  const rgb = vecRgb;
  const halo = rgb(V.halo, V.haloA);
  const fillLayer = function (id, layer, filter, color, opacity, minz, maxz) {
    L.push({ id: id, type: 'fill', source: VEC_SOURCE, 'source-layer': layer, filter: filter, minzoom: minz != null ? vecZ(minz) : 0, maxzoom: maxz != null ? vecZ(maxz) : 24,
             paint: { 'fill-color': color, 'fill-opacity': opacity == null ? 1 : opacity, 'fill-antialias': true } });
  };

  L.push({ id: 'background', type: 'background', paint: { 'background-color': rgb(V.ground) } });

  /* ---- ground: forests, parks, built-up land, campuses ---- */
  fillLayer('landcover-wood', 'landcover', ['==', ['get', 'class'], 'wood'], rgb(V.forest), vecRamp([[8, 0], [11, .85], [13, 1]]));
  fillLayer('landcover-grass', 'landcover', ['in', ['get', 'class'], ['literal', ['grass']]], rgb(V.park), vecRamp([[10, 0], [13, 1]]));
  fillLayer('landuse-urban', 'landuse', ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail', 'industrial']]],
            rgb(V.urban), vecRamp([[9, 0], [12, 1]]));
  fillLayer('landuse-campus', 'landuse', ['in', ['get', 'class'], ['literal', ['school', 'kindergarten', 'university', 'college', 'hospital', 'stadium']]],
            rgb(V.campus), vecRamp([[12, 0], [14, 1]]));
  fillLayer('landuse-green', 'landuse', ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'playground', 'zoo', 'garden']]],
            rgb(V.park), vecRamp([[12, 0], [14, .9]]));
  fillLayer('park', 'park', ['!=', ['get', 'class'], 'nature_reserve'], rgb(V.park), vecRamp([[8, 0], [11, .9], [13, 1]]));
  fillLayer('park-reserve', 'park', ['==', ['get', 'class'], 'nature_reserve'], rgb(V.forest), vecRamp([[8, 0], [11, .7]]));
  /* an airport is a region you can see from afar, as on Google's dark map: the apron and the aerodrome area, lifted a step */
  fillLayer('aeroway-area', 'aeroway', ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'class'], ['literal', ['aerodrome', 'apron', 'terminal', 'heliport']]]],
            rgb(V.airport), vecRamp([[9, 0], [11, 1]]));

  /* ---- water ---- */
  fillLayer('water', 'water', ['!=', ['get', 'class'], 'swimming_pool'], rgb(V.water), 1);
  L.push({ id: 'waterway', type: 'line', source: VEC_SOURCE, 'source-layer': 'waterway', filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]], minzoom: vecZ(9),
           layout: { 'line-cap': 'round' }, paint: { 'line-color': rgb(V.water), 'line-width': vecRamp([[9, .6], [14, 2.4], [18, 8]], 1.4) } });

  /* ---- buildings: a faint footprint from close in, never a texture from afar ---- */
  L.push({ id: 'building', type: 'fill', source: VEC_SOURCE, 'source-layer': 'building', minzoom: vecZ(14.5),
           paint: { 'fill-color': rgb(V.building), 'fill-opacity': vecRamp([[14.5, 0], [16, 1]]), 'fill-outline-color': rgb(V.buildingEdge) } });

  /* ---- roads: ONE colour, hierarchy by width (as the raster map did), casing only by day ---- */
  const KEEP = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'pedestrian', 'path', 'busway'];
  const roadWidth = {
    /* Thin on purpose. The raster map had one road colour a step above the ground, and the metro lines drawn over it are
       the heroes of this app: a road should read as a faint street plan, heavier only where it is a big road. */
    motorway:  [[7, .5], [10, 1.2], [13, 2.6], [15, 5], [17, 10], [19, 22]],
    trunk:     [[8, .4], [10, 1], [13, 2.4], [15, 4.6], [17, 9], [19, 20]],
    primary:   [[9, .4], [11, .9], [13, 2], [15, 3.8], [17, 8], [19, 18]],
    secondary: [[10, .35], [12, .8], [14, 1.9], [16, 4.2], [18, 10], [19, 16]],
    tertiary:  [[11, .3], [13, .7], [15, 1.7], [17, 4.8], [19, 12]],
    minor:     [[12, .25], [14, .6], [16, 1.8], [18, 5], [19, 10]],
    service:   [[14, .25], [16, .9], [18, 2.8], [19, 6]]
  };
  const classFilter = function (cls) { return ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', cls]], ['!=', ['get', 'brunnel'], 'tunnel']]; };
  const roadGroups = [
    ['minor-service', ['minor', 'service'], roadWidth.minor, V.road, 12], ['tertiary', ['tertiary'], roadWidth.tertiary, V.road, 11],
    ['secondary', ['secondary'], roadWidth.secondary, V.road, 10],
    ['primary', ['primary'], roadWidth.primary, V.roadMajor, 9], ['trunk', ['trunk'], roadWidth.trunk, V.roadMajor, 8], ['motorway', ['motorway'], roadWidth.motorway, V.roadMajor, 7]
  ];
  // footpaths and tracks: a thin dashed trace, only close in
  L.push({ id: 'road-path', type: 'line', source: VEC_SOURCE, 'source-layer': 'transportation', minzoom: vecZ(15.5),
           filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', ['path', 'pedestrian', 'track']]]],
           layout: { 'line-cap': 'butt' }, paint: { 'line-color': rgb(V.path), 'line-width': vecRamp([[15.5, .5], [18, 1.6]]), 'line-dasharray': [2, 2], 'line-opacity': .9 } });
  if (V.day) roadGroups.forEach(function (g) {
    L.push({ id: 'road-casing-' + g[0], type: 'line', source: VEC_SOURCE, 'source-layer': 'transportation', minzoom: vecZ(g[4] + 1), filter: classFilter(g[1]),
             layout: { 'line-cap': 'round', 'line-join': 'round' },
             paint: { 'line-color': rgb(g[3] === V.roadMajor ? V.roadMajorCasing : V.roadCasing), 'line-width': vecRamp(g[2].map(function (p) { return [p[0], p[1] + 1.1]; }), 1.3) } });
  });
  roadGroups.forEach(function (g) {
    L.push({ id: 'road-' + g[0], type: 'line', source: VEC_SOURCE, 'source-layer': 'transportation', minzoom: vecZ(g[4]), filter: classFilter(g[1]),
             layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': rgb(g[3]), 'line-width': vecRamp(g[2], 1.3) } });
  });
  // a tunnel is drawn fainter, so it does not read as a street you could walk down
  L.push({ id: 'road-tunnel', type: 'line', source: VEC_SOURCE, 'source-layer': 'transportation', minzoom: vecZ(11),
           filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'brunnel'], 'tunnel'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]]],
           layout: { 'line-cap': 'butt' }, paint: { 'line-color': rgb(V.road), 'line-opacity': .45, 'line-width': vecRamp(roadWidth.secondary, 1.3), 'line-dasharray': [1.6, 1] } });
  L.push({ id: 'aeroway-line', type: 'line', source: VEC_SOURCE, 'source-layer': 'aeroway', minzoom: vecZ(11),
           filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]]],
           paint: { 'line-color': rgb(V.runway), 'line-width': vecRamp([[11, 1.2], [14, 4], [17, 14]], 1.4) } });
  L.push({ id: 'boundary', type: 'line', source: VEC_SOURCE, 'source-layer': 'boundary', minzoom: vecZ(6), maxzoom: vecZ(13),
           filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
           paint: { 'line-color': rgb(V.boundary), 'line-width': .8, 'line-dasharray': [4, 3], 'line-opacity': .8 } });

  /* ---- names ---- */
  const text = function (size, color, font, extra) {
    return Object.assign({ 'text-field': name, 'text-font': font || VEC_FONT, 'text-size': size, 'text-max-width': 8, 'text-padding': 2 }, extra || {});
  };
  const paintText = function (color, hw) { return { 'text-color': rgb(color), 'text-halo-color': halo, 'text-halo-width': hw == null ? 1.7 : hw, 'text-halo-blur': .4 }; };

  // places, importance first: a big city wins a collision with a small suburb
  [['place-city', ['city'], 6, 12, [[6, 13], [10, 19], [12, 24]], VEC_BOLD, V.ink],
   ['place-town', ['town'], 8, 14, [[8, 11.5], [12, 15], [14, 18]], VEC_BOLD, V.ink],
   ['place-village', ['village', 'hamlet', 'island', 'islet'], 11, 16, [[11, 11], [14, 13.5], [16, 16]], VEC_FONT, V.ink2],
   ['place-suburb', ['suburb'], 11.5, 19, [[11.5, 11], [13, 12.5], [15, 15], [17, 19], [19, 24]], VEC_BOLD, V.ink],
   ['place-quarter', ['quarter', 'neighbourhood'], 13.5, 19, [[13.5, 10.5], [15, 12.5], [17, 16], [19, 21]], VEC_FONT, V.ink2]
  ].forEach(function (p) {
    L.push({ id: p[0], type: 'symbol', source: VEC_SOURCE, 'source-layer': 'place', minzoom: vecZ(p[2]), maxzoom: vecZ(p[3] + 1),
             filter: ['in', ['get', 'class'], ['literal', p[1]]],
             layout: text(vecRamp(p[4], 1.2), null, p[5], { 'symbol-sort-key': ['get', 'rank'], 'text-letter-spacing': p[0] === 'place-suburb' ? .04 : 0 }),
             paint: paintText(p[6], 2) });
  });
  L.push({ id: 'aerodrome-label', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'aerodrome_label', minzoom: vecZ(9),
           layout: text(vecRamp([[9, 11], [13, 13], [16, 16]]), null, VEC_BOLD, { 'text-max-width': 7 }), paint: paintText(V.ink, 2) });
  L.push({ id: 'water-label', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'water_name', minzoom: vecZ(7),
           layout: text(vecRamp([[7, 11], [12, 13], [16, 16]]), null, VEC_ITALIC, { 'text-max-width': 7, 'text-letter-spacing': .08 }), paint: paintText(V.inkWater, 1.6) });
  L.push({ id: 'waterway-label', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'waterway', minzoom: vecZ(13), filter: ['has', 'name'],
           layout: text(vecRamp([[13, 10.5], [17, 14]]), null, VEC_ITALIC, { 'symbol-placement': 'line', 'text-letter-spacing': .06 }), paint: paintText(V.inkWater, 1.4) });
  L.push({ id: 'peak-label', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'mountain_peak', minzoom: vecZ(12),
           layout: text(vecRamp([[12, 10.5], [16, 13]]), null, VEC_FONT, { 'text-anchor': 'top', 'text-offset': [0, .3] }), paint: paintText(V.inkPark, 1.6) });

  // street names run ALONG the street, and are small from afar and grow as you come in
  [['road-label-major', ['motorway', 'trunk', 'primary'], 11, [[11, 10.5], [14, 12.5], [17, 15.5], [19, 19]]],
   ['road-label-secondary', ['secondary', 'tertiary'], 13, [[13, 10.5], [15, 12], [17, 14.5], [19, 18]]],
   ['road-label-minor', ['minor', 'service', 'pedestrian', 'path', 'track'], 15, [[15, 10.5], [17, 13.5], [19, 17]]]
  ].forEach(function (g) {
    L.push({ id: g[0], type: 'symbol', source: VEC_SOURCE, 'source-layer': 'transportation_name', minzoom: vecZ(g[2]),
             filter: ['in', ['get', 'class'], ['literal', g[1]]],
             layout: text(vecRamp(g[3], 1.2), null, VEC_FONT, { 'symbol-placement': 'line', 'symbol-spacing': 320, 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'viewport',
                                                               'text-max-angle': 40, 'text-padding': 3, 'text-letter-spacing': .02 }),
             paint: paintText(V.ink2, 1.9) });
  });
  L.push({ id: 'housenumber', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'housenumber', minzoom: vecZ(17.5),
           layout: { 'text-field': ['get', 'housenumber'], 'text-font': VEC_FONT, 'text-size': vecRamp([[17.5, 10], [19, 13]]), 'text-padding': 1 },
           paint: paintText(V.ink2, 1.4) });

  /* ---- the places people go: shops, food, health, worship… from the app's own file (empty until it has loaded) ---- */
  VEC_TIERS.forEach(function (tier) {
    const f = ['==', ['get', 'tier'], tier];
    // names only, no marker: a dot for every shop made a busy street look crowded, and the name says what it needs to
    L.push({ id: 'poi-label-' + tier, type: 'symbol', source: VEC_PLACES, minzoom: vecZ(tier), filter: f,
             layout: { 'text-field': ['coalesce', ['get', lang === 'en' ? 'en' : (lang === 'ar' ? 'ar' : 'n')], ['get', 'n']], 'text-font': VEC_FONT,
                       'text-size': vecRamp([[tier, 10.5], [tier + 2, 12], [tier + 4, 14]], 1.2), 'text-anchor': 'center',
                       'text-max-width': 9, 'text-padding': 3, 'symbol-sort-key': ['-', 0, ['get', 'r']] },
             paint: paintText(V.ink, 1.6) });
  });
  // the tiles' own places of interest, until the app's file is there (and for a city that has none): the few the tiles carry
  L.push({ id: 'poi-tiles', type: 'symbol', source: VEC_SOURCE, 'source-layer': 'poi', minzoom: vecZ(15), metadata: { fallback: true },
           filter: ['all', ['<=', ['get', 'rank'], 12], ['!', ['in', ['get', 'class'], ['literal', ['bus', 'railway', 'parking', 'entrance', 'ferry_terminal']]]]],
           layout: text(vecRamp([[15, 10.5], [18, 13]]), null, VEC_FONT, { 'text-anchor': 'top', 'text-offset': [0, .4], 'text-padding': 3, 'text-optional': true }),
           paint: paintText(V.ink, 1.6) });

  const wanted = part === 'base' ? function (l) { return l.type !== 'symbol'; } : part === 'labels' ? function (l) { return l.type === 'symbol'; } : null;
  const sources = {};
  sources[VEC_SOURCE] = { type: 'vector', url: VEC_TILEJSON };
  if (part !== 'base') sources[VEC_PLACES] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };   // only names read the app's own places
  return {
    version: 8, name: 'raynet-' + tone + (part ? '-' + part : ''),
    glyphs: glyphs || VEC_GLYPHS,
    sources: sources,
    layers: wanted ? L.filter(wanted) : L
  };
}
/* The places file as GeoJSON, once: every kind of place the tiles do not name well. Areas and streets are left to the tiles
   (they name them better, along the street, at the right size); water and peaks too; and "other" is taxi ranks. `meta` is the
   type table (icon, group) the search uses, passed in so this stays free of the page. */
function vecPlacesData(G, meta) {
  const feats = [];
  for (let i = 0; i < G.n; i++) {
    const key = G.types[G.t[i]], m = meta[key], tier = vecTierOf(key, G.r[i]);
    if (!m || !tier || m[1] === 'area' || m[1] === 'street') continue;       // shops, food, hotels and the like are not drawn (V4.0)
    const props = { n: G.name[i], tier: tier, r: G.r[i] };
    if (G.en[i]) props.en = G.en[i];
    if (G.ar[i]) props.ar = G.ar[i];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [G.lng[i], G.lat[i]] }, properties: props });
  }
  return { type: 'FeatureCollection', features: feats };
}
/* ==VECTOR-BASEMAP-PURE-END== */

/* ---- everything below talks to the page: WebGL, Leaflet, the places file, the language ------------------------- */
/* Can this device draw it at all? No WebGL (an old phone, a blocked context) or the libraries failed to load: the raster
   map is used instead, exactly as before. */
function vecSupported() {
  try {
    if (typeof maplibregl === 'undefined' || typeof L === 'undefined' || !L.MaplibreGL) return false;
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}
const VEC_LAYERS_BY_NAME = /^(place-|aerodrome-label|water-label|waterway-label|peak-label|road-label-|poi-tiles)/;
const VEC = { layers: [], places: null };
const VEC_LABEL_PANE = 'vecLabelPane';       // created in 08-map.js, above the lines (overlay pane) and below the markers
const VEC_GLYPHS_ABS = new URL('vendor/glyphs/', document.baseURI).href + '{fontstack}/{range}.pbf';

/* The Leaflet layer that hosts the GL map. It is a real layer, so the code that swaps base maps (add, remove, send to back)
   needs no special case, and a stand-in for the few tile-layer methods the app calls on whatever the base is. */
const VectorBase = (typeof L !== 'undefined' && L.MaplibreGL) ? L.MaplibreGL.extend({
  initialize: function (key, tone) {
    this._key = key; this._tone = tone; this._places = null;
    const px = Math.min(window.devicePixelRatio || 1, 2.5);
    L.MaplibreGL.prototype.initialize.call(this, { style: vecStyle(tone, lang, VEC_GLYPHS_ABS, 'base'), attribution: VEC_ATTRIBUTION, pixelRatio: px,
                                                  fadeDuration: 180, maxZoom: 19 });
    /* The names are a second, transparent map drawn in a pane ABOVE the metro lines (V4.0). The lines are Leaflet layers and a
       GL map in the tile pane always sits beneath them, so names there were hidden wherever a line ran over a street or a place.
       Both maps read the same tiles, which the service worker keeps, so the second one costs drawing, not downloading. */
    this._labels = L.maplibreGL({ style: vecStyle(tone, lang, VEC_GLYPHS_ABS, 'labels'), pane: VEC_LABEL_PANE, pixelRatio: px, fadeDuration: 180, maxZoom: 19 });
    VEC.layers.push(this);
  },
  onAdd: function (map) {
    L.MaplibreGL.prototype.onAdd.call(this, map);
    const g = this._glMap, self = this;
    let ready = false, errors = 0;
    g.on('error', function () { errors++; });
    g.once('load', function () { ready = true; });
    this._labels.addTo(map);
    if (this._labels._glMap) this._labels._glMap.once('load', function () { self._applyPlaces(); });
    // a style that never arrives (the tile service is unreachable, the worker was blocked): fall back to the raster map
    setTimeout(function () { if (!ready && errors > 0 && self._map && typeof vecFallback === 'function') vecFallback(self._key); }, 15000);
  },
  onRemove: function (map) {
    if (this._labels && this._labels._map) map.removeLayer(this._labels);
    L.MaplibreGL.prototype.onRemove.call(this, map);
  },
  /* the app's own file of places, shown as names; kept so a re-added layer (a base-map switch builds a new GL map)
     gets it again */
  setPlaces: function (fc) { this._places = fc; this._applyPlaces(); },
  _applyPlaces: function () {
    const g = this._labels && this._labels._glMap; if (!g || !this._places || !g.isStyleLoaded || !g.getSource(VEC_PLACES)) return;
    g.getSource(VEC_PLACES).setData(this._places);
    if (g.getLayer('poi-tiles')) g.setLayoutProperty('poi-tiles', 'visibility', 'none');   // the app's file names more, and better
  },
  /* the language of every name changed: say so to the layers that carry one, in place (no new map, no flicker) */
  applyLang: function (lg) {
    const g = this._labels && this._labels._glMap; if (!g || !g.isStyleLoaded()) return;
    g.getStyle().layers.forEach(function (l) {
      if (VEC_LAYERS_BY_NAME.test(l.id)) g.setLayoutProperty(l.id, 'text-field', vecName(lg));
      else if (/^poi-label-/.test(l.id)) g.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', lg === 'en' ? 'en' : (lg === 'ar' ? 'ar' : 'n')], ['get', 'n']]);
    });
  },
  // the few tile-layer methods the app calls on the current base
  bringToBack: function () { const c = this.getContainer && this.getContainer(); if (c && c.parentNode) c.parentNode.insertBefore(c, c.parentNode.firstChild); return this; },
  redraw: function () { return this; },
  once: function (type, fn, ctx) {
    if (type !== 'load') return L.MaplibreGL.prototype.once.call(this, type, fn, ctx);
    const self = this;
    const go = function () {
      const g = self._glMap; if (!g) return;
      if (g.loaded() && !g.isMoving()) setTimeout(fn, 0); else g.once('idle', fn);
    };
    if (this._glMap) go(); else L.MaplibreGL.prototype.once.call(this, 'add', go);
    return this;
  }
}) : null;

/* hand the places file to every vector map, once it is loaded (called from gazLoad) */
function vecPushPlaces() {
  if (!GAZ.G || !VEC.layers.length) return;
  if (!VEC.places) VEC.places = vecPlacesData(GAZ.G, GAZ_TYPE_META);
  VEC.layers.forEach(function (b) { b.setPlaces(VEC.places); });
}
/* the interface language changed */
function vecApplyLang() { VEC.layers.forEach(function (b) { if (b._map) b.applyLang(lang); }); }
/* The CSP build of MapLibre runs its worker from a file of its own instead of a blob: URL, so the page's policy does not have
   to allow blob workers. It has to be told where that file is, before the first map is made. */
if (typeof maplibregl !== 'undefined' && maplibregl.setWorkerUrl) maplibregl.setWorkerUrl('vendor/maplibre/maplibre-gl-csp-worker.js');
