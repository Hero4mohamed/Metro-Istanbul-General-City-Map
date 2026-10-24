/* An invented city for the place-search tests: two districts, two neighbourhoods, a street in pieces, a chain, a landmark.
 * It sits in real Kadıköy / Üsküdar coordinates so it can also be loaded into the running app as a stand-in places file. */
/* ---- an invented city: two districts, two neighbourhoods, a street in pieces, a chain, a landmark ---- */
const sq = (s, n, w, e) => [[s, w], [s, e], [n, e], [n, w], [s, w]];
function rawCity() {
  const way = (id, name, lat, lon, len, hw, extra) => Object.assign({ id, name, hw: hw || 'residential', lat, lon, len }, extra || {});
  const poi = (id, tags, lat, lon) => ({ id: 'n' + id, tags, lat, lon });
  return {
    city: 'testcity', osmBase: 'test', box: { s: 40.9, n: 41.1, w: 28.9, e: 29.2 },
    admin: [
      { id: 1, level: 6, name: 'Kadıköy', rings: [sq(40.95, 41.0, 29.0, 29.1)], centre: [40.975, 29.05] },
      { id: 2, level: 6, name: 'Üsküdar', rings: [sq(41.0, 41.05, 29.0, 29.1)], centre: [41.025, 29.05] },
      { id: 3, level: 8, name: 'Moda Mahallesi', rings: [sq(40.96, 40.98, 29.02, 29.04)], centre: [40.97, 29.03] },
      { id: 4, level: 8, name: 'Caddebostan Mahallesi', rings: [sq(40.97, 40.99, 29.05, 29.08)], centre: [40.98, 29.065] },
    ],
    streets: [
      // one street, cut at junctions into three ways that follow on from each other (about 800 m each)
      way(10, 'Bağdat Caddesi', 40.975, 29.0600, 800, 'primary'), way(11, 'Bağdat Caddesi', 40.975, 29.0690, 800, 'primary'),
      way(12, 'Bağdat Caddesi', 40.975, 29.0780, 800, 'primary'),
      // the same name in the other district is another street
      way(13, 'Bağdat Caddesi', 41.010, 29.0300, 1600, 'primary'),
      // "1. Sokak" in two neighbourhoods is two streets, not one
      way(20, '1. Sokak', 40.965, 29.025, 90), way(21, '1. Sokak', 40.980, 29.060, 90),
      way(30, 'Moda Caddesi', 40.968, 29.030, 700, 'tertiary', { en: 'Moda Avenue' }),
    ],
    pois: [
      poi(1, { name: 'Starbucks', amenity: 'cafe' }, 40.9700, 29.0300),
      poi(2, { name: 'Starbucks', amenity: 'cafe' }, 41.0200, 29.0200),
      poi(3, { name: 'Moda Eczanesi', amenity: 'pharmacy' }, 40.9710, 29.0310),
      poi(4, { name: 'Gül Eczanesi', amenity: 'pharmacy' }, 41.0300, 29.0500),
      poi(5, { name: 'Galata Kulesi', tourism: 'attraction', 'name:en': 'Galata Tower', wikidata: 'Q1' }, 41.0200, 29.0600),
      poi(6, { name: 'Moda', place: 'suburb' }, 40.9770, 29.0300),
      poi(7, { name: 'Kadıköy Devlet Hastanesi', amenity: 'hospital' }, 40.9900, 29.0700),
      poi(8, { name: 'Şifa Eczanesi', amenity: 'pharmacy', 'name:ar': 'صيدلية الشفاء' }, 40.9800, 29.0500),
      poi(9, { name: 'Merkez Camii', amenity: 'place_of_worship', religion: 'muslim' }, 40.9650, 29.0250),
      poi(10, { name: 'Migros', shop: 'supermarket' }, 40.9720, 29.0320),
      // the same café twice, as a building and as an entrance node, 20 m apart: one place
      poi(11, { name: 'Moda Sahil Cafe', amenity: 'cafe' }, 40.97500, 29.03500), poi(12, { name: 'Moda Sahil Cafe', amenity: 'cafe' }, 40.97510, 29.03510),
    ].concat([1, 2, 3, 4, 5, 6].map(i => poi(100 + i, { name: 'Zeytin Market', shop: 'convenience' }, 40.96 + i * 0.002, 29.01 + i * 0.001))),
  };
}

module.exports = { rawCity, sq };
