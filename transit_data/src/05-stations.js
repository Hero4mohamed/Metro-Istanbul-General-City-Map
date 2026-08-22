/* ===========================================================================
   2. STATION REGISTRY (merge same-named stops → interchanges)
   =========================================================================== */
const _foldMemo = new Map();
const fold = s => {
  if(!s) return "";
  let v = _foldMemo.get(s);
  if(v === undefined){
    v = s.toLocaleLowerCase("tr").replace(/\s+/g," ").trim();
    if(_foldMemo.size > 40000) _foldMemo.clear();     // queries are unbounded; names are not
    _foldMemo.set(s, v);
  }
  return v;
};
// one collator, reused. String.localeCompare(x,"tr") builds a fresh ICU collator per call,
// which dominates any sort of more than a handful of names.
const TR_COLLATOR = new Intl.Collator("tr");
const trCmp = (a,b) => TR_COLLATOR.compare(a,b);
const TRANSFER_M = 400;     // max walking-interchange distance (m)
// Cluster stops into interchanges by name AND proximity — same name far apart
// (e.g. the three different "Göztepe" stations ~20 km apart) stays separate.
const stationList = [];
const _clusterByName = new Map();          // folded name -> clusters carrying it
liveLines.forEach(line => {
  line.stations.forEach((st, idx) => {
    const f = fold(st.name);
    if(!f) return;
    let bucket = _clusterByName.get(f);
    if(!bucket){ bucket = []; _clusterByName.set(f, bucket); }
    // same folded name is guaranteed by the bucket, so only proximity is left to test
    let cl = bucket.find(r => metersBetween([r.lat,r.lng],[st.lat,st.lng]) < TRANSFER_M);
    if(!cl){ cl = { name:st.name, lat:st.lat, lng:st.lng, lines:new Set(), nodes:[] };
             stationList.push(cl); bucket.push(cl); }
    cl.lines.add(line.ref);
    cl.nodes.push({ ref:line.ref, idx, s:st._s });
  });
});
const interchange = new Set(stationList.filter(r=>r.lines.size>1).map(r=>r.name));

/* --- match the İBB/OSM accessibility records to our network stations (once, at load).
   Conservative: exact fold → punctuation-normalized → a *single* unambiguous token-subset
   match (İBB uses short names like "EMNİYET" where we show "Emniyet - Fatih"). Names that
   can't be matched confidently stay UNKNOWN — we never assert step-free without evidence. --- */
const accNorm = s => fold(s).replace(/[^\p{L}\p{N} ]+/gu,' ').replace(/\s+/g,' ').trim();
const ACC_GENERIC = new Set(['mahallesi','mah','istasyon','durağı','durağ','havalimanı','merkez','cami','camii','meydanı','yolu','caddesi','konutları']);
// a is a *token-contiguous* substring of b ("emniyet" ⊂ "emniyet fatih", but "atatürk oto sanayi" ⊄ "atatürk havalimanı")
const accContig = (a,b)=> a===b || b.startsWith(a+' ') || b.endsWith(' '+a) || b.includes(' '+a+' ');
let accByStation = null;               // folded network station name -> accessibility record
function buildAccessIndex(){
  accByStation = new Map();
  const byFold=new Map(), byNorm=new Map();
  for(const r of ACCESS_RAW){ const f=fold(r.name); if(!byFold.has(f)) byFold.set(f,r);
    const n=accNorm(r.name); if(!byNorm.has(n)) byNorm.set(n,r); }
  const recs = ACCESS_RAW.map(r=>{ const n=accNorm(r.name);
    return { r, n, spec:n.split(' ').some(t=>t && !ACC_GENERIC.has(t)) }; });   // spec=has a non-generic token
  const seen=new Set();
  for(const c of stationList){
    const f=fold(c.name); if(seen.has(f)) continue; seen.add(f);
    if(byFold.has(f)){ accByStation.set(f, byFold.get(f)); continue; }          // exact
    const nn=accNorm(c.name); if(byNorm.has(nn)){ accByStation.set(f, byNorm.get(nn)); continue; }  // punctuation-normalized
    const cands=new Set();                                                       // one unambiguous contiguous-substring match
    for(const {r,n,spec} of recs){ if(n.length<4 || !spec) continue;
      if(accContig(n,nn) || accContig(nn,n)) cands.add(r); }
    if(cands.size===1) accByStation.set(f, [...cands][0]);
  }
}
function accFor(name){
  if(!name) return undefined;
  if(!accByStation) buildAccessIndex();      // first station panel pays for it, not every visit
  return accByStation.get(fold(name));
}

