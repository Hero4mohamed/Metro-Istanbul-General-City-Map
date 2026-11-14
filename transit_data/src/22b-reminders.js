/* ===========================================================================
   REMINDERS (V4.6.2) — asked for as "scheduling"
   Pick a bus, metro, tram or boat line, its direction, a stop, and the time the vehicle is at that stop (your own time), and the
   app gives a heads-up 5, 10 or 20 minutes before it. Once, every day, on weekdays or at weekends.
   What it is and is not, said where it is set:
     * The time is the person's. TurkMaps has no stop-by-stop timetable for buses (İETT publishes the first and last departure and
       the gap between them, from the first stop); the dialog shows what is known, as a hint, and nothing is filled in for them.
     * There is no server, so a web app can only remind while it is running: open, or recently used and not yet stopped by the
       phone. For an alert that always comes, "Add to my calendar" writes the same reminder (with the same alerts before it) into a
       calendar file the phone's own calendar app keeps and rings.
   Everything stays on the device (localStorage `irn_reminders`).
   ========================================================================== */
/* ==REMIND-PURE-START== */
const REM_KEY = 'irn_reminders';
const REM_BEFORE = [5, 10, 20];
const REM_DAYS = ['once', 'daily', 'weekdays', 'weekends'];
/* "05:20" → 320 (minutes after midnight), or null */
function remParseTime(s){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if(!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
function remDayOk(days, date){
  const d = date.getDay();
  return days === 'daily' || days === 'once' || (days === 'weekdays' && d >= 1 && d <= 5) || (days === 'weekends' && (d === 0 || d === 6));
}
const remYmd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
/* the next time the vehicle is due at the stop (ms, this device's clock), from a minute ago on; null when a one-off has passed */
function remNextDue(r, now){
  const mins = remParseTime(r.time); if(mins === null) return null;
  if(r.days === 'once'){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r.date || '')); if(!m) return null;
    const due = new Date(+m[1], +m[2] - 1, +m[3], Math.floor(mins / 60), mins % 60, 0, 0).getTime();
    return due >= now - 60000 ? due : null;
  }
  const base = new Date(now);
  for(let i = 0; i < 8; i++){
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, Math.floor(mins / 60), mins % 60, 0, 0);
    if(!remDayOk(r.days, d)) continue;
    if(d.getTime() >= now - 60000) return d.getTime();
  }
  return null;
}
/* for a one-off: the date the time next comes, today or tomorrow */
function remOnceDate(time, now){
  const mins = remParseTime(time); if(mins === null) return null;
  const b = new Date(now), d = new Date(b.getFullYear(), b.getMonth(), b.getDate(), Math.floor(mins / 60), mins % 60, 0, 0);
  if(d.getTime() < now - 60000) d.setDate(d.getDate() + 1);
  return remYmd(d);
}
/* The heads-ups due now. For each reminder, the moments (due − 5, 10, 20 min) that have come and were not given yet for this due
   time; when several have come at once (the app was asleep), ONE heads-up is given, the latest (the fewest minutes left), and the
   others count as given. `covers` = every moment it stands for, to remember as given. */
function remDueAlerts(list, now){
  const out = [];
  for(const r of list){
    if(!r || !r.on) continue;
    const due = remNextDue(r, now); if(due === null || now >= due) continue;
    const key = String(due), given = (r.fired && r.fired.due === key && Array.isArray(r.fired.b)) ? r.fired.b : [];
    const come = (r.before || []).filter(b => now >= due - b * 60000);
    const fresh = come.filter(b => given.indexOf(b) < 0);
    if(!fresh.length) continue;
    out.push({ r: r, due: due, before: Math.min.apply(null, come), covers: given.concat(fresh) });
  }
  return out;
}
/* the same reminder as a calendar file (iCalendar): local time, repeated as chosen, an alarm for each "before" */
function remICS(r, now){
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const mins = remParseTime(r.time); if(mins === null) return null;
  const date = r.days === 'once' ? r.date : (function(){ const due = remNextDue(Object.assign({}, r, { on: true }), now); return due ? remYmd(new Date(due)) : remYmd(new Date(now)); })();
  const p2 = n => String(n).padStart(2, '0');
  const start = String(date).replace(/-/g, '') + 'T' + p2(Math.floor(mins / 60)) + p2(mins % 60) + '00';
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rule = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekends: 'FREQ=WEEKLY;BYDAY=SA,SU' }[r.days];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TurkMaps//Reminder//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:' + esc(r.id) + '@turkmaps', 'DTSTAMP:' + stamp, 'DTSTART:' + start, 'DURATION:PT5M',
    'SUMMARY:' + esc(r.title), 'DESCRIPTION:' + esc(r.desc || '')];
  if(rule) lines.push('RRULE:' + rule);
  (r.before || []).slice().sort((a, b) => b - a).forEach(b => lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(r.title), 'TRIGGER:-PT' + b + 'M', 'END:VALARM'));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
/* ==REMIND-PURE-END== */

/* `var`: the line panels can ask before this file has run (see the note in 16b-bus-routes.js) */
var reminders = (function(){ const a = lsJSON(REM_KEY); return Array.isArray(a) ? a.filter(x => x && x.id && remParseTime(x.time) !== null) : []; })();
var remCtx = null;            // the dialog's line: { mode, ref, label, col, dirs:[{ head, stops:[names] }], dir, stop, time, days, before }
function remSave(){ try{ localStorage.setItem(REM_KEY, JSON.stringify(reminders)); }catch(e){} renderRemList(); }
const remModeIcon = m => m === 'bus' ? '🚌' : (m === 'ferry' ? '⛴' : '🚇');
function remClock(time){
  const mins = remParseTime(time); if(mins === null) return time || '';
  if(typeof clock24 === 'undefined' || clock24) return time;
  const h = Math.floor(mins / 60), m = mins % 60;
  return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}
/* the line's directions and stops, as the dialog lists them */
function remLineInfo(mode, ref){
  if(mode === 'bus'){
    const dirs = (typeof busDirs === 'function' ? busDirs(ref) : []).map((d, i) => ({ head: d.head || (i ? t('busReturn') : t('busOutbound')), stops: busStopNames(d) }));
    return { label: ref, col: BUS_COLOR, dirs: dirs };
  }
  const l = lineByRef[ref]; if(!l) return null;
  const names = (l.stations || []).map(s => s.name).filter(Boolean);
  if(names.length < 2) return null;
  const rev = names.slice().reverse();
  const dirs = names[0] === names[names.length - 1] ? [{ head: names[names.length - 1], stops: names }] : [{ head: names[names.length - 1], stops: names }, { head: names[0], stops: rev }];
  return { label: l.partOf || l.ref, col: l.color || colorForLine(ref), dirs: dirs };
}
/* what is known about the times, said as a hint and not filled in */
function remHint(c){
  if(c.mode === 'bus'){
    const s = (typeof BUS_SCHED !== 'undefined' && BUS_SCHED[c.ref]) || null, d = s && s[c.dir];
    if(d && d.wd && d.wd.first) return t('remHintBus').replace('{when}', fmtSchedBucket(d.wd));
    return t('remHintNone');
  }
  const lt = typeof lineTiming === 'function' ? lineTiming(c.ref) : null;
  if(lt && lt.hours) return t('remHintRail').replace('{hours}', lt.hours).replace('{n}', Math.round(lt.hwMin || 0) || '?');
  return t('remHintNone');
}
function openReminder(mode, ref){
  const info = remLineInfo(mode, ref);
  if(!info || !info.dirs.length){ showToast(t('remNoStops'), 'err'); return; }
  remCtx = { mode: mode, ref: ref, label: info.label, col: info.col, dirs: info.dirs, dir: 0, stop: info.dirs[0].stops[0], time: '', days: 'weekdays', before: [10] };
  renderReminder();
  document.getElementById('remPanel').classList.add('open'); document.getElementById('remOverlay').classList.add('on');
}
function closeReminder(){ document.getElementById('remPanel').classList.remove('open'); document.getElementById('remOverlay').classList.remove('on'); }
function remRowHTML(r, withLine){
  const daysLbl = { once: t('remOnce'), daily: t('remDaily'), weekdays: t('remWeekdays'), weekends: t('remWeekends') }[r.days] || '';
  return '<div class="rem-row' + (r.on ? '' : ' off') + '" data-rid="' + attrEsc(r.id) + '">'
    + (withLine ? '<span class="rem-line" style="background:' + r.col + ';color:' + inkOn(r.col) + '">' + svgEsc(r.label) + '</span>' : '')
    + '<span class="rem-t"><b>' + svgEsc(remClock(r.time)) + ' · ' + svgEsc(r.stop) + '</b><small>→ ' + svgEsc(r.head) + ' · ' + svgEsc(daysLbl)
    + ' · ' + r.before.slice().sort((a, b) => a - b).map(b => t('remMin').replace('{n}', b)).join(', ') + (r.on ? '' : ' · ' + svgEsc(t('remOff'))) + '</small></span>'
    + '<button type="button" class="rem-del" data-rdel="' + attrEsc(r.id) + '" aria-label="' + attrEsc(t('remDelete')) + '" title="' + attrEsc(t('remDelete')) + '">✕</button></div>';
}
function renderReminder(){
  const c = remCtx, box = document.getElementById('remBody'); if(!c || !box) return;
  const d = c.dirs[c.dir] || c.dirs[0];
  const seg = (name, items, on) => '<div class="seg rem-seg" data-rseg="' + name + '">' + items.map(([v, lbl]) => '<button type="button" data-v="' + attrEsc(v) + '"' + (on(v) ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>' + svgEsc(lbl) + '</button>').join('') + '</div>';
  const mine = reminders.filter(r => r.mode === c.mode && r.ref === c.ref && r.city === CITY_ID);
  box.innerHTML =
    '<div class="rem-head"><span class="rem-line" style="background:' + c.col + ';color:' + inkOn(c.col) + '">' + remModeIcon(c.mode) + ' ' + svgEsc(c.label) + '</span></div>'
    + (c.dirs.length > 1 ? '<div class="rem-f"><div class="rem-l">' + svgEsc(t('remDir')) + '</div>' + seg('dir', c.dirs.map((x, i) => [String(i), '→ ' + x.head]), v => +v === c.dir) + '</div>' : '')
    + '<div class="rem-f"><label class="rem-l" for="remStop">' + svgEsc(t('remStop')) + '</label><select id="remStop">'
    + d.stops.map(n => '<option' + (n === c.stop ? ' selected' : '') + '>' + svgEsc(n) + '</option>').join('') + '</select></div>'
    + '<div class="rem-f"><label class="rem-l" for="remTime">' + svgEsc(t('remTime')) + '</label><input id="remTime" type="time" step="60" value="' + attrEsc(c.time) + '">'
    + '<div class="sp-hint">' + svgEsc(remHint(c)) + '</div></div>'
    + '<div class="rem-f"><div class="rem-l">' + svgEsc(t('remDays')) + '</div>' + seg('days', [['once', t('remOnce')], ['daily', t('remDaily')], ['weekdays', t('remWeekdays')], ['weekends', t('remWeekends')]], v => v === c.days) + '</div>'
    + '<div class="rem-f"><div class="rem-l">' + svgEsc(t('remBefore')) + '</div>' + seg('before', REM_BEFORE.map(b => [String(b), t('remMin').replace('{n}', b)]), v => c.before.indexOf(+v) >= 0) + '</div>'
    + '<div class="rem-acts"><button type="button" class="btn" id="remSaveBtn">' + svgEsc(t('remSave')) + '</button>'
    + '<button type="button" class="btn ghost" id="remIcsBtn">📅 ' + svgEsc(t('remIcs')) + '</button></div>'
    + '<div class="sp-hint rem-note">' + svgEsc(t('remNote')) + '</div>'
    + (mine.length ? '<div class="rem-l rem-mine">' + svgEsc(t('remOnLine')) + '</div><div class="rem-list">' + mine.map(r => remRowHTML(r, false)).join('') + '</div>' : '');
}
/* the reminder the dialog describes, or a reason it cannot be made yet */
function remFromDialog(){
  const c = remCtx; if(!c) return null;
  if(remParseTime(c.time) === null) return { error: t('remNeedTime') };
  if(!c.before.length) return { error: t('remNeedBefore') };
  const d = c.dirs[c.dir] || c.dirs[0], now = Date.now();
  const r = { id: 'r' + now.toString(36) + Math.random().toString(36).slice(2, 6), city: CITY_ID, mode: c.mode, ref: c.ref, label: c.label, col: c.col,
    head: d.head, stop: c.stop, time: c.time, days: c.days, before: c.before.slice().sort((a, b) => a - b), on: true, created: now };
  if(r.days === 'once') r.date = remOnceDate(r.time, now);
  r.title = remModeIcon(r.mode) + ' ' + r.label + ' → ' + r.head;
  r.desc = t('remNotifyBody').replace('{stop}', r.stop).replace('{time}', r.time).replace('{n}', r.before.join('/'));
  return r;
}
function remTick(){
  const now = Date.now(); let changed = false;
  remDueAlerts(reminders, now).forEach(a => {
    a.r.fired = { due: String(a.due), b: a.covers }; changed = true;
    const left = Math.max(1, Math.round((a.due - now) / 60000));
    notify(t('remNotifyTitle').replace('{line}', a.r.label).replace('{head}', a.r.head),
      t('remNotifyBody').replace('{stop}', a.r.stop).replace('{time}', remClock(a.r.time)).replace('{n}', left));
  });
  // a one-off whose time has gone is switched off, and kept in the list until it is removed
  reminders.forEach(r => { if(r.on && r.days === 'once' && remNextDue(r, now) === null){ r.on = false; changed = true; } });
  if(changed) remSave();
}
function renderRemList(){
  const box = document.getElementById('remList'); if(!box) return;
  box.innerHTML = reminders.length ? reminders.map(r => remRowHTML(r, true)).join('') : '<div class="sp-note">' + svgEsc(t('remNone')) + '</div>';
}
(function(){
  const panel = document.getElementById('remPanel'); if(!panel) return;
  document.getElementById('remX').addEventListener('click', closeReminder);
  document.getElementById('remOverlay').addEventListener('click', closeReminder);
  panel.addEventListener('click', e => {
    const c = remCtx; if(!c) return;
    const b = e.target.closest('[data-rseg] button');
    if(b){
      const name = b.parentElement.dataset.rseg, v = b.dataset.v;
      if(name === 'dir'){ c.dir = +v; c.stop = (c.dirs[c.dir] || c.dirs[0]).stops[0]; }
      else if(name === 'days') c.days = v;
      else if(name === 'before'){ const n = +v, i = c.before.indexOf(n); if(i >= 0) c.before.splice(i, 1); else c.before.push(n); }
      renderReminder(); return;
    }
    if(e.target.closest('#remSaveBtn')){
      const r = remFromDialog(); if(!r) return;
      if(r.error){ showToast(r.error, 'err'); return; }
      reminders.push(r); remSave(); askNotify(); renderReminder();
      showToast(t('remSaved').replace('{time}', remClock(r.time)));
      return;
    }
    if(e.target.closest('#remIcsBtn')){
      const r = remFromDialog(); if(!r) return;
      if(r.error){ showToast(r.error, 'err'); return; }
      const ics = remICS(r, Date.now()); if(!ics) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      a.download = 'turkmaps-' + String(r.label).replace(/[^\w-]+/g, '') + '-' + r.time.replace(':', '') + '.ics';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return;
    }
  });
  panel.addEventListener('input', e => {
    const c = remCtx; if(!c) return;
    if(e.target.id === 'remTime') c.time = e.target.value;
    if(e.target.id === 'remStop') c.stop = e.target.value;
  });
  panel.addEventListener('change', e => { const c = remCtx; if(c && e.target.id === 'remStop') c.stop = e.target.value; });
  // deleting, from the dialog or from Settings > You
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-rdel]'); if(!del) return;
    reminders = reminders.filter(r => r.id !== del.dataset.rdel); remSave();
    if(panel.classList.contains('open')) renderReminder();
  });
  // the line panel's button
  const lb = document.getElementById('lpRemind');
  if(lb) lb.addEventListener('click', () => { if(lb.dataset.ref) openReminder(lb.dataset.mode || 'rail', lb.dataset.ref); });
  renderRemList();
  setInterval(remTick, 20000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) remTick(); });
  setTimeout(remTick, 3000);
})();
