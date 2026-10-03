/* ===========================================================================
   VISION — the panel for a line that is not running yet.

   A planned line used to get a status word and a date, and nothing else. What a person looking
   at the Vision tab wants to know is different: how far along is it, when is it meant to open and
   who says so, how long is it, which stations, who is building it — and how much of what they are
   looking at is surveyed versus guessed.

   Everything shown here comes from the line's own record (planned-lines.json), where each claim
   carries its source and date. Two rules shape the rendering:
     - a field with no value is OMITTED, never shown as "unknown" or a dash, so a project with
       thin data reads as short, not as broken;
     - a target date always shows who said it and when (`as of`), because a date without that is
       exactly how a stale schedule gets repeated as fact.
   =========================================================================== */
// PHASE_STATUS / PHASE_ORDER live in 08-map.js: tooltips need them while the map is being built
function phaseOf(line){ return line.phase || (/construction/i.test(line.status||'') ? 'construction' : 'planned'); }
function phaseLabel(ph){ return transStatus(PHASE_STATUS[ph] || 'Planned'); }

function plannedName(line){ return (lang === 'tr' && line.officialTr) ? line.officialTr : (line.official || line.ref); }
function planTargetText(tg){
  if(!tg) return '';
  return tg.date ? fmtLaunch(tg.date) : (tg.text || '');
}
function planYear(tg){
  const d = tg && (tg.date || tg.end);
  return d ? d.slice(0, 4) : '';
}
function planAsOf(d){ return d ? fmtLaunch(d.length === 7 ? d + '-01' : d) : ''; }

function planFact(label, value){
  if(value === undefined || value === null || value === '' || value === false) return '';
  return `<div class="pf"><span>${svgEsc(label)}</span><b>${svgEsc(value)}</b></div>`;
}
function planMoney(v){ return v ? String(v).replace(/\s*\+\s*KDV/i, ' + VAT') : ''; }

/* the station list: the OFFICIAL names when the operator published them, each marked if it can
   be found on the mapped alignment; otherwise whatever stations were mapped */
function planStations(line){
  const official = line.stationNames && line.stationNames.length ? line.stationNames : null;
  const mapped = line.stations || [];
  /* Names are matched with the spaces taken out as well: the operator writes "Yeni Sahra" and
     "60.Yıl Parkı" where OpenStreetMap has "Yenisahra" and "60. Yıl Parkı", and an exact match
     would grey out a station that IS on the map. */
  const key = n => fold(n).replace(/ /g, '');
  const byName = {};
  mapped.forEach(s => { byName[key(s.name)] = s; });
  const rows = official
    ? official.map(n => ({ name:n, at:byName[key(n)] || null }))
    : mapped.map(s => ({ name:s.name, at:s }));
  if(!rows.length) return `<div class="pl-none">${svgEsc(t('vNoStations'))}</div>`;
  const on = rows.filter(r => r.at).length;
  const head = official ? `${t('vOfficialStns')} · ${rows.length}` : `${t('vStations')} · ${rows.length}`;
  const sub = official ? `<span>${on}/${rows.length} ${svgEsc(t('vMapped'))}</span>` : '';
  return `<div class="pl-h">${svgEsc(head)}${sub}</div><ol class="pl-stns">` + rows.map(r =>
    r.at ? `<li class="go" data-lat="${r.at.lat}" data-lng="${r.at.lng}" tabindex="0" role="button">${svgEsc(r.name)}</li>`
         : `<li>${svgEsc(r.name)}</li>`).join('') + '</ol>';
}

function planGeometry(line){
  const g = line.geometry || {};
  if(g.kind !== 'osm') return '';
  const bits = [t(g.schematic ? 'vAlignSchematic' : 'vAlignOsm')];
  if(g.smoothed) bits.push(t('vAlignSmooth'));
  const pub = line.km || (line.official_facts && line.official_facts.lengthKm);
  let cmp = '';
  if(pub && g.mappedKm) cmp = '<div class="pl-cmp">' + svgEsc(t('vMappedPub').replace('{m}', distNum(g.mappedKm).toFixed(1)).replace('{p}', distNum(pub).toFixed(1))) + '</div>';
  return `<div class="pl-h">${svgEsc(t('vAlignment'))}</div><div class="pl-geo">${svgEsc(bits.join(' · '))}${cmp}</div>`;
}

function planSources(line){
  const src = (line.sources || []).filter(s => s && /^https:\/\//.test(s.url || ''));
  const links = src.map(s => `<a href="${attrEsc(s.url)}" target="_blank" rel="noopener noreferrer">${svgEsc(s.label)}</a>` +
    (s.date ? ` <i>${svgEsc(planAsOf(s.date))}</i>` : '')).join('');
  const ver = line.verified ? `<div class="pl-ver">${svgEsc(t('vVerified'))}: ${svgEsc(planAsOf(line.verified))}</div>`
                            : `<div class="pl-unv">${svgEsc(t('vUnverified'))}</div>`;
  return `<div class="pl-h">${svgEsc(t('vSources'))}</div><div class="pl-srcs">${links}</div>${ver}`;
}

function plannedPanelHTML(line){
  const ph = phaseOf(line), tg = line.target, pr = line.progress, of = line.official_facts || {};
  const tgText = planTargetText(tg);
  let h = `<div class="pl-top"><span class="pl-chip ph-${ph}" title="${attrEsc(t('vPhaseTip'))}">${svgEsc(phaseLabel(ph))}</span>`
        + `<span class="pl-tgt"><small>${svgEsc(t('vTarget'))}</small> ${svgEsc(tgText || t('vNoTarget'))}`
        + (tg && tg.asOf ? ` <i>${svgEsc(t('vAsOf'))} ${svgEsc(planAsOf(tg.asOf))}</i>` : '') + `</span></div>`;
  if(pr && typeof pr.pct === 'number'){
    h += `<div class="pl-prog" role="img" aria-label="${attrEsc(t('vProgress') + ' ' + pr.pct + '%')}"><div class="pl-bar"><i style="width:${Math.max(2, Math.min(100, pr.pct))}%"></i></div>`
       + `<span><b>${pr.pct}%</b> ${svgEsc(t('vProgress'))}${pr.asOf ? ' · ' + svgEsc(t('vAsOf')) + ' ' + svgEsc(planAsOf(pr.asOf)) : ''}</span></div>`;
  }
  if(line.notes && line.notes.length) h += '<ul class="pl-notes">' + line.notes.map(n => `<li>${svgEsc(n)}</li>`).join('') + '</ul>';
  const facts = [
    planFact(t('vOwner'), line.owner), planFact(t('vOperator'), line.operator),
    planFact(t('vContractor'), of.contractor), planFact(t('vStart'), of.startDate ? fmtLaunch(of.startDate) : ''),
    planFact(t('vValue'), planMoney(of.contractValue)),
    planFact(t('vCapacity'), of.capacityPphpd ? of.capacityPphpd.toLocaleString() + ' pphpd' : ''),
    planFact(t('vJourney'), of.travelMin ? of.travelMin + ' min' : ''),
    planFact(t('vTbm'), of.tbm), planFact(t('vVehicles'), of.vehicles),
    planFact(t('vDriverless'), line.driverless ? '✓' : ''),
  ].join('');
  if(facts) h += `<div class="pl-facts">${facts}</div>`;
  h += planStations(line) + planGeometry(line) + planSources(line);
  return h;
}

function wirePlannedPanel(root){
  root.querySelectorAll('.pl-stns li.go').forEach(li => {
    const go = () => map.flyTo([+li.dataset.lat, +li.dataset.lng], Math.max(map.getZoom(), 15), { duration:0.6 });
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } });
  });
}

/* the figures in the three stat cells: the OFFICIAL length and station count when the operator
   published them (a straight count of what happens to be mapped would understate both) */
function plannedStats(line){
  const km = line.km || (line.official_facts && line.official_facts.lengthKm) || (line._lenAll || line._len) / 1000;
  const n = line.stationCount || (line.stationNames && line.stationNames.length) || line.stations.length || 0;
  const yr = planYear(line.target);
  return `<div class="c"><b>${distNum(km).toFixed(1)}</b><span>${distUnit()}</span></div>
     <div class="c"><b>${n || '—'}</b><span>${t('stationsLower')}</span></div>
     <div class="c"><b style="font-size:${yr ? '15px' : '11px'}">${yr || t('soonWord')}</b><span>${t('targetOpen')}</span></div>`;
}

/* the Vision legend: one group per stage, each chip a project. The header says how many and how
   long, so the tab answers "how much is actually being built" without opening anything. */
function visionLegendHTML(set){
  const under = set.filter(l => phaseOf(l) === 'construction');
  const unv = set.filter(l => !l.verified).length;
  let html = `<div class="vis-sum">${svgEsc(t('vProjectsHdr').replace('{n}', set.length).replace('{k}', under.length))}`
           + (unv ? ` · ${svgEsc(t('vUnvHdr').replace('{u}', unv))}` : '') + '</div>';
  PHASE_ORDER.forEach(ph => {
    const lines = set.filter(l => phaseOf(l) === ph);
    if(!lines.length) return;
    const km = lines.reduce((s, l) => s + (l.km || (l._lenAll || l._len) / 1000), 0);
    html += `<div class="grp"><div class="grp-h ph-${ph}" data-phase="${ph}">${svgEsc(phaseLabel(ph))}<span>${lines.length} · ${distStr(km)}</span></div><div class="lines-wrap">`;
    lines.forEach(l => {
      html += `<div class="lchip${lineLayers[l.ref].on?'':' off'}${l.verified?'':' unv'}" data-ref="${attrEsc(l.ref)}" title="${attrEsc(t('openLineMap'))}"><span class="sw" style="background:${l.color}" title="${attrEsc(t('showHide'))}"></span>${svgEsc(l.ref)}</div>`;
    });
    html += '</div></div>';
  });
  return html;
}
