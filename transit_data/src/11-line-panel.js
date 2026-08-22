/* ===========================================================================
   6b. LINE INFRASTRUCTURE PANEL  (İBB / Metro İstanbul aligned metadata)
   =========================================================================== */
const LINE_META = {
  'M1A':{official:'Yenikapı – Atatürk Havalimanı', opened:'1989', exp:[]},
  'M1B':{official:'Yenikapı – Kirazlı', opened:'2013', exp:[]},
  'M2':{official:'Yenikapı – Hacıosman', opened:'2000', exp:[
    {name:'M2 Seyrantepe Shuttle (Sanayi Mah. ↔ Seyrantepe)', status:'Operational', opening:'2010'}]},
  'M2S':{official:'Sanayi Mahallesi – Seyrantepe Shuttle Spur', opened:'2010', exp:[
    {name:'Branch of M2 serving Seyrantepe / İSKİ (F3 funicular link)', status:'Operational', opening:'2010'}]},
  'M3':{official:'Kirazlı – Kayaşehir Merkez / Bakırköy', opened:'2013', exp:[
    {name:'Bakırköy İDO – Kirazlı southern link', status:'Operational', opening:'2023'}]},
  'M4':{official:'Kadıköy – Sabiha Gökçen Havalimanı', opened:'2012', exp:[
    {name:'Sabiha Gökçen – Tuzla extension', status:'Under construction', opening:'Projected 2026'}]},
  'M5':{official:'Üsküdar – Çekmeköy / Samandıra', opened:'2017', exp:[
    {name:'Çekmeköy – Sancaktepe (Samandıra Merkez)', status:'Under construction', opening:'Projected 2026'}]},
  'M6':{official:'Levent – Boğaziçi Ü. / Hisarüstü', opened:'2015', exp:[]},
  'M7':{official:'Mahmutbey – Mecidiyeköy – Kabataş', opened:'2020', exp:[
    {name:'Mecidiyeköy – Kabataş extension', status:'Operational', opening:'2024'},
    {name:'Mahmutbey – Esenyurt extension', status:'Under construction', opening:'Projected 2027'}]},
  'M8':{official:'Bostancı – Parseller', opened:'2023', exp:[
    {name:'Parseller – Dudullu / Ümraniye links', status:'Planned', opening:'TBD'}]},
  'M9':{official:'Ataköy – İkitelli (Olimpiyat)', opened:'2021', exp:[
    {name:'Ataköy – Yeşilköy southern extension', status:'Under construction', opening:'Projected 2026'}]},
  'M11':{official:'Gayrettepe – İstanbul Havalimanı', opened:'2023', exp:[
    {name:'M11 Western Extension: İstanbul Havalimanı → Halkalı (Marmaray interchange)', status:'Under construction / testing', opening:'Projected 2026'},
    {name:'M12 İstanbul Finance Center Axis (Göztepe – Ümraniye – İFM)', status:'Under construction', opening:'Projected 2026–2027'}]},
  'Marmaray':{official:'Halkalı – Gebze (intercontinental)', opened:'2013 tube · 2019 full', exp:[
    {name:'Capacity & frequency program (additional sets)', status:'Ongoing', opening:'—'}]},
  'T1':{official:'Bağcılar – Kabataş', opened:'1992', exp:[]},
  'T3':{official:'Kadıköy – Moda (heritage loop)', opened:'2003', exp:[]},
  'T4':{official:'Topkapı – Mescid-i Selam', opened:'2007', exp:[]},
  'T5':{official:'Eminönü – Alibeyköy Cep Otogarı', opened:'2021', exp:[
    {name:'Eminönü – Beyazıt link study', status:'Planned', opening:'TBD'}]},
  'T7':{official:'Eminönü – Eyüpsultan corridor', opened:'—', exp:[
    {name:'Alibeyköy – Eyüpsultan – Eminönü tram', status:'Under construction', opening:'Projected 2026'}]},
  'F1':{official:'Taksim – Kabataş Funicular (TF1)', opened:'2006', exp:[]},
  'F2':{official:'Karaköy – Beyoğlu (Tünel, since 1875)', opened:'1875', exp:[]},
  'F3':{official:'Seyrantepe – Vadistanbul Funicular', opened:'2022', exp:[]},
  'F4':{official:'Hisarüstü – Aşiyan Funicular', opened:'2022', exp:[]},
  'Metrobüs':{official:'Beylikdüzü Sondurak – Söğütlüçeşme (BRT)', opened:'2007', exp:[
    {name:'Fleet renewal & Cevizlibağ junction upgrade', status:'Ongoing', opening:'—'}]}
};
function clusterFor(ref, idx){ return stationList.find(c => c.nodes.some(n=>n.ref===ref && n.idx===idx)); }
function fmtLaunch(d){
  if(!d) return '';
  const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p=d.split('-'); return `${+p[2]} ${M[+p[1]-1]} ${p[0]}`;
}
function lineTooltip(line){
  const km=distStr(line._len/1000);
  const dref = line.partOf || line.ref;
  if(isLive(line)) return `<b>${dref}</b> · ${km} · ${line.stations.length||'–'} stops`;
  const when = line.launch ? ('opens '+fmtLaunch(line.launch)) : (line.status||'planned');
  return `<b>${dref}</b> ◇ ${when} · ${km} km`;
}
