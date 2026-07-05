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

// Domain Turkish→English translator for Istanbul metro service announcements. These messages
// are highly formulaic, so ordered phrase rules (most-specific first) give faithful English.
// Station names (proper nouns) are preserved. The original Turkish is kept as messageTr.
// ==TRANSLATOR-START== (this block is injected verbatim into the app by build.cjs so the
// client can re-translate any disruption that still contains Turkish — single source of truth)
// [İi] etc. because JS regex /i/ does ASCII case-folding only — Turkish İ/I aren't handled.
const TR2EN_PHRASES = [
  // requests by authorities ("X'nin talebi doğrultusunda …")
  [/^\s*(.+?)['’ʼ]?\s*n[iı]n\s+talebi\s+doğrultusunda[ ,]*/i, 'At the request of $1, '],
  [/talebi\s+doğrultusunda/gi, 'per request'],
  [/doğrultusunda/gi, 'in line with'],
  // station/segment ride patterns (most specific first)
  [/seferler(?:imiz)?\s+yapıl(?:a)?mamaktadır/gi, 'services cannot operate'],
  [/([^\s,]+)\s*[-–]\s*([^\s,]+)\s+istasyonları\s+arasında\s+yapılmaktadır/gi, 'operate between $1 and $2'],
  [/([^\s,]+)\s+ve\s+([^\s,]+)\s+[İi]stasyon(?:undan|larından)\s+aktarmalı\s+olarak/gi, 'with a transfer at $1 and $2,'],
  [/([^\s,]+)\s+[İi]stasyon(?:undan|larından)\s+aktarmalı\s+olarak/gi, 'with a transfer at $1,'],
  [/([^\s,]+)\s*[-–]\s*([^\s,]+)\s+istasyonları\s+arasında/gi, 'between $1 and $2'],
  // reasons — lowercase so they read correctly mid-sentence (first letter re-capitalised at end)
  [/planlı\s+bakım\s+(?:ve\s+onarım\s+)?çalış(?:ması|maları)?\s*(?:nedeniyle)?/gi, 'due to planned maintenance,'],
  [/onarım\s+çalış(?:ması|maları)\s+nedeniyle/gi, 'due to maintenance works,'],
  [/bakım\s+(?:ve\s+onarım\s+)?çalış(?:ması|maları)\s+nedeniyle/gi, 'due to maintenance works,'],
  [/teknik\s+(?:bir\s+)?arıza\s+nedeniyle/gi, 'due to a technical fault,'],
  [/sinyalizasyon\s+arızası\s+nedeniyle/gi, 'due to a signalling fault,'],
  [/elektrik\s+kesintisi\s+nedeniyle/gi, 'due to a power outage,'],
  [/olumsuz\s+hava\s+koşulları\s+nedeniyle/gi, 'due to adverse weather conditions,'],
  [/hava\s+koşulları\s+nedeniyle/gi, 'due to weather conditions,'],
  [/yoğunluk\s+nedeniyle/gi, 'due to congestion,'],
  [/çalışmaları?\s+nedeniyle/gi, 'due to works,'],
  [/(?:nedeniyle|sebebiyle|dolayısıyla)/gi, 'due to'],
  // line/station nouns
  [/[Tt]eleferik\s+[Hh]attı(?:mız)?/gi, 'cable car line'], [/[Ff]üniküler\s+[Hh]attı(?:mız)?/gi, 'funicular line'],
  [/[Mm]etro\s+[Hh]attı(?:mız)?/gi, 'metro line'], [/[Tt]ramvay\s+[Hh]attı(?:mız)?/gi, 'tram line'],
  [/[Bb]anliyö\s+[Hh]attı(?:mız)?/gi, 'suburban line'],
  [/[Hh]attımız/gi, 'our line'], [/[Hh]attında/gi, 'on the line'], [/[Hh]attı/gi, 'line'],
  [/[İi]stasyonumuz/gi, 'our station'],
  // status clauses
  [/seferler(?:imiz)?\s+(?:geçici\s+(?:bir\s+)?süreyle\s+)?durdurul(?:muştur|du)/gi, 'services are temporarily suspended'],
  [/seferler(?:imiz)?\s+normale\s+dön(?:müştür|dü)/gi, 'services have returned to normal'],
  [/normale\s+dön(?:müştür|dü)/gi, 'has returned to normal'],
  [/geçici\s+(?:olarak|(?:bir\s+)?süreyle)\s+hizmet\s+dışıdır/gi, 'is temporarily out of service'],
  [/hizmet\s+dışına\s+alınmıştır/gi, 'has been taken out of service'],
  [/hizmet\s+dışıdır/gi, 'is out of service'], [/hizmet\s+dışı/gi, 'out of service'],
  [/hizmete\s+kapatılmıştır/gi, 'has been closed to service'],
  [/hizmete\s+(?:yeniden\s+)?alınmıştır/gi, 'has been brought back into service'],
  [/hizmet\s+ver(?:il)?memektedir/gi, 'is not in service'],
  [/hizmet\s+vermeye\s+(?:yeniden\s+)?başlamıştır/gi, 'has resumed service'],
  [/geçici\s+(?:olarak|(?:bir\s+)?süreyle)\s+kapatılmıştır/gi, 'has been temporarily closed'],
  [/[İi]stasyon(?:u|umuz)?\s+kapalıdır/gi, 'station is closed'],
  [/kapatılmıştır/gi, 'has been closed'], [/kapatılmış(?:tır)?/gi, 'closed'],
  [/geçici\s+(?:bir\s+)?süreyle/gi, 'temporarily'], [/geçici\s+olarak/gi, 'temporarily'],
  [/aktarmalı\s+olarak/gi, 'with a transfer,'],
  [/seferler(?:imiz|ini|ine|i)?/gi, 'trains'],
  [/istasyonları\s+arasında/gi, 'between the stations'],
  [/arasında\s+yapılmaktadır/gi, 'operate between'], [/yapılmaktadır/gi, 'are operating'],
  [/yapıl(?:a)?mamaktadır/gi, 'cannot operate'],
  [/istasyonları/gi, 'stations'], [/[İi]stasyon(?:undan|dan)/gi, 'from the station'],
  [/[İi]stasyon(?:umuz|u)?/gi, 'station'],
  [/aktarmalı/gi, 'with transfer'], [/arasında/gi, 'between'],
  [/devam\s+etmektedir/gi, 'continues'], [/başlamıştır/gi, 'has started'],
  [/kapalıdır/gi, 'is closed'], [/açıktır/gi, 'is open'],
  [/[Oo]narım/gi, 'repair'], [/[Bb]akım/gi, 'maintenance'], [/arıza/gi, 'fault'],
  [/çalışmaları/gi, 'works'], [/çalışması/gi, 'works'], [/çalışma/gi, 'work'],
  [/vatandaşlarımız(?:ın|a|ı)?/gi, 'passengers'], [/yolcularımız(?:ın|a|ı)?/gi, 'passengers'],
  [/(?:sayın\s+)?yolcular(?:ımız)?/gi, 'passengers'],
  [/bilgi(?:lerinize|nize)\s+(?:saygıyla\s+)?sunulur/gi, 'for your information'],
  [/durdurul(?:muştur|du)/gi, 'has been suspended'],
];
// whole-word cleanup for the odd straggler the phrase rules missed (base forms only)
const TR2EN_WORDS = {
  've':'and','ile':'with','için':'for','olarak':'as','ancak':'however','ayrıca':'also','ise':'while',
  'teleferik':'cable car','füniküler':'funicular','metro':'metro','tramvay':'tram','vapur':'ferry','banliyö':'suburban',
  'hat':'line','sefer':'service','seferler':'services','yön':'direction','yönünde':'toward','yönü':'direction',
  'saatleri':'hours','saatlerinde':'hours','gün':'day','saat':'hour','dakika':'minutes','süreyle':'temporarily',
  'geçici':'temporary','planlı':'planned','planlanan':'planned','kapalı':'closed','açık':'open','kapatıldı':'closed',
  'yeniden':'again','normal':'normal','aksama':'disruption','arıza':'fault','bakım':'maintenance','onarım':'repair',
  'çalışıyor':'operating','çalışmıyor':'not operating','durduruldu':'suspended','başladı':'started','bitti':'ended',
  'emniyeti':'Police','emniyetinin':'Police','valiliği':'Governorship','belediyesi':'Municipality',
  'talebi':'request','nedeni':'reason','güvenlik':'security','etkinlik':'event','maç':'match'
};
function translateTR(text){
  let s=' '+text+' ';
  for(const [re,rep] of TR2EN_PHRASES) s=s.replace(re,rep);
  // whole-word stragglers (base forms only; station/line names pass through unchanged)
  s=s.replace(/[A-Za-zÇĞİıÖŞÜçğöşü]+/g, w=>{ const k=w.toLocaleLowerCase('tr'); return TR2EN_WORDS[k]||w; });
  // move the transfer clause to the end so it reads naturally in English
  s=s.replace(/trains\s+with a transfer at (.+?),\s*operate between (.+?)[.\s]*$/i,
              'trains operate between $2, with a transfer at $1.');
  s=s.replace(/\s+,/g,',').replace(/,\s*,/g,',').replace(/\s{2,}/g,' ').replace(/\s+\./g,'.').trim();
  s=s.charAt(0).toUpperCase()+s.slice(1);
  if(s && !/[.!?]$/.test(s)) s+='.';
  return s;
}

// residual-Turkish detector: if the phrase translator left transit jargon untranslated,
// fall back to an LLM (only when ANTHROPIC_API_KEY is set — otherwise skipped).
const TR_RESIDUAL=/\b(nedeniyle|sebebiyle|istasyon\w*|seferler\w*|yapıl\w*|aktarma\w*|kapal\w*|kapat\w*|çalışm\w*|arası\w*|durdurul\w*|hizmet|geçici|yönünde|güzergah\w*|yoğunluk|doğrultusunda|talebi|hattı\w*|teleferik|füniküler|vatandaş\w*|yolcu\w*)\b/i;
const hasResidualTurkish = s => TR_RESIDUAL.test(s||'');
// ==TRANSLATOR-END==
async function llmTranslate(tr){
  const key=process.env.ANTHROPIC_API_KEY; if(!key) return null;
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{ method:'POST',
      headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:300,
        messages:[{ role:'user', content:'Translate this Istanbul public-transit service announcement from Turkish to concise, natural English. Keep all station and line names exactly as written. Reply with ONLY the translation, no preamble.\n\n'+tr }] }) });
    if(!r.ok){ console.error('LLM HTTP '+r.status); return null; }
    const j=await r.json();
    const txt=(j.content && j.content[0] && j.content[0].text || '').trim();
    return txt || null;
  }catch(e){ console.error('LLM translate error:', e.message); return null; }
}
async function llmRefine(items){
  if(!process.env.ANTHROPIC_API_KEY) return;
  for(const e of items){
    if(!e.messageTr || !hasResidualTurkish(e.message)) continue;
    const en=await llmTranslate(e.messageTr);
    if(en){ e.message=en; e.translatedBy='llm'; }
  }
}

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
    e.severity=severity; e.title=title;
    e.message=translateTR(desc);   // English for the panel
    e.messageTr=desc;              // keep the authoritative original
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
  await llmRefine(metro);   // optional high-quality translation for anything the phrase map missed
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
