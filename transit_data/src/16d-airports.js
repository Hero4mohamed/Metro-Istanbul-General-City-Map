/* ===========================================================================
   AIRPORTS (V4.5.2)
   Asked for as: Layers, an Airport tab, choose the airport, choose departures or arrivals, see the live table.
   The live table itself cannot be in the app yet: no airport gives its board to other apps, and no free service does either (the
   record is in the project's notes). So this is the honest version of the same path: choose the airport, choose departures or
   arrivals, and one button opens that board on the airport's OWN website, where it is always current. The app fetches nothing
   and shows no flight it did not get from anyone.

   Every address below was opened and answered on 12 Nov 2026. İstanbul Airport, İzmir and Antalya have a page per board (Antalya
   one each for international and domestic); Sabiha Gökçen has one screen for both; Ankara Esenboğa, Bursa Yenişehir and Kocaeli
   Cengiz Topel are on the State Airports Authority's page for all airports, where the airport is chosen from a list (Esenboğa's
   own site was down on the day it was checked).
   ========================================================================== */
/* ==AIRPORTS-PURE-START== */
const AIR_DHMI = 'https://www.dhmi.gov.tr/Sayfalar/TumUcuslar.aspx';
const AIR_SAW = { code:'SAW', name:'Sabiha Gökçen Havalimanı', both:'https://www.sabihagokcen.aero/yolcu-ve-ziyaretciler/yolcu-rehberi/ucus-bilgi-ekrani' };
const AIRPORT_BOARDS = {
  istanbul: [
    { code:'IST', name:'İstanbul Havalimanı', dep:[{ url:'https://www.istairport.com/en/flights/flight-info/departure-flights' }], arr:[{ url:'https://www.istairport.com/en/flights/flight-info/arriving-flights' }] },
    AIR_SAW ],
  ankara:  [ { code:'ESB', name:'Esenboğa Havalimanı', both:AIR_DHMI, pick:true } ],
  izmir:   [ { code:'ADB', name:'Adnan Menderes Havalimanı', dep:[{ url:'https://izmirairport.com/en/departure-flights' }], arr:[{ url:'https://izmirairport.com/en/arrival-flights' }] } ],
  antalya: [ { code:'AYT', name:'Antalya Havalimanı',
               dep:[{ k:'intl', url:'https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/dis-hat-gidis' }, { k:'dom', url:'https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/yurtici-gidis' }],
               arr:[{ k:'intl', url:'https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/dis-hat-gelis' }, { k:'dom', url:'https://www.antalya-airport.aero/yolcu-ve-ziyaretciler/ucus-bilgileri/yurtici-gelis' }] } ],
  bursa:   [ { code:'YEI', name:'Yenişehir Havalimanı', both:AIR_DHMI, pick:true } ],
  kocaeli: [ { code:'KCO', name:'Cengiz Topel Havalimanı', both:AIR_DHMI, pick:true }, AIR_SAW ],
};
function airportBoards(city){ return AIRPORT_BOARDS[city] || []; }
/* The buttons for one airport and one kind of board ('dep' or 'arr'): { links:[{ url, k }], shared, pick }.
   k: '' | 'intl' | 'dom'. shared: the page shows departures and arrivals together. pick: the airport has to be chosen on it. */
function airportLinks(a, kind){
  if(a[kind]) return { links:a[kind].map(l => ({ url:l.url, k:l.k || '' })), shared:false, pick:false };
  return { links:[{ url:a.both, k:'' }], shared:true, pick:!!a.pick };
}
/* the site a button opens, as a person would say it: "istairport.com" */
function airportSite(url){ return String(url).replace(/^https:\/\/(www\.)?/, '').replace(/\/.*$/, ''); }
/* ==AIRPORTS-PURE-END== */

/* `var`: setTab() can run before this file has been read (see the note in 16b-bus-routes.js) */
var airSel = null, airKind = 'dep';
function renderAirports(){
  const box = document.getElementById('airList'); if(!box) return;
  const list = airportBoards(CITY_ID);
  if(!list.some(a => a.code === airSel)) airSel = list.length === 1 ? list[0].code : null;     // one airport: no need to choose it
  box.innerHTML = list.length
    ? list.map(a => `<button class="air-row${a.code === airSel ? ' sel' : ''}" data-code="${attrEsc(a.code)}" aria-pressed="${a.code === airSel}"><span class="air-code">${svgEsc(a.code)}</span><span class="air-name">${svgEsc(a.name)}</span></button>`).join('')
    : `<div class="none">${svgEsc(t('airNone'))}</div>`;
  renderAirBoard();
}
function renderAirBoard(){
  const el = document.getElementById('airBoard'); if(!el) return;
  const a = airportBoards(CITY_ID).find(x => x.code === airSel);
  if(!a){ el.hidden = true; el.innerHTML = ''; return; }
  const got = airportLinks(a, airKind), kindWord = t(airKind === 'dep' ? 'airDep' : 'airArr');
  const kindBtn = (k, icon, key) => `<button data-kind="${k}"${airKind === k ? ' class="active"' : ''} aria-pressed="${airKind === k}">${icon} ${svgEsc(t(key))}</button>`;
  el.hidden = false;
  el.innerHTML = `<div class="seg air-kind" role="group" aria-label="${attrEsc(t('airKind'))}">${kindBtn('dep', '🛫', 'airDep')}${kindBtn('arr', '🛬', 'airArr')}</div>`
    + `<div class="air-h">${svgEsc(a.name)} · ${svgEsc(kindWord)}</div>`
    + got.links.map(l => `<a class="air-open" href="${attrEsc(l.url)}" target="_blank" rel="noopener noreferrer">${svgEsc(t('airOpen').replace('{site}', airportSite(l.url)))}${l.k ? ' · ' + svgEsc(t(l.k === 'intl' ? 'airIntl' : 'airDom')) : ''} ↗</a>`).join('')
    + (got.pick ? `<div class="sp-note">${svgEsc(t('airPick').replace('{name}', a.name))}</div>` : got.shared ? `<div class="sp-note">${svgEsc(t('airShared'))}</div>` : '')
    + `<div class="sp-note">${svgEsc(t('airWhy'))}</div>`;
}
(function(){
  const card = document.getElementById('cardAirports'); if(!card) return;
  card.addEventListener('click', e => {
    const row = e.target.closest('.air-row'), kind = e.target.closest('.air-kind button');
    if(row){
      airSel = row.dataset.code; renderAirports();
      // show where it is, when this city's map knows (the airports the planner can route to)
      const pos = (CITY.airports || []).find(x => x.code === airSel);
      if(pos && typeof map !== 'undefined') map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 12));
    } else if(kind){ airKind = kind.dataset.kind === 'arr' ? 'arr' : 'dep'; renderAirBoard(); }
  });
})();
