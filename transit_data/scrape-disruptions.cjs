// Fetch LIVE Istanbul rail disruptions from the official Metro İstanbul status page
// (server-rendered HTML, no key/CORS) and write disruptions.json in the app's schema.
// Optional second source: official X/Twitter accounts, only if X_BEARER_TOKEN is set.
// Accuracy first: we only emit a disruption when the line + affected stations are clearly
// stated in the structured table — never invented.
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'disruptions.json');
const SRC = 'https://www.metro.istanbul/SeferDurumlari/Ariza';
const UA  = 'Mozilla/5.0 (compatible; IstanbulTransitMap/1.0; +github.com/Hero4mohamed)';

// decode numeric + named HTML entities and tidy whitespace
function decode(s){
  return s.replace(/&#(\d+);/g, (_,n)=>String.fromCharCode(+n))
          .replace(/&#x([0-9a-f]+);/gi, (_,n)=>String.fromCharCode(parseInt(n,16)))
          .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
          .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
          .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
const stripTags = s => s.replace(/<[^>]+>/g,' ');

// map the page's status text + wording to our severity + short title
function classify(status, desc){
  const s=(status||'').toLocaleLowerCase('tr'), d=(desc||'').toLocaleLowerCase('tr');
  if(/(durduruldu|yapılmıyor|hizmet ver|kapalı|iptal)/.test(s+' '+d))
    return { severity:'major',   title:'Service suspended' };
  if(/(aktarma|arasında|durmadan|durmamakta|geçiş|onarım|çalışma)/.test(s+' '+d))
    return { severity:'partial', title:'Section affected' };
  return { severity:'minor', title:'Service notice' };
}
// first token of the line name is the ref (M7, M2, T1, B2, Marmaray, …)
function refOf(lineName){
  const m=lineName.match(/^([A-Za-zÇĞİÖŞÜ]{1,3}\d{0,2}|Marmaray|Metrob[üu]s)/i);
  return m ? m[0].toUpperCase().replace('METROBÜS','Metrobüs').replace('MARMARAY','Marmaray') : lineName.split(/\s/)[0];
}
function slug(s){ return s.toLocaleLowerCase('tr').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,40); }
// pull an end date out of the description → ISO YYYY-MM-DD (so the panel's countdown works)
const TR_MONTHS={ocak:1,'şubat':2,mart:3,nisan:4,'mayıs':5,haziran:6,temmuz:7,'ağustos':8,'eylül':9,ekim:10,'kasım':11,'aralık':12};
function parseUntil(desc){
  let m=desc.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if(m) return `${m[3]}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
  m=desc.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
  if(m){ const mo=TR_MONTHS[m[2].toLocaleLowerCase('tr')]; if(mo) return `${m[3]}-${String(mo).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`; }
  return null;
}

// ---- primary: Metro İstanbul Arıza page (line-level disruption table) ----
function parseMetro(html){
  const out=[];
  // rows in the line-disruption table have the tell-tale width:40% first cell:
  //   <td style="width:40%">LINE <br/> <small><em>stations</em></small></td><td>desc</td><td>status</td>
  const re=/<td style="width:40%">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g;
  let m;
  while((m=re.exec(html))){
    const cell1=m[1];
    const lineName=decode(cell1.split(/<br\s*\/?>/i)[0]);
    const emMatch=cell1.match(/<em>([\s\S]*?)<\/em>/i);
    const stations=emMatch ? decode(emMatch[1]).split(/[,;]/).map(x=>x.trim()).filter(Boolean) : [];
    const desc=decode(m[2]);
    const status=decode(m[3]);
    if(!lineName || !desc) continue;
    const ref=refOf(lineName);
    const { severity, title }=classify(status, desc);
    const e={ id:slug(ref+'-'+(stations[0]||status||'durum')), ref, source:'metro.istanbul' };
    if(stations.length>=2){ e.scope='segment'; e.from=stations[0]; e.to=stations[stations.length-1]; }
    else if(stations.length===1){ e.scope='segment'; e.from=stations[0]; e.to=stations[0]; }
    else { e.scope='line'; }
    e.severity=severity; e.title=title; e.message=desc;
    const until=parseUntil(desc); if(until) e.until=until;
    out.push(e);
  }
  // de-dup by id (the page repeats each disruption per-station lower down)
  const seen=new Set(); return out.filter(e=> seen.has(e.id)?false:(seen.add(e.id),true));
}

// ---- optional secondary: official X/Twitter accounts (only with a paid bearer token) ----
const X_ACCOUNTS = ['Metroistanbul','iett','Marmaray']; // official handles
async function parseX(){
  const token=process.env.X_BEARER_TOKEN; if(!token) return [];
  const out=[];
  for(const user of X_ACCOUNTS){
    try{
      const u=`https://api.twitter.com/2/tweets/search/recent?query=from:${user}%20(ar%C4%B1za%20OR%20kapal%C4%B1%20OR%20seferler%20OR%20kesinti)&max_results=10&tweet.fields=created_at`;
      const r=await fetch(u,{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){ console.error('X '+user+' HTTP '+r.status); continue; }
      const j=await r.json();
      for(const t of (j.data||[])){
        // conservative: keep as an advisory note tagged to the account; do NOT invent stations
        out.push({ id:slug('x-'+user+'-'+t.id).slice(0,40), ref:null, scope:'note',
                   severity:'minor', title:'@'+user, message:decode(t.text), source:'x:@'+user, untilText:null });
      }
    }catch(e){ console.error('X '+user+' error', e.message); }
  }
  return out;
}

async function main(){
  let metro=[], fetchOk=false;
  try{
    const r=await fetch(SRC,{headers:{'User-Agent':UA}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    metro=parseMetro(await r.text()); fetchOk=true;
  }catch(e){ console.error('metro.istanbul fetch failed:', e.message); process.exitCode=2; }
  // a transient fetch failure must NOT erase the current file — bail out, leave it untouched
  if(!fetchOk){ console.error('Source unreachable — leaving disruptions.json unchanged.'); return; }
  const x=await parseX();
  // merge curated manual entries (lines the metro.istanbul page does NOT cover — Marmaray/B2/
  // ferries/buses). Live parse wins for any ref it actually reports.
  let manual=[]; try{ manual=JSON.parse(fs.readFileSync(path.join(__dirname,'disruptions-manual.json'),'utf8')); }catch(e){}
  const liveRefs=new Set(metro.map(e=>e.ref));
  const keptManual=manual.filter(m=> !liveRefs.has(m.ref));
  const all=keptManual.concat(metro, x);
  // keep a stable, readable order
  all.sort((a,b)=> (a.ref||'zzz').localeCompare(b.ref||'zzz','tr') || a.id.localeCompare(b.id));
  if(!metro.length && !process.env.ALLOW_EMPTY){
    console.error('No metro.istanbul disruptions parsed — keeping manual-only set (safety).');
  }
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2)+'\n');
  console.log('WROTE', OUT, '—', all.length, 'item(s):', all.map(e=>e.ref+'/'+e.id).join(', '));
}
main();
