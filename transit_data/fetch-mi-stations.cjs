// Bake the official Metro İstanbul station registry (id + line + coords) so the app can
// resolve a clicked station to its official ID and fetch EXACT scheduled departures live
// from api.ibb.gov.tr (CORS-open). Output is compact: [[Id,LineName,lat,lng,Name],...]
const fs = require('fs'); const path = require('path');
(async()=>{
  const r = await fetch('https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetStations');
  const j = await r.json();
  if(!j.Success || !Array.isArray(j.Data)) throw new Error('GetStations failed');
  const out = j.Data.map(s => [ s.Id, s.LineId, s.LineName,
    +(+s.DetailInfo.Latitude).toFixed(5), +(+s.DetailInfo.Longitude).toFixed(5),
    s.Description || s.Name ]).filter(x => x[3] && x[4]);
  fs.writeFileSync(path.join(__dirname,'mi-stations.json'), JSON.stringify(out));
  const lines = [...new Set(out.map(x=>x[2]))].sort();
  console.log('MI STATIONS:', out.length, ' LINES:', lines.join(' '),
    ' FILE:', (fs.statSync(path.join(__dirname,'mi-stations.json')).size/1024).toFixed(1)+'KB');
})().catch(e=>{ console.error('FAILED:', e.message); process.exit(1); });
