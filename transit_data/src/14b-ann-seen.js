/* ===========================================================================
   WHAT IS NEW TO YOU IN ALERTS (V4.8.3)

   The Alerts number on the bottom bar used to count every live notice, so it sat at 50 or 60 all day
   and said nothing. The owner asked for it to tell people about "actual new updates": once you have
   looked at the announcements it drops, and anything new or changed counts again, "even if the same
   line of bus … cause it is technically new".

   So the device remembers a FINGERPRINT of every notice you have seen: the notice's id and a hash of
   what a reader sees in it (its text in both languages, severity, end date, stations, template).
   The ids of rail and ferry notices stay the same when their text changes, which is why the text is
   part of the fingerprint; İETT bus notices already carry a hash of their text in their id, and a
   line's cancelled departures are one notice whose id and list change with every new departure.

   Only fields stored on the notice are used, never the translated text on screen: switching the
   language must not make anything "new". The list lives in localStorage (irn_ann_seen) and never
   leaves the device. Without storage the badge counts everything, as it did before.

   The list is only rewritten when you open the card, never while it is closed: the card is first drawn
   before İETT's bus notices arrive, and trimming the list to "what is live right now" at that moment
   threw away every bus notice you had seen (a reload showed 99+ again). When you open it, what is live
   goes first and older fingerprints follow, cut at ANN_SEEN_MAX, so it cannot grow without end. A
   notice that drops out of a feed for a moment and comes back unchanged is therefore not new; one that
   comes back changed is.
   =========================================================================== */
/* ==ANNSEEN-PURE-START== */
const ANN_SEEN_MAX = 2000;         // fingerprints kept: a bad day has a few hundred notices, each about 30 characters
function annFingerprint(d) {
  d = d || {};
  const v = [d.message, d.messageTr, d.severity, d.until, d.from, d.to, d.stations, d.tpl].map(function (x) { return x === undefined ? null : x; });
  return String(d.id) + '#' + _hash(JSON.stringify(v));
}
/* live: the notices the card is built from (rail, ferry and every single bus notice); seen: the stored fingerprints, or null
   when there is no storage; cardOpen: the person is looking at the card right now.
   → fresh: what is not seen yet (in live order), seen: what to store, badge: the number for the bottom bar */
function annSeenStep(live, seen, cardOpen) {
  const fps = [], have = {};
  (live || []).forEach(function (d) { const f = annFingerprint(d); if (!have[f]) { have[f] = 1; fps.push(f); } });
  if (seen === null || seen === undefined) return { seen: null, fresh: fps.slice(), badge: cardOpen ? 0 : fps.length };
  const known = {};
  seen.forEach(function (f) { known[f] = 1; });
  const fresh = fps.filter(function (f) { return !known[f]; });
  if (cardOpen) return { seen: fps.concat(seen.filter(function (f) { return !have[f]; })).slice(0, ANN_SEEN_MAX), fresh: fresh, badge: 0 };
  return { seen: seen.slice(), fresh: fresh, badge: fresh.length };
}
function annParseSeen(raw) {
  let v;
  try { v = JSON.parse(raw); } catch (e) { return []; }
  return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
}
/* ==ANNSEEN-PURE-END== */

/* The device side: where the list is kept, and whether the card is being looked at. */
const annVisitNew = new Set();     // what was new while the card was open this time: those rows carry a NEW tag until it closes
function annSeenLoad() {
  try { return annParseSeen(localStorage.getItem('irn_ann_seen')); } catch (e) { return null; }   // null: no storage, count everything
}
function annSeenSave(seen) {
  try { localStorage.setItem('irn_ann_seen', JSON.stringify(seen)); } catch (e) {}
}
/* On a phone the card lives in the Alerts sheet; on a wide screen it is the Announcements card, open unless collapsed.
   18-mobile-shell.js declares mSheets after this file runs, so a render before it exists finds no sheet. */
function annCardOpen() {
  let sheet = null;
  try { sheet = mSheets && mSheets.alerts; } catch (e) { sheet = null; }
  if (sheet) return sheet.classList.contains('open');
  const ann = document.getElementById('announce');
  return !!ann && !ann.classList.contains('collapsed') && ann.offsetParent !== null;
}
function annIsNew(d) { return annVisitNew.has(annFingerprint(d)); }
