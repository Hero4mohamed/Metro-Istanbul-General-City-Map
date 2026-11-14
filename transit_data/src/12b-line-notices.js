/* ===========================================================================
   NOTICES ON A LINE (V4.6)
   Asked for as: warnings and announcements on bus, metro or boat lines shown more clearly when the line is looked up. A metro
   line's own panel showed none of its notices at all (they were only in the Announcements card and on the map), the bus panel
   listed them as small grey boxes under the direction buttons, and a boat line said nothing either. Now one block, the same
   everywhere: at the top of the line's panel, coloured by the worst notice, saying how many there are, each notice with its
   severity, title, text and how long it lasts. A list row (the Buses list, the Boats list, a search result) carries a coloured
   pill when its line has a notice.
   Nothing here decides what is active: activeDisruptions() does (03-data.js), the same list the map and the Announcements use.
   ========================================================================== */
const NOTICE_RANK = { major:0, partial:1, minor:2 };
/* the notices on one line. `mode`: 'bus', 'ferry', or anything else for a rail line */
function lineNotices(ref, mode){
  if(!ref) return [];
  const all = activeDisruptions();
  if(mode === 'bus') return all.filter(d => d.mode === 'bus' && d.ref === ref);
  if(mode === 'ferry') return all.filter(d => d.mode === 'ferry' && (d.ref === ref || (Array.isArray(d.lines) && d.lines.indexOf(ref) >= 0)));
  return all.filter(d => !d.mode && d.ref === ref);
}
/* ferry notices that name no line (most of them: the operator writes about a pier or a whole service): shown with every boat
   line, under their own heading, so a notice is never hidden only because it did not say which line */
function ferryGeneralNotices(){
  return activeDisruptions().filter(d => d.mode === 'ferry' && !d.ref && !(Array.isArray(d.lines) && d.lines.length));
}
function noticeSort(list){
  const rank = d => (d && NOTICE_RANK[d.severity] !== undefined) ? NOTICE_RANK[d.severity] : 3;
  return list.slice().sort((a, b) => rank(a) - rank(b));
}
function noticeCardHTML(d){
  const col = SEV_COLOR[d.severity] || SEV_COLOR.major;
  const meta = [];
  if(d.until) meta.push('⏱ ' + svgEsc(untilText(d)));
  if(d.recorded) meta.push('🕒 ' + svgEsc(d.recorded));
  return '<div class="ln-card" role="listitem" style="--sc:' + col + '">'
    + '<div class="ln-top"><span class="ln-sev" style="background:' + col + ';color:' + inkOn(col) + '">' + svgEsc(sevLabel(d.severity)) + '</span>'
    + '<b class="ln-ttl">' + svgEsc(disTitle(d)) + '</b></div>'
    + '<div class="ln-msg">' + disTrTag(d) + svgEsc(disMsg(d)) + '</div>'
    + (d.detour ? '<div class="ln-meta">' + svgEsc(t('detourDrawn')) + '</div>' : '')
    + (meta.length ? '<div class="ln-meta">' + meta.join(' · ') + '</div>' : '')
    + '</div>';
}
/* the block at the top of a line's panel; '' when the line has nothing to say. `general`: notices that name no line (boats) */
function lineNoticesHTML(list, general){
  let h = '';
  if(list.length){
    const sorted = noticeSort(list), col = SEV_COLOR[sorted[0].severity] || SEV_COLOR.major;
    h += '<div class="ln-box" role="region" aria-label="' + attrEsc(t('lineNoticesAria')) + '" style="--sc:' + col + '">'
      + '<div class="ln-head"><span class="ln-mark" aria-hidden="true" style="color:' + inkOn(col) + '">⚠</span>'
      + svgEsc(sorted.length === 1 ? t('lineNotice1') : t('lineNoticeN').replace('{n}', sorted.length)) + '</div>'
      + '<div class="ln-list" role="list">' + sorted.map(noticeCardHTML).join('') + '</div></div>';
  }
  if(general && general.length){
    h += '<details class="ln-gen"><summary>⛴ ' + svgEsc(t('ferryAllNotices').replace('{n}', general.length)) + '</summary>'
      + '<div class="ln-list" role="list">' + noticeSort(general).map(noticeCardHTML).join('') + '</div></details>';
  }
  return h;
}
/* a coloured pill for a row in a list: the worst severity's colour, and the number when there is more than one */
function noticePillHTML(list, extraClass){
  if(!list || !list.length) return '';
  const sev = noticeSort(list)[0].severity, col = SEV_COLOR[sev] || SEV_COLOR.major;
  return '<span class="ln-pill' + (extraClass ? ' ' + extraClass : '') + '" style="background:' + col + ';color:' + inkOn(col) + '" title="' + attrEsc(t('lineNoticesAria')) + '">⚠ '
    + (list.length > 1 ? list.length : svgEsc(sevLabel(sev))) + '</span>';
}
