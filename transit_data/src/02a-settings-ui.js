/* ===========================================================================
   SETTINGS: SECTIONS AND SEARCH (V4.2)
   The page had grown into one long list with no order (the fare card, the data sources and the API key between the theme and the
   language). It is folded into sections now — Appearance, Accessibility, Journey, Map, You, Search & privacy, App & data — and
   each one remembers whether it was left open. The box at the top finds a setting by what it says (its name, its explanation, a
   button's label) wherever it is: sections with a match open, the rest go away, and clearing the box puts the sections back as
   they were.
   ========================================================================== */
/* (var, not let: init() and the settings code can ask for a reset before this file has run) */
var spResetFn = null;
function spReset(){ if(spResetFn) spResetFn(); }
(function(){
  const panel = document.getElementById('settingsPanel'), inp = document.getElementById('spSearch'), none = document.getElementById('spNone');
  if(!panel || !inp) return;
  const secs = [...panel.querySelectorAll('details.sp-sec')];
  let before = null;                      // which sections were open before a search started
  secs.forEach(d => {
    const key = 'irn_sec_' + d.dataset.sec, saved = lsStr(key, null);
    if(saved !== null) d.open = saved === '1';
    d.addEventListener('toggle', () => { if(panel.classList.contains('sp-searching')) return; try{ localStorage.setItem(key, d.open ? '1' : '0'); }catch(e){} });
  });
  function find(){
    const q = foldQ(inp.value.trim()), on = q.length > 0, words = q.split(/\s+/).filter(Boolean);
    panel.classList.toggle('sp-searching', on);
    if(on && !before) before = secs.map(d => d.open);
    let any = false;
    secs.forEach(d => {
      let hits = 0;
      d.querySelectorAll('.sp-item').forEach(it => {
        const ok = !on || (() => { const text = foldQ(it.textContent + ' ' + [...it.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ')); return words.every(w => text.includes(w)); })();
        it.classList.toggle('sp-hide', !ok);
        if(ok) hits++;
      });
      d.classList.toggle('sp-hide', on && !hits);
      if(on && hits){ d.open = true; any = true; }
    });
    if(!on && before){ secs.forEach((d, i) => { d.open = before[i]; }); before = null; }
    none.classList.toggle('show', on && !any);
  }
  inp.addEventListener('input', find);
  // opening Settings starts from the sections as they were left, with nothing typed in the box
  spResetFn = function(){ if(inp.value){ inp.value = ''; find(); } };
})();
