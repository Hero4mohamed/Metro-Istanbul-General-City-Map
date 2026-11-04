/* Mutation check: does the suite actually catch the defects it claims to?
 *
 * Each mutation reintroduces a bug that really shipped. We break a COPY of index.html, run the
 * suite against it, and require the named test to fail. A suite that stays green no matter what
 * you do to the build is worse than no suite, because it buys false confidence.
 *
 * Two of these mutations were themselves wrong on the first attempt, and the check caught that
 * too: one anchored on a function form that does not exist, and one stripped SRI from the CSS
 * link rather than the script. That is the point — the mutations are tested as much as the tests.
 *
 * Usage: node transit_data/test/verify-suite.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'index.html');
/* One path per process. A fixed filename here is shared with every other checkout of this repo
   on the machine — and there are worktrees. Two verify-suites running at once each overwrote
   the other's mutant between the write and the spawn, so both reported a random handful of
   real defects as "not caught": the mutation under test had been replaced on disk by the other
   run's. Nothing in the output said so, which is the worst possible failure for an instrument
   whose whole job is to tell you the suite is honest. */
const TMP = path.join(os.tmpdir(), 'raynet-mutant-' + process.pid + '.html');
const TESTS = path.join(ROOT, 'transit_data', 'test');
const SUITES = fs.readdirSync(TESTS).filter(f => f.endsWith('.test.cjs')).map(f => path.join(TESTS, f));

/* V4.3: Leaflet and the typefaces ship with the app, so the third-party-host rows below ADD a host the page must not name,
   instead of stripping an integrity hash from a CDN file the page no longer loads. */

/* Anchor on ONE line. The sources carry mixed line endings, so index.html does too, and a
   two-line anchor joined with \n silently fails to match — the mutation is then reported
   SKIPPED rather than caught, which is how three checks here briefly proved nothing. Chain
   .replace() calls when the edit spans lines. */

const MUTATIONS = [
  {
    name: 'let the stop that is shut be the stop buses leave the route at',
    expect: 'a stop that is SHUT is not the stop buses leave at',
    apply: h => h.replace('const A = ms.filter(function (h) { return h.end <= leave.index && leave.index - h.end <= 30; }).pop();', 'const A = ms[0];'),
  },
  {
    name: 'draw a detour from a stop name that is two different stops',
    expect: 'a leave stop that is two different stops is a guess, so nothing is drawn',
    apply: h => h.replace('if (ia.length !== 1) continue;', 'if (!ia.length) continue;'),
  },
  {
    name: 'let buses rejoin the route BEHIND where they left it',
    expect: 'a detour is read only between two stops that are on the route, in travel order',
    apply: h => h.replace('.filter(function (i) { return i > ia[0]; });', '.filter(function (i) { return i !== ia[0]; });'),
  },
  {
    name: 'announce a departure that has already gone as cancelled',
    expect: 'cancelled departures: one entry per line, in time order, and a departure that has already gone is not listed',
    apply: h => h.replace('if (nowMin != null && at < nowMin - 2) continue;', ''),
  },
  {
    name: 'push an unread bus notice through the Turkish translator',
    expect: 'bus notices join the same active list as rail faults, and raw ones skip the Turkish translator',
    apply: h => h.replace("if(d.mode === 'bus') return { text:d.messageTr || d.message || '', lang:'tr' };", ''),
  },
  {
    name: 'draw a detour nobody checked',
    expect: 'a verified detour is drawn on the route, dashed, only from a stored direction and stop range',
    apply: h => h.replace("d.mode === 'bus' && d.ref === ref && d.detour", "d.mode === 'bus' && d.ref === ref"),
  },
  {
    name: 'leave the live bus notices out of the active list',
    expect: 'bus notices join the same active list as rail faults, and raw ones skip the Turkish translator',
    apply: h => h.replace('.concat(SURFACE_NOTICES).filter(disruptionActive)', '.filter(disruptionActive)'),
  },
  {
    name: 'let a bus notice be painted on a rail line that shares its code',
    expect: 'bus notices join the same active list as rail faults, and raw ones skip the Turkish translator',
    apply: h => h.replace("  if(d.mode === 'bus') return [];                 // a bus notice is drawn on the bus route (16-intercity.js), never on a rail line that shares its code", ''),
  },
  {
    name: 'show every bus group at once on a bad day',
    expect: 'the announcements card groups bus notices, collapses them, and caps what it shows at first',
    apply: h => h.replace('const ANN_BUS_SHOWN = 6;', 'const ANN_BUS_SHOWN = 600;'),
  },
  {
    name: 'forget the Arabic wording for a delay',
    expect: 'every sentence a notice can be made of exists in all four languages, and fills every hole',
    apply: h => h.replace('nDelay:"الرحلات متأخرة {m} دقيقة أو أكثر.", ', ''),
  },
  {
    name: 'stop showing bus and ferry notices on the trip legs they affect',
    expect: 'a trip leg on a line with a notice says so',
    apply: h => h.replace('const ns = noticesForRide(s);', 'const ns = [];'),
    name: 'announce "ferries may be held back" at a light breeze',
    expect: 'hints fire at their thresholds and not below them',
    apply: h => h.replace("if (mx >= 55) out.push({ k: 'ferry'", "if (mx >= 5) out.push({ k: 'ferry'"),
  },
  {
    name: 'announce rain that is a day away as likely',
    expect: 'hints fire at their thresholds and not below them',
    apply: h => h.replace('const n = Math.min(12, H.precipitation_probability.length);', 'const n = Math.min(24, H.precipitation_probability.length);'),
  },
  {
    name: 'push every air-quality band one step the wrong way',
    expect: 'air quality bands are the European index: 20, 40, 60, 80, 100 and above',
    apply: h => h.replace('if (v <= WX_AQI_BANDS[i][0]) return', 'if (v < WX_AQI_BANDS[i][0]) return'),
  },
  {
    name: 'point the wind arrow where the wind comes from',
    expect: 'wind is read as where it blows FROM, and the arrow points where it goes',
    apply: h => h.replace("transform:rotate(' + ((deg + 180) % 360) + 'deg)", "transform:rotate(' + (deg % 360) + 'deg)"),
  },
  {
    name: 'turn the compass at forty degrees instead of forty-five',
    expect: 'wind is read as where it blows FROM, and the arrow points where it goes',
    apply: h => h.replace('function wxCompass(deg) { return Math.round((((deg % 360) + 360) % 360) / 45) % 8; }', 'function wxCompass(deg) { return Math.round((((deg % 360) + 360) % 360) / 40) % 8; }'),
  },
  {
    name: 'keep the sun in the sky after sunset',
    expect: 'the sun\'s place in the day: nothing before sunrise or after sunset, half way at noon',
    apply: h => h.replace('if (a == null || b == null || b <= a || nowMin < a || nowMin > b) return null;', 'if (a == null || b == null || b <= a || nowMin < a) return null;'),
  },
  {
    name: 'read a place with no temperature as a place',
    expect: 'an answer is read as a list or as a single place, and a place without a temperature is a gap, not a zero',
    apply: h => h.replace("out.push(x && x.current && typeof x.current.temperature_2m === 'number' ? {", 'out.push(x && x.current ? {'),
  },
  {
    name: 'let the content-security policy block the air-quality service',
    expect: 'the page may talk to both Open-Meteo hosts and no others for weather',
    apply: h => h.replace('https://air-quality-api.open-meteo.com ', ''),
  },
  {
    name: 'put "İstanbul" over every city\'s weather',
    expect: 'every city has places to ask about, inside its own box, and the card names the city rather than İstanbul',
    apply: h => h.replace("if (t0) t0.textContent = CITY.name + ' · ' + t('wxTitleSuffix');", "if (t0) t0.textContent = 'İstanbul · ' + t('wxTitleSuffix');"),
  },
  {
    name: 'offer only three weather modes',
    expect: 'the weather code left 16-intercity.js, and the card keeps the ids the rest of the page reaches for',
    apply: h => h.replace('<button data-m="air" data-i18n="wxModeAir">🍃 Air</button>', ''),
  },
  {
    name: 'let the rain fall over the numbers as well as the sky',
    expect: 'motion is for show only: the scenes are CSS, and switch off with reduced motion',
    apply: h => h.replace('.k-rain .wx-fx i:nth-child(4),.k-storm .wx-fx i:nth-child(4){opacity:.32;inset:-20px 0 52% 0;', '.k-rain .wx-fx i:nth-child(4),.k-storm .wx-fx i:nth-child(4){opacity:.32;inset:-20px 0 0 0;'),
  },
  {
    name: 'forget the Turkish word for the wind hint\'s hour',
    expect: 'every word the weather card uses exists in all four languages, and a hint has its own sentence for each kind',
    apply: h => h.replace("wxHint_gust:\"Saat {at} civarında {v} km/sa'e varan hamleler\",", ''),
  },
  {
    name: 'corrupt a statement (the "$&" splice that killed the whole app)',
    expect: 'the inline application script parses',
    apply: h => h.replace('const svgEsc = s =>', 'const svgEsc = s => ) BROKEN'),
  },
  {
    name: 'drop a CSS comment terminator',
    expect: 'CSS comments and braces balance',
    apply: h => h.replace('/* Right control stack */', '/* Right control stack'),
  },
  {
    name: 'call a function that does not exist (the escapeHtml regression)',
    expect: 'no call to an undefined global',
    apply: h => h.replace('svgEsc(t("aiNoIdea"))', 'escapeHtml(t("aiNoIdea"))'),
  },
  {
    name: 'rename an element the script binds to',
    expect: 'every getElementById target exists in the markup',
    apply: h => h.replace('id="aiOrb"', 'id="aiOrbRenamed"'),
  },
  {
    name: 'load Leaflet from a CDN again',
    expect: 'the page loads no file from a CDN or any other host',
    apply: h => h.replace('src="vendor/leaflet/leaflet.js"', 'src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"'),
  },
  {
    name: 'leave a build token unreplaced',
    expect: 'no build tokens survive into the shipped page',
    apply: h => h.replace('const OPENINGS',
      'const OPENINGS_PLACEHOLDER = __OPENINGS_JSON__;\nconst OPENINGS'),
  },
  {
    name: 'move an API host out of the directive that governs it',
    expect: 'every host the page loads from is permitted by the RIGHT directive',
    // the exact first-attempt CSP bug: the host stayed somewhere else in the policy, so a whole-policy
    // check saw it and stayed green while the fetch was blocked. (Moved to img-src here: still in the policy, wrong directive.)
    apply: h => h.replace(new RegExp('(connect-src[^;]*?) https://api\\.anthropic\\.com'), (m, keep) => keep).replace("img-src 'self'", "img-src 'self' https://api.anthropic.com"),
  },
  {
    name: 'let a Google font host back into the policy',
    expect: 'neither the page, its policy nor its service worker names a third-party file host',
    apply: h => h.replace("style-src 'self'", "style-src 'self' https://fonts.googleapis.com"),
  },
  {
    name: 'point a typeface at a file that is not shipped',
    expect: 'every @font-face file exists',
    apply: h => h.replace('url(vendor/fonts/Inter-latin.woff2)', 'url(vendor/fonts/Inter-latin-gone.woff2)'),
  },
  {
    name: 'preload a typeface without crossorigin (fetched twice)',
    expect: 'every @font-face file exists',
    apply: h => h.replace('href="vendor/fonts/Inter-latin.woff2" crossorigin>', 'href="vendor/fonts/Inter-latin.woff2">'),
  },
  {
    name: 'let a typeface hide the text until it has loaded',
    expect: 'every @font-face file exists',
    apply: h => h.replace('font-display:swap;src:url(vendor/fonts/Inter-latin.woff2)', 'font-display:block;src:url(vendor/fonts/Inter-latin.woff2)'),
  },
  {
    name: 'name a shipped library file that is not there',
    expect: 'every vendor/ file the page names exists',
    apply: h => h.replace('href="vendor/leaflet/leaflet.css"', 'href="vendor/leaflet/leaflet-gone.css"'),
  },
  {
    name: 'call the simulated carriages live again (English)',
    expect: 'no language calls the carriages live or real-time',
    apply: h => h.replace('liveCarr:"Simulated carriages"', 'liveCarr:"Live carriages"'),
  },
  {
    name: 'call the simulated carriages live again (Arabic)',
    expect: 'no language calls the carriages live or real-time',
    apply: h => h.replace('liveCarr:"عربات محاكاة"', 'liveCarr:"عربات مباشرة"'),
  },
  {
    name: 'call the carriages real-time in the page description',
    expect: 'the page title, description, share text and install manifest do not claim live or real-time vehicles',
    apply: h => h.replace('Simulated carriages, official timetables', 'Real-time carriages, official timetables'),
  },
  {
    name: 'call the page live again in the title the app sets at run time',
    expect: 'the title the app sets at run time does not claim live or real-time vehicles either',
    apply: h => h.replace("' · RAY-NET — Transit Network Map';", "' · RAY-NET — Live Transit Network Map';"),
  },
  {
    name: 'turn online look-ups back on by default',
    expect: 'online look-ups are off until the person chooses',
    apply: h => h.replace("let onlineSearchPref = lsStr('irn_online') === '1';", "let onlineSearchPref = lsStr('irn_online') !== '0';"),
  },
  {
    name: 'let walking routes go to the routing server without asking',
    expect: 'with look-ups off, the walking-route, text-search and nearby-search calls never reach the network',
    apply: h => h.replace('async function fetchFoot(a,b){', 'async function fetchFoot(a,b){ var onlineSearchPref = true;'),
  },
  {
    name: 'let a nearby search send a position to Photon without asking',
    expect: 'with look-ups off, the walking-route, text-search and nearby-search calls never reach the network',
    apply: h => h.replace('async function poiNear(lat, lng, tag, radiusKm, limit){', 'async function poiNear(lat, lng, tag, radiusKm, limit){ var onlineSearchPref = true;'),
  },
  {
    name: 'let typed text go to Photon without asking',
    expect: 'with look-ups off, the walking-route, text-search and nearby-search calls never reach the network',
    apply: h => h.replace('async function photonSearch(q){', 'async function photonSearch(q){ var onlineSearchPref = true;'),
  },
  {
    name: 'add a fourth way to reach Photon that skips the gate',
    expect: 'no code path sends text or coordinates to Photon or the routing server except through those three gated functions',
    apply: h => h.replace('const BUILD = ', "const LEAK = p => fetch('https://photon.komoot.io/api/?q=' + p); const BUILD = "),
  },
  {
    name: 'make one answer to the privacy question look like the right one',
    expect: 'the privacy question gives both answers the same size and style',
    apply: h => h.replace('<button class="priv-btn" id="privAllow"', '<button class="priv-btn primary" id="privAllow"'),
  },
  {
    name: 'show the privacy question on top of the welcome dialog',
    expect: 'the privacy question waits for the welcome dialog',
    apply: h => h.replace("if(welcome && welcome.classList.contains('show')) return;", ''),
  },
  {
    name: 'let the privacy question steal the keyboard focus',
    expect: 'the privacy question waits for the welcome dialog',
    apply: h => h.replace("box.classList.add('show');", "box.classList.add('show'); box.focus();"),
  },
  {
    name: 'forget which version of the notice was answered',
    expect: 'the privacy question waits for the welcome dialog',
    apply: h => h.replace("lsStr('irn_privacy') !== PRIVACY_VERSION", "lsStr('irn_privacy') === null"),
  },
  {
    name: 'let the Settings switch leave the question open',
    expect: 'the privacy question waits for the welcome dialog',
    apply: h => h.replace("try{ localStorage.setItem('irn_privacy', PRIVACY_VERSION); }catch(e){}", ''),
  },
  {
    name: 'ask the privacy question for a policy version the pages do not carry',
    expect: 'every page says it is not legal advice, and the dates and versions agree with the config',
    apply: h => h.replace(/const PRIVACY_VERSION = '[^']*';/, "const PRIVACY_VERSION = '99';"),
  },
  {
    name: 'delete the whole address\'s storage, not just this app\'s',
    expect: '"delete all my data" removes this app',
    apply: h => h.replace("Object.keys(localStorage).filter(k => k.indexOf('irn_') === 0)", 'Object.keys(localStorage)'),
  },
  {
    name: 'leave the offline copies behind when deleting',
    expect: '"delete all my data" removes this app',
    apply: h => h.replace("n.indexOf('raynet-') === 0", "n.indexOf('raynet-') === 99"),
  },
  {
    name: 'delete on the first tap',
    expect: 'the delete button asks twice',
    apply: h => h.replace('if(!armed){', 'if(false){'),
  },
  {
    name: 'store something outside the irn_ prefix',
    expect: 'everything the app stores is under the irn_ prefix',
    apply: h => h.replace('const BUILD = ', "try{ localStorage.setItem('mapprefs', '1'); }catch(e){} const BUILD = "),
  },
  {
    name: 'add an analytics script',
    expect: 'everything the app stores is under the irn_ prefix',
    apply: h => h.replace('const BUILD = ', "const GA = 'https://www.googletagmanager.com/gtag/js'; const BUILD = "),
  },
  {
    name: 'ask for an e-mail address',
    expect: 'there is no sign-up, contact or payment form',
    apply: h => h.replace('<div class="priv-btns">', '<input type="email" name="email" autocomplete="email"><div class="priv-btns">'),
  },
  {
    name: 'add a sign-up form',
    expect: 'there is no sign-up, contact or payment form',
    apply: h => h.replace('<div class="priv-btns">', '<form action="https://example.com/join"></form><div class="priv-btns">'),
  },
  {
    name: 'drop the disclosure under Report a problem',
    expect: '"Report a problem" says what it opens',
    apply: h => h.replace('data-i18n="diagPrivacy"', 'data-i18n="diagPrivacyX"'),
  },
  {
    name: 'let a report forget which version of the app it came from',
    expect: '"Report a problem" says what it opens',
    apply: h => h.replace(/"app: V[\d.]+ build "/, '"build: "'),
  },
  {
    name: 'drop the terms link from the welcome dialog',
    expect: 'Settings and the welcome dialog link all four legal pages',
    apply: h => h.replace('<a data-legal="terms" href="legal/terms.html" target="_blank" rel="noopener" data-i18n="legalTerms">Terms of use</a> · ', ''),
  },
  {
    name: 'drop the cookies-and-stored-data link from Settings',
    expect: 'Settings and the welcome dialog link all four legal pages',
    apply: h => h.replace('data-legal="storage"', 'data-legal="storagex"'),
  },
  {
    name: 'send Turkish readers to the English legal pages',
    expect: 'Settings and the welcome dialog link all four legal pages',
    apply: h => h.replace("const suffix = (typeof lang !== 'undefined' && lang === 'tr') ? '.tr' : '';", "const suffix = '';"),
  },
  {
    name: 'paint text with the raw accent again (1.6:1 on a light panel)',
    expect: 'the accent is never used as text colour directly',
    apply: h => h.replace(/color:var\(--accent-ink\)/g, 'color:var(--accent)'),
  },
  {
    name: 'let Calm + Light keep the dark surface and track tokens',
    expect: 'a style that restates dark surface tokens restates the light ones for the light theme',
    apply: h => h.replace(/(contrast audit\) \*\/\s*)--surface:[^;]+; --surface-2:[^;]+; --track:[^;]+;/, '$1'),
  },
  {
    name: 'make the light theme\'s dim text too pale',
    expect: 'text on panels, chips and tinted chips passes AA: neon light',
    apply: h => h.replace('--dim:#5C6779', '--dim:#9AA5B5'),
  },
  {
    name: 'make the mixed theme\'s dim text too dark',
    expect: 'the "mixed" theme (dark panels on a light page) passes AA too',
    apply: h => h.replace('--dim:#98A3B8;', '--dim:#555566;'),
  },
  {
    name: 'make the accent ink too pale for the light theme',
    expect: 'text on panels, chips and tinted chips passes AA: atlas light',
    apply: h => h.replace('body.light{--accent-ink:#05694A;}', 'body.light{--accent-ink:#34D399;}'),
  },
  {
    name: 'go back to the brightness shortcut for text on coloured chips',
    expect: 'inkOn() gives every line colour, severity colour and a sweep of all colours text',
    apply: h => h.replace(/function inkOn\(hex\)\{[\s\S]*?\n\}/, "function inkOn(hex){ const c=(hex||'').replace('#',''); if(c.length<6) return '#fff'; const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)>150 ? '#0b0f17' : '#fff'; }"),
  },
  {
    name: 'paint a station-panel line chip without choosing its text colour',
    expect: 'every chip that paints a line or severity colour also chooses its text colour',
    apply: h => h.replace(";color:${inkOn(ln?ln.color:'#888')}", ''),
  },
  {
    name: 'give a close button a fixed English name again',
    expect: 'every hard-coded accessible name in the markup follows the language',
    apply: h => h.replace('id="settingsX" aria-label="Close" data-i18n-aria="close"', 'id="settingsX" aria-label="Close"'),
  },
  {
    name: 'lose a translated accessible name in Turkish',
    expect: 'every translated name has its key in all four languages',
    apply: h => h.replace('ariaPrevStep:"Önceki adım", ', ''),
  },
  {
    name: 'stop translating accessible names when the language changes',
    expect: 'applyI18n renames the accessible names when the language changes',
    apply: h => h.replace("'[data-i18n-aria]'", "'[data-i18n-ariaX]'"),
  },
  {
    name: 'stop announcing whether a switch is on',
    expect: 'every on/off switch announces its state',
    apply: h => h.replace("el.setAttribute('aria-checked', el.classList.contains('on')", "el.setAttribute('aria-checkedX', el.classList.contains('on')"),
  },
  {
    name: 'leave a switch without the label printed beside it',
    expect: 'syncAria names switches by the label beside them',
    apply: h => h.replace("el.setAttribute('aria-labelledby', label.id); el.removeAttribute('aria-label');", "el.removeAttribute('aria-label');"),
  },
  {
    name: 'leave the zoom buttons in English',
    expect: 'syncAria names switches by the label beside them',
    apply: h => h.replace("a.setAttribute('aria-label', t('zoomIn'));", "a.setAttribute('aria-label', 'Zoom in');"),
  },
  {
    name: 'stop making legend chips keyboard-operable',
    expect: 'the things you click that are not buttons become buttons',
    apply: h => h.replace("var KB_CLICKABLE = '.lchip, .lchip > .sw, ", "var KB_CLICKABLE = '.lchip > .sw, "),
  },
  {
    name: 'let a swatch also activate its chip',
    expect: 'the things you click that are not buttons become buttons',
    apply: h => h.replace('el.matches(KB_CLICKABLE)', 'el.closest(KB_CLICKABLE)'),
  },
  {
    name: 'let one Escape close Settings and end the journey too',
    expect: 'Escape closes the newest thing and nothing else',
    apply: h => h.replace("if(open('settingsPanel', 'open')){ closeSettings(); e.preventDefault(); return; }", "if(open('settingsPanel', 'open')){ closeSettings(); closeNearby(); exitGo(); e.preventDefault(); return; }"),
  },
  {
    name: 'let Tab reach a closed Settings panel',
    expect: 'dialogs are named dialogs',
    apply: h => h.replace('if(!d.hiddenByDisplay) el.inert = !isOpen;', ''),
  },
  {
    name: 'take the name off the Settings dialog',
    expect: 'dialogs are named dialogs',
    apply: h => h.replace('id="settingsPanel" role="dialog" aria-modal="true" aria-label="Settings" data-i18n-aria="settings"', 'id="settingsPanel" role="dialog" aria-modal="true"'),
  },
  {
    name: 'take the alt attribute off an image',
    expect: 'every image has alt text',
    apply: h => h.replace('width="44" height="44" alt="" aria-hidden="true"', 'width="44" height="44"'),
  },
  {
    name: 'block pinch zoom',
    expect: 'keyboard users can see where they are',
    apply: h => h.replace('viewport-fit=cover', 'viewport-fit=cover, user-scalable=no'),
  },
  {
    name: 'drop the skip link',
    expect: 'keyboard users can see where they are',
    apply: h => h.replace('class="skip-link"', 'class="skip-linkX"'),
  },
  {
    name: 'leave the base map turned back by the angle the pinch started at',
    expect: 'while two fingers turn the map, the base map is turned back by the angle the map has NOW',
    apply: h => h.replace('this._irnPlace(map.containerPointToLayerPoint(map.getSize().divideBy(2)).subtract(this.getSize().divideBy(2)), 1);', ''),
  },
  {
    name: 'draw the carriages and station names across the warning bubble again',
    expect: 'the carriage pass cuts the bubbles out AFTER it has drawn, every frame',
    apply: h => h.replace(/\n\s*clearUnderBubbles\(\);\n\}/, '\n}'),
  },
  {
    name: 'clear the carriage canvas in the wrong place',
    expect: 'whatever a tooltip, the pinned bubble or a popup covers is cleared out of the carriage canvas',
    apply: h => h.replace('tctx.clearRect(r.left - o.left - 4,', 'tctx.clearRect(r.left - o.left + 40,'),
  },
  {
    name: 'let the lines show through the pinned bubble',
    expect: 'the pinned warning bubble is opaque in every style',
    apply: h => h.replace('background-color:#090D14;backdrop-filter:none;', 'backdrop-filter:blur(10px);'),
  },
  {
    name: 'drop the MODELLED label from the arrivals board (French)',
    expect: 'the arrivals board still labels itself modelled',
    apply: h => h.replace('modelled:"MODÉLISÉ", ', ''),
  },
  {
    name: 'hash the bytes on disk instead of the text the parser sees',
    expect: 'the script hash matches the script the parser will see',
    apply: h => h.replace(/(script-src [^;]*)'sha256-[^']*'/, (m, keep) => keep + "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"),
  },
  {
    name: 'bake an API key into the page',
    expect: 'no API key is baked into the shipped page',
    apply: h => h.replace('const AI_MODEL',
      'const LEAKED = "sk-ant-abcdef123456";\n  const AI_MODEL'),
  },
  {
    // renaming a landmark breaks its Turkish aliases silently: nothing throws, the alias just
    // stops matching anything and Turkish speakers quietly lose the place
    name: 'rename a landmark out from under its Turkish aliases',
    expect: 'every search alias points at a landmark that still exists',
    apply: h => h.replace("'Galata Tower':", "'Galata Tower (old)':"),
  },
  {
    name: 'add an alias that just repeats the name it points at',
    expect: 'no search alias merely repeats the name it points at',
    apply: h => h.replace(/('Galata Tower':\s*\['Galata Kulesi')\]/,
                          (m, keep) => keep + ", 'Galata Tower']"),
  },
  {
    /* Reproduce the defect as it actually shipped: no locative rule, and the general rule left
       unanchored. Either half alone is now survivable — the \b stops the mangling even with the
       locative gone — so the mutation has to undo both to prove the check still bites. */
    name: 'restore the unanchored rule that rendered "istasyonunda" as "stationnda"',
    expect: 'the disruption translator never welds a Turkish suffix onto an English word',
    apply: h => h
      .replace("[/[İi]stasyon(?:umuz|u)?nda\\b/gi, { en:'at the station'", "[/[İi]stasyonXXnda\\b/gi, { en:'at the station'")
      .replace("[/[İi]stasyonda\\b/gi, { en:'at the station'", "[/[İi]stasyonXXda\\b/gi, { en:'at the station'")
      .replace("[/[İi]stasyon(?:umuz|u)?\\b/gi, { en:'station'", "[/[İi]stasyon(?:umuz|u)?/gi, { en:'station'"),
  },
  {
    // a rule that deletes the ending instead of translating it: nothing is mangled, but the
    // meaning is gone — which the mangle check alone would not notice
    name: 'translate a case ending to nothing instead of to English',
    expect: 'the disruption translator resolves the Turkish case endings it claims to',
    apply: h => h.replace("[/[İi]stasyon(?:umuz|u)?ndan\\b/gi, { en:'from the station'",
                          "[/[İi]stasyon(?:umuz|u)?ndan\\b/gi, { en:'station'"),
  },
  /* The four ways the coverage fallback can be got wrong. It decides whether an alert is
     shown in English or in the operator's own Turkish, so both directions of the threshold
     matter, and so does what the "Turkish" branch actually hands back. */
  {
    // too loose: back to shipping "Sanayi at the station bir yolcunun … has been closed."
    name: 'let a half-translated alert through as English',
    expect: 'an alert the rules cannot carry into English is shown in Turkish, not as a hybrid',
    apply: h => h.replace('const TR_FALLBACK_SHARE = 0.25;', 'const TR_FALLBACK_SHARE = 1;'),
  },
  {
    // too tight: one surviving word now condemns an otherwise good translation, and English
    // readers lose every alert the app CAN translate — a quieter failure than the hybrid
    name: 'tighten the coverage threshold until good translations are thrown away',
    expect: 'an alert the rules do cover is still translated',
    apply: h => h.replace('const TR_FALLBACK_SHARE = 0.25;', 'const TR_FALLBACK_SHARE = 0.1;'),
  },
  {
    // the fallback labels the text as the Turkish original but returns the hybrid: the same
    // defect wearing a badge, and invisible to any check that only looks at the label
    name: 'label the hybrid as the Turkish original instead of returning the original',
    expect: 'the Turkish fallback is the untouched original, never a rewrite',
    apply: h => h.replace("? { text:src, lang:'tr', share:share }", "? { text:out, lang:'tr', share:share }"),
  },
  {
    // station names pass through the translator untouched by design; counting them as
    // untranslated Turkish makes an alert score worse the more places it names
    name: 'count proper nouns as untranslated Turkish',
    expect: 'station and line names do not count against translation coverage',
    apply: h => h.replace('    if(TR_CAPPED.test(w)) continue;', '    if(false) continue;'),
  },

  /* --- the other two languages -----------------------------------------------------------
     Every one of these was true of the shipped page until it was fixed: the rules produced
     English and nothing else, the dictionaries had drifted a fifth of the way behind in
     Arabic and French, and Arabic was laid out left to right. They are the failure mode this
     product is most prone to, because all of them look fine to a reader of English. */
  {
    // an English-only rule degrades every announcement it matches, in silence
    name: "add a rule that only says what it produces in English",
    expect: "every rule says what it produces in every language, not only in English",
    apply: h => h.replace("{ en:'due to a technical fault,', ar:'بسبب عطل فني،'",
                          "{ en:'due to a technical fault,', ar:''"),
  },
  {
    // the defect as it shipped: the rules run, but always into English, whoever is reading
    name: "translate into English whatever language was asked for",
    expect: "a covered alert is translated into each language, not handed over in English",
    apply: h => h.replace("for(const [re,rep] of TR_PHRASES) s=s.replace(re, rep[tgt]);",
                          "for(const [re,rep] of TR_PHRASES) s=s.replace(re, rep.en);"),
  },
  {
    /* Arabic words can only have come from our own replacement tables, so they are what
       proves an Arabic translation happened. Scoring them as untranslated source text sends
       every Arabic alert over the fallback threshold, and Arabic readers quietly go back to
       being shown Turkish for announcements the rules handle perfectly well. */
    name: "score Arabic script as untranslated source text",
    expect: "an Arabic conjunction joined to a station name is not read as untranslated Turkish",
    apply: h => h.replace("if(TR_ARABIC.test(w)){ translated++; continue; }",
                          "if(false){ translated++; continue; }"),
  },
  {
    // how ar and fr fell 101 keys behind: t() falls back to English without saying so
    name: "let a language fall behind on keys again",
    expect: "every language covers the keys English defines",
    apply: h => h.replace('omniPlaces:"الأماكن", ', ''),
  },
  {
    /* {n} is substituted with .replace(), so a translation that loses it prints the sentence
       with the number missing rather than failing — invisible to anyone reading English. */
    name: "drop a placeholder from a translated string",
    expect: "a translated string keeps every placeholder its English original has",
    apply: h => h.replace('provDays:"قبل {n} يوم"', 'provDays:"قبل يوم"'),
  },
  {
    // lang without dir: Arabic sentences laid out as English, and mixed runs reordered
    name: "set the language for Arabic but not the direction",
    expect: "the page sets a text direction, not just a language",
    apply: h => h.replace('document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";', ''),
  },
  {
    /* Each language is scored against the words IT can emit. Judging French output by the
       English vocabulary marks most of a correct French sentence as untranslated Turkish,
       pushes it over the fallback threshold, and hands French readers the Turkish original
       for announcements the rules translate perfectly well. */
    name: "judge every language by the English vocabulary",
    expect: "a covered alert is translated into each language, not handed over in English",
    apply: h => h.replace("if(TR_EMITTED[tgt].has(k)){ translated++; continue; }",
                          "if(TR_EMITTED.en.has(k)){ translated++; continue; }"),
  },

  /* --- timing engine ---------------------------------------------------------------------
     These reproduce how the planner was wrong before it had a departure oracle, plus the ways
     it could quietly become wrong again. The theme is the same throughout: a confident number
     with nothing behind it is worse than an admitted estimate. */
  {
    // the original defect: every change cost half a headway and none could ever be missed
    name: 'make every change safe so no connection can be missed',
    expect: 'transfer verdicts follow the slack, and a missed connection is reachable',
    apply: h => h.replace("{ id: 'infeasible', maxSlack: 0 },", "{ id: 'safe', maxSlack: 0 },"),
  },
  {
    name: 'take the strongest leg confidence instead of the weakest',
    expect: 'journey confidence is the weakest leg, never an average',
    apply: h => h.replace('if (CONF_RANK[c] < CONF_RANK[worst]) worst = c;',
                          'if (CONF_RANK[c] > CONF_RANK[worst]) worst = c;'),
  },
  {
    name: 'drop the wait cap so one rare bus dominates every route',
    expect: 'expected wait on a frequency is half the headway, and capped',
    apply: h => h.replace('return Math.min(WAIT_CAP_MIN, Math.max(0.5, headwayMin / 2));',
                          'return Math.max(0.5, headwayMin / 2);'),
  },
  {
    name: "read the operator's 24:15 as a quarter past midnight this morning",
    expect: 'operator times past midnight are read as the next day, not rejected',
    apply: h => h.replace('  return h * 60 + mm;', '  return (h * 60 + mm) % 1440;'),
  },
  {
    name: 'badge the modelled arrivals board as LIVE again',
    expect: 'the modelled arrivals board is not badged as live',
    apply: h => h.replace('<span class="modelled" data-i18n="modelled">MODELLED</span>',
                          '<span class="live" data-i18n="live">LIVE</span>'),
  },
  {
    name: 'give a transfer a verdict with no timetable behind it',
    expect: 'a transfer onto a line with no timetable yields no verdict',
    apply: h => h.replace("verdict: 'frequency', departMin: null", "verdict: 'ok', departMin: null"),
  },
  {
    // the mean would call a line with one overnight gap "every four hours"
    name: 'use the mean gap instead of the median',
    expect: 'the typical gap ignores the overnight hole at the ends of a timetable',
    apply: h => h.replace('return gaps[Math.floor(gaps.length / 2)];',
                          'return gaps.reduce((a,b)=>a+b,0)/gaps.length;'),
  },
  {
    // claiming a named train was missed on the strength of an ESTIMATED arrival minute
    name: 'declare a missed connection from an estimated arrival time',
    expect: 'a missed connection is only claimed when both times are known',
    apply: h => h.replace('if (slack < 0 && arrivalExact) {', 'if (slack < 0) {'),
  },
  {
    /* --- trip matching. The failure mode is always the same shape: a confident arrival time
       produced from data that cannot support one. */
    name: 'accept an aliased offset instead of refusing an ambiguous window',
    expect: 'an offset is refused when a whole headway makes two answers equally good',
    apply: h => h.replace('if (secondN > 0 && bestN < secondN * 1.5) return null;', ''),
  },
  {
    name: 'accept a run time only a quarter of the trips agree with',
    expect: 'an offset is refused when the timetables do not really agree',
    apply: h => h.replace('if (support < 0.6) return null;', 'if (support < 0.05) return null;'),
  },
  {
    name: 'derive a run time from two departures',
    expect: 'trip matching declines rather than guessing on thin or missing data',
    apply: h => h.replace('fromTimes.length < 3 || toTimes.length < 3', 'false'),
  },
  {
    // the M1B bug: the operator's terminus is not on our station list, so name and index
    // matching both fail and every leg on the line silently loses its timetable
    name: 'drop the geometric direction fallback',
    expect: 'direction is decided by position or geography, never by terminus name alone',
    apply: h => h.replace('    const c = stationCoordsByName(d.towards);', '    const c = null;'),
  },
  {
    name: 'exclude a direction the operator describes unusually',
    expect: 'direction is decided by position or geography, never by terminus name alone',
    apply: h => h.replace('if (!d || !d.towards) return true;', 'if (!d || !d.towards) return false;'),
  },
  {
    name: 'trip-match a leg even when one end has no usable direction',
    expect: 'a leg that ends at a terminus keeps an estimated arrival',
    apply: h => h.replace('if (!ta || !tb) return null;', 'if (!ta && !tb) return null;'),
  },
  {
    /* The exact defect this guard was added for: HW_CACHE was deleted during the router
       refactor and a `for(const k in HW_CACHE)` survived in the bus-loading path. Every static
       test stayed green and the browser threw the moment the lazy bus data landed. */
    name: 'reference a shared table that was deleted in a refactor',
    expect: 'no reference to an undefined shared data table',
    apply: h => h.replace('const go = ()=>{ integrateBuses(); busReady = true; clearWaitCache(); busReadyResolve(); };',
                          'const go = ()=>{ integrateBuses(); for(const k in HW_CACHE) delete HW_CACHE[k]; busReady = true; busReadyResolve(); };'),
  },
  {
    /* --- time-dependent routing. The original defect: the same wait at every hour, so a route
       that could not move until morning outranked one running now. */
    name: 'charge the same wait whatever the hour',
    expect: 'the search charges a wait that depends on the clock',
    apply: h => h.replace("nd += XFER_PREF + waitAt(vm.ref, vm.kind==='bus', t0 + du, vm.refId);",
                          "nd += XFER_PREF + waitAt(vm.ref, vm.kind==='bus', 9*60, vm.refId);"),
  },
  {
    name: 'make the first boarding free again',
    expect: 'the search charges a wait that depends on the clock',
    apply: h => h.replace("    w += waitAt(nodeMeta[k].ref, nodeMeta[k].kind==='bus', t0 + w, nodeMeta[k].refId);", ''),
  },
  {
    name: 'route onto a line a major disruption has suspended',
    expect: 'a suspended line is excluded from routing, not merely warned about',
    apply: h => h.replace('(susp && susp.size && susp.has(m.ref)) ||', '(false) ||'),
  },
  {
    name: 'leave a line suspended forever after the works finish',
    expect: 'a suspended line is excluded from routing, not merely warned about',
    apply: h => h.replace('    if(!disruptionActive(d)) continue;', ''),
  },
  {
    name: 'search an "arrive by" request at the current clock',
    expect: '"arrive by" searches near the target, not near now',
    apply: h => h.replace('t0 = planWhen.min - Math.min(240, Math.max(5, span));', 't0 = searchStartMin();'),
  },
  {
    name: 'rank alternatives on travel time and ignore the waiting',
    expect: 'ranking compares door-to-door time, not travel time alone',
    apply: h => h.replace('const dt = x => (x.it.doorTotal != null ? x.it.doorTotal : x.it.total);',
                          'const dt = x => x.it.total;'),
  },
  {
    // an inadmissible heuristic silently returns non-optimal routes — no error, just worse answers
    name: 'hard-code an A* speed slower than the fastest mode',
    expect: 'the search is guided but still optimal',
    apply: h => h.replace(/const FASTEST_KMH = \(\(\) => \{[\s\S]*?\}\)\(\);/, 'const FASTEST_KMH = 100;'),
  },
  {
    // the original defect: two cars on one rope, simulated as if they were unrelated
    name: 'simulate a funicular as two independent shuttles',
    expect: 'a funicular is modelled as a counterbalanced pair',
    apply: h => h.replace("if(line.kind === 'funicular' && line.paired !== false", "if(false && line.paired !== false"),
  },
  {
    name: 'let the normal loop move the derived car as well',
    expect: 'a funicular is modelled as a counterbalanced pair',
    apply: h => h.replace('if(tr.mirrorOf) continue;                 // derived from its partner in the second pass', ''),
  },
  {
    name: 'pair the aerial cable cars on a guess',
    expect: 'the counterbalance is not applied to modes it was not established for',
    apply: h => h.replace("if(line.kind === 'funicular' && line.paired !== false",
                          "if((line.kind === 'funicular' || line.kind === 'cable') && line.paired !== false"),
  },
  {
    /* --- the LLM/engine boundary. Each of these lets the model answer from its own reasoning
       instead of from a computed result, which produces a plausible answer nothing can check. */
    name: 'let the model do the transport arithmetic itself',
    expect: 'the assistant is told not to do transport arithmetic itself',
    apply: h => h.replace('You do not do transport arithmetic.', 'Work out the timings yourself.'),
  },
  {
    // advertising a tool that is not implemented: the model calls it, gets "unknown tool", and
    // falls back to guessing — the failure looks like the app's, so nothing flags it
    name: 'offer the model a tool that is not implemented',
    expect: 'every transport tool the model is offered actually exists',
    apply: h => h.replace('{ name:"next_departures"', '{ name:"predict_delay", description:"x", input_schema:{type:"object",properties:{}} },\n    { name:"next_departures"'),
  },
  {
    name: 'seal the tool surface back inside the assistant closure',
    expect: 'the deterministic tool surface is reachable by name',
    apply: h => h.replace('_transportToolRunner = (name, a) => runAiTool(name, a);', ''),
  },
  {
    name: 'hand the model a journey with no indication of where its times came from',
    expect: 'a journey handed to the model says where each leg’s time came from',
    apply: h => h.replace(/departure_is_exact: !!\(r\.dep && r\.dep\.exact\),/, ''),
  },
  {
    /* --- design tokens. The extraction is only durable if re-hardcoding is caught: one new
       rule with a literal green quietly re-creates the split it removed. */
    name: 'write a tokenised colour back out as a literal',
    expect: 'no rule re-hardcodes a colour that has a semantic token',
    apply: h => h.replace('.st-fare{', '.st-fare{color:#067A54;'),
  },
  {
    // a token with no light value falls back to the dark one — a dark ink on a light surface,
    // which is exactly the defect the extraction fixed
    name: 'define a semantic ink for the dark theme only',
    expect: 'every semantic ink is defined for both themes',
    apply: h => h.replace(/--violet-ink:#7C3AED;\s*/, ''),
  },
  {
    /* --- the second experience. Each of these is a way for Paper to decay back into the thing
       the brief rules out: a palette swap wearing a new name. */
    name: 'let Paper inherit part of the default palette',
    expect: 'Paper restates the whole palette, not part of it',
    apply: h => h.replace(/--violet-ink:#C9B4EC;\s*/, ''),
  },
  {
    name: 'ship a Paper tier below the contrast threshold',
    expect: 'Paper meets AA on its own surface, in both themes',
    apply: h => h.replace('--dim:#A39A89;', '--dim:#6A6357;'),      // V4.3 raised Paper's dim text from #898172 to #A39A89 (found by the contrast audit)
  },
  {
    // the glass is the default's central visual idea; keeping it makes Paper a recolour
    name: 'put the glass back into Paper',
    expect: 'Paper is a structural change, not only a palette',
    apply: h => h.replace('backdrop-filter:none;-webkit-backdrop-filter:none;', ''),
  },
  {
    name: 'offer an experience with no stylesheet behind it',
    expect: 'every declared experience has a stylesheet and a control',
    apply: h => h.replace("const UI_STYLES = ['atlas', 'neon', 'calm', 'paper']",
                          "const UI_STYLES = ['atlas', 'neon', 'calm', 'paper', 'halo']"),
  },
  {
    /* --- the size ramp. One tier is 143 declarations, so a typo here resizes a third of the
       interface and nothing else in the suite would notice. */
    name: 'nudge a default type tier',
    expect: 'the size ramp still holds the values it replaced',
    apply: h => h.replace('--fs-5:9px;', '--fs-5:9.5px;'),
  },
  {
    name: 'write a ramp size back out as a literal',
    expect: 'no rule hard-codes a size the ramp already covers',
    apply: h => h.replace('.ac-hint{', '.ac-hint{font-size:10.5px;'),
  },
  {
    // a half-restated ramp inverts the hierarchy: some tiers lift, others do not
    name: 'let Paper restate only part of the type scale',
    expect: 'Paper restates the whole ramp, upward',
    apply: h => h.replace(/--fs-7:11\.5px;\s*/, ''),
  },
  {
    name: 'let Paper shrink a tier below the default',
    expect: 'Paper restates the whole ramp, upward',
    apply: h => h.replace('--fs-8:12px;', '--fs-8:9px;'),
  },
  {
    name: 'write a pill radius back out as a literal',
    expect: 'the uniform radii are tokens, not repeated literals',
    apply: h => h.replace('.badge{', '.badge{border-radius:99px;'),
  },
  {
    name: 'rate a shut line as a high-confidence departure',
    expect: 'a journey through a shut line does not claim timetable-grade confidence',
    apply: h => h.replace(
      "return { source: 'modeDefault', confidence: 'low', exact: false, headwayMin: null,\n             times: null, next: null, waitMin: null, reason: 'closed', closed };",
      "return { source: 'modeDefault', confidence: 'high', exact: false, headwayMin: null,\n             times: null, next: null, waitMin: null, reason: 'closed', closed };"),
  },
  {
    name: 'put second-level precision back on a modelled arrivals board',
    expect: 'the modelled board does not quote seconds',
    apply: h => h.replace("  return {t:'~'+Math.max(1, Math.round(sec/60))+' '+t('minUnit'), now:false};",
      '  const m=Math.floor(sec/60), s=Math.floor(sec%60);\n' +
      '  return {t:(m>0?m+"m ":"")+String(s).padStart(2,"0")+"s", now:false};'),
  },
  /* --- the disruption clock, and marking a line without replacing it --- */
  /* --- basemaps: keyless and capped --- */
  {
    name: 'put a keyed CARTO basemap back',
    expect: 'every basemap is keyless and depth-capped',
    apply: h => h.replace("const ESRI_STREETS = ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}';",
                          "const ESRI_STREETS = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';"),
  },
  /* --- Atlas: the default experience, the basemap regrade, and the line outlines --- */
  {
    name: 'make Atlas the default experience again',
    expect: 'Neon is the default experience, and the others are still selectable',
    apply: h => h.replace("const DEFAULT_UI_STYLE = 'neon';", "const DEFAULT_UI_STYLE = 'atlas';"),
  },
  {
    name: 'let a saved experience be overridden by the default',
    expect: 'Neon is the default experience, and the others are still selectable',
    apply: h => h.replace('return UI_STYLES.indexOf(v) >= 0 ? v : DEFAULT_UI_STYLE; }catch(e)', 'return DEFAULT_UI_STYLE; }catch(e)'),
  },
  {
    name: 'stop erasing the ferry routes Esri bakes into the sea tiles',
    expect: 'a ferry route drawn into the sea tile is erased, in both tones',
    apply: h => h.replace('if (wm[i >> 2] && l >= .42 && l < .84 && around(i >> 2) >= 7) {', 'if (false) {'),
  },
  {
    name: 'erase blue on land as if it were a ferry route',
    expect: 'blue on land is not mistaken for a ferry route',
    apply: h => h.replace('n += (xx < 0 || yy < 0 || xx >= side || yy >= side) ? 1 : wm[yy * side + xx];', 'n += 1;'),
  },
  {
    name: 'let a folded planner swallow a dropped pin (setPoint no longer opens it)',
    expect: 'putting something into a folded planner opens it',
    apply: h => h.replace('if(pt) openPlannerCard();', ''),
  },
  {
    name: 'let a folded planner swallow the route answer (runRoute no longer opens it)',
    expect: 'putting something into a folded planner opens it',
    apply: h => h.replace('  openPlannerCard();                         // the answer renders inside the card', ''),
  },
  {
    name: 'point the planner title at a body that is not there',
    expect: 'the planner title is a button wired to a body that exists and can fold',
    apply: h => h.replace('aria-controls="plannerBody"', 'aria-controls="plannerBodyX"'),
  },
  {
    name: 'make the planner share the Layers card fold memory',
    expect: 'the planner remembers its own fold, apart from the Layers card',
    apply: h => h.replace('wireFold("plannerHead","plannerBody","irn_planner")', 'wireFold("plannerHead","plannerBody","irn_layers")'),
  },
  {
    name: 'stop unifying the road colour (white streets stay a different colour from arterials)',
    expect: 'every road is the same light grey at night, whatever Esri drew it as',
    apply: h => h.replace('if (OW && dd < .045 && l > .93 && !near[i >> 2]) {', 'if (false) {'),
  },
  {
    name: 'let a road sit white under a label (the halo and the street are the same white)',
    expect: 'a street under a label goes dark, so the letters stay readable',
    apply: h => h.replace('if (OW && dd < .045 && l > .93 && !near[i >> 2]) {', 'if (OW && dd < .045 && l > .93) {'),
  },
  {
    name: 'turn the land into road (the white ramp starts below the land colour)',
    expect: 'the land is never mistaken for a road',
    apply: h => h.replace('const w = _smooth(.93, .995, l);', 'const w = _smooth(.60, .995, l);'),
  },
  {
    name: 'leave road shields and symbols on the map',
    expect: 'a road shield or symbol is removed, white letters and all, in both tones',
    apply: h => h.replace('if (blobs && blobs[i >> 2]) {', 'if (false) {'),
  },
  {
    name: 'erase coloured label text as if it were a sign (or leave it at full strength)',
    expect: 'a thin coloured stroke is a letter, not a sign: it stays, quieter than it was',
    apply: h => h.replace('if (QI && l < .55 && dd >= .07) {', 'if (false) {'),
  },
  {
    name: 'stop dimming grey text when the map is zoomed out',
    expect: 'grey text is dimmer the further out the map is, and untouched up close',
    apply: h => h.replace('if (gain < 1 && l < .45 && dd < .12) {', 'if (false) {'),
  },
  {
    name: 'let land use recolour streets and labels (drop the ground gate)',
    expect: 'a street, a label and the sea come through a polygon unchanged',
    apply: h => h.replace('const c = dl >= 0 ? 1 - dl / LU.bright : 1 + dl / LU.dark;', 'const c = 1;'),
  },
  {
    name: 'let land use paint over the sea',
    expect: 'a street, a label and the sea come through a polygon unchanged',
    apply: h => h.replace('if (luA && luA[i + 3] && !wm[i >> 2]) paintLanduse(d, i, luA);', 'if (luA && luA[i + 3]) paintLanduse(d, i, luA);'),
  },
  {
    name: 'ignore how much of a pixel the polygon covers (hard edges)',
    expect: 'a polygon edge is a blend, not a step',
    apply: h => h.replace('const w = m * (c > 1 ? 1 : c);', 'const w = (m > 0 ? 1 : 0) * (c > 1 ? 1 : c);'),
  },
  {
    name: "keep Esri's park tint inside the city (it doubles the polygons)",
    expect: "a tile with no land-use data is graded exactly as before; one inside the city drops the raster's own park tint",
    apply: h => h.replace('const pk = covered ? 0 : (z === undefined', 'const pk = (z === undefined'),
  },
  {
    name: 'read every polygon as the same class',
    expect: 'the page decodes a processed file back onto the right Web-Mercator spot',
    apply: h => h.replace('c: LANDUSE_CLASSES.indexOf(cls[p[0]]),', 'c: 1,'),
  },
  {
    name: 'draw polygons a quarter as small at every zoom (a speck at z8)',
    expect: 'small polygons are left out when zoomed out, and the cut-off halves in each dimension per zoom',
    apply: h => h.replace('const mpp = 118000 / Math.pow(2, z);', 'const mpp = 118000 / Math.pow(2, z) / 4;'),
  },
  {
    name: 'draw every plain station dot at every zoom',
    expect: 'station dots are small with a thin ring, and a plain stop is only drawn once the map is zoomed in',
    apply: h => h.replace('const STOP_MIN_ZOOM = 12;', 'const STOP_MIN_ZOOM = 0;'),
  },
  {
    name: 'thicken the station outline again',
    expect: 'station dots are small with a thin ring, and a plain stop is only drawn once the map is zoomed in',
    apply: h => h.replace('const STATION_RING = 1.4;', 'const STATION_RING = 2.4;'),
  },
  {
    name: 'fill a station dot with its line colour again',
    expect: 'every station dot is the same white disc with a thick black outline',
    apply: h => h.replace("renderer:stationRenderer, radius: base, color:'#05070A', weight:STATION_RING, fillColor:'#FFFFFF'", "renderer:stationRenderer, radius: base, color:'#05070A', weight:STATION_RING, fillColor: col"),
  },
  {
    name: 'draw the strip-map terminus the old coloured way',
    expect: 'the line-panel strip map uses the same station dot',
    apply: h => h.replace('r="8" fill="#fff" stroke="#05070A" stroke-width="3.4"', 'r="8" fill="var(--svg-hole)" stroke="#05070A" stroke-width="3.4"'),
  },
  {
    name: 'never mark the body as Mixed',
    expect: 'the fourth theme, Mixed, is offered, remembered and keeps the tabs, layers, planner and announcements dark',
    apply: h => h.replace("document.body.classList.toggle('mixed', themePref==='split');", ''),
  },
  {
    name: 'let the Mixed theme resolve to the dark page',
    expect: 'the fourth theme, Mixed, is offered, remembered and keeps the tabs, layers, planner and announcements dark',
    apply: h => h.replace("return (pref==='light'||pref==='split')?'light':'dark'; }", "return (pref==='light')?'light':'dark'; }"),
  },
  {
    name: 'give every line the same white outline, whatever its colour',
    expect: 'every line colour stays visible on the land, in both tones',
    apply: h => h.replace('if (contrastRgb(C, G) >= 3 && contrastRgb(C, neutral) >= 2.2) return rgbToHex(neutral);',
                          'if (true) return rgbToHex(neutral);'),
  },
  {
    name: 'search the outline tint the wrong way (lighter by day, darker by night)',
    expect: 'a line that already shows gets the plain outline; one that does not gets a tint of its own colour',
    apply: h => h.replace("const toward = tone === 'night' ? [255, 255, 255] : [0, 0, 0];",
                          "const toward = tone === 'night' ? [0, 0, 0] : [255, 255, 255];"),
  },
  {
    name: 'start lifting greys so low that label text is altered by day',
    expect: 'place names survive the regrade',
    apply: h => h.replace('curve: [[0, 0], [.6, .6], [.72, .79], [.82, .91], [.92, .97], [1, 1]],',
                          'curve: [[0, 0], [.2, .45], [.72, .79], [.82, .91], [.92, .97], [1, 1]],'),
  },
  {
    name: 'invert the night road hierarchy (roads darker than land, as CSS invert() does)',
    expect: 'by night a road is brighter than the land, not darker',
    apply: h => h.replace('roadGrey: [92, 98, 112], roadHalo: [21, 25, 35],', 'roadGrey: [12, 12, 14], roadHalo: [21, 25, 35],'),
  },
  {
    name: 'let night label text stay dark',
    expect: 'place names survive the regrade',
    apply: h => h.replace('curve: [[0, .82], [.2, .72], [.35, .55], [.5, .42], [.62, .30],', 'curve: [[0, .10], [.2, .12], [.35, .16], [.5, .20], [.62, .30],'),
  },
  {
    name: 'make the ground differ from the land colour (every tile seam shows)',
    expect: 'the ground is the land colour, so a tile seam is invisible',
    apply: h => h.replace('ground: [243, 240, 233],                  // the colour the map shows through a tile seam',
                          'ground: [243, 240, 226],                  // the colour the map shows through a tile seam'),
  },
  {
    name: 'merge the park class into land (green stops being green)',
    expect: 'park and land stay distinct classes — green stays green',
    apply: h => h.replace('park:  { c: [205, 229, 192], ref: .82, k: .18 },', 'park:  { c: [243, 240, 233], ref: .82, k: .18 },'),
  },
  {
    name: 'keep the park colour at country scale',
    expect: 'at country scale a green pixel is land cover, not a park: the park colour fades out by z8',
    apply: h => h.replace('const pk = covered ? 0 : (z === undefined || z === null) ? 1 : _smooth(8, 11, z);', 'const pk = covered ? 0 : 1;'),
  },
  {
    name: 'let the regrade write past 255',
    expect: 'alpha is never touched, and every channel stays a real colour',
    apply: h => h.replace('function _clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }', 'function _clamp255(v) { return v; }'),
  },
  {
    name: 'let the chrome drift from the ground it sits on',
    expect: "the chrome IS the ground: Atlas panels share the map's colour",
    apply: h => h.replace('--obsidian:#1B1F2A; --panel:rgba(24,28,38,.90);', '--obsidian:#1B1F2B; --panel:rgba(24,28,38,.90);'),
  },
  {
    name: 'ship a day --dim that fails AA on the ivory ground',
    expect: 'Atlas meets AA on its own surface, in both themes',
    apply: h => h.replace('--muted:#4F5B70; --dim:#5D697D;', '--muted:#4F5B70; --dim:#9AA5B8;'),
  },
  {
    name: 'ship a button gradient the ink cannot be read on',
    expect: 'Atlas meets AA on its own surface, in both themes',
    apply: h => h.replace('--grad-accent:linear-gradient(135deg,#087A69,#0A6B83);', '--grad-accent:linear-gradient(135deg,#34C9A8,#2BB6D6);'),
  },
  {
    name: 'hard-code the zoom controls dark again',
    expect: 'Atlas is a structural change, not only a palette',
    apply: h => h.replace('body.atlas .leaflet-bar a{background:var(--panel)!important;', 'body.atlas .leaflet-bar a{background:#0d111b!important;'),
  },
  {
    name: 'lose the dash on the outline (a suspended line looks ordinary again)',
    expect: 'line outlines replace the glow, and the glow comes back for the other experiences',
    apply: h => h.replace('dashArray:o.solidCasing ? null : ((o.pair && o.pair.pl.options.dashArray) || null) });', 'dashArray:null });'),
  },
  {
    name: 'leave the outline on when the experience changes (glow never returns)',
    expect: 'line outlines replace the glow, and the glow comes back for the other experiences',
    apply: h => h.replace('      o.base = o.glowBase;', '      o.base = o.coreBase + CASING_PAD_PLANNED;'),
  },
  {
    name: 'draw station labels in light-on-dark ink on every basemap',
    expect: 'everything drawn on the map follows the BASEMAP, not the UI theme',
    apply: h => h.replace('tctx.strokeStyle = T.halo;', 'tctx.strokeStyle = "rgba(7,10,16,0.92)";'),
  },
  {
    name: 'derive the map tone from the UI theme instead of the basemap',
    expect: 'everything drawn on the map follows the BASEMAP, not the UI theme',
    apply: h => h.replace("function mapTone(){ return curBaseKey === 'dark' ? 'night'", "function mapTone(){ return document.body.classList.contains('light') ? 'day'"),
  },
  {
    name: 'switch the basemap without re-toning what is drawn on it',
    expect: 'everything drawn on the map follows the BASEMAP, not the UI theme',
    apply: h => h.replace('  applyMapTone();', ''),
  },
  {
    name: 'ship a basemap with no depth cap',
    expect: 'every basemap is keyless and depth-capped',
    apply: h => h.replace('Object.assign({ maxZoom:20, maxNativeZoom:19, attribution:ESRI_ATTR,', 'Object.assign({ maxZoom:20, attribution:ESRI_ATTR,'),
  },
  {
    name: 'let a finished works order keep the line shut (the B2 case)',
    expect: 'a fault with an end date is over the moment that date is out',
    apply: h => h.replace('  return end >= Date.now();', '  return true;'),
  },
  {
    name: 'let a typo in the until date put a shut line back online',
    expect: 'a fault with no end date, or an unreadable one, is never silently dropped',
    apply: h => h.replace('  if(Number.isNaN(end)) return true;', '  if(Number.isNaN(end)) return false;'),
  },
  {
    name: 'count ended faults in the announcements badge again',
    expect: 'everything that shows a fault reads the same active list',
    apply: h => h.replace('  const live = activeDisruptions();', '  const live = DISRUPTIONS;'),
  },
  {
    name: 'hand the model the raw feed, ended faults included',
    expect: 'everything that shows a fault reads the same active list',
    apply: h => h.replace('      return { count:live.length,', '      return { count:(DISRUPTIONS||[]).length,')
                  .replace('               alerts:live.map(d => ({ line:d.ref',
                           '               alerts:(DISRUPTIONS||[]).map(d => ({ line:d.ref'),
  },
  {
    name: 'stop noticing that a fault ended while the page is open',
    expect: 'the fault set is re-derived while the page is open, and the memo cleared with it',
    apply: h => h.replace('setInterval(()=>{ if(disrSignature() !== _disrSig) applyDisruptionFeed(); }, 30000);', ''),
  },
  {
    name: 'leave the suspension memo stale when the feed changes',
    expect: 'the fault set is re-derived while the page is open, and the memo cleared with it',
    apply: h => h.replace('  clearTimingMemo();              // the suspension answer the router and the sim cache', ''),
  },
  {
    name: 'fatten the marking back over the line it marks',
    expect: 'the disruption marking is narrower than the line it marks',
    apply: h => h.replace('  const sw   = Math.max(1.3, core * 0.5);', '  const sw   = Math.max(1.3, core * 1.8);'),
  },
  {
    name: 'turn the soft wash back into a solid caution band',
    expect: 'the disruption marking is narrower than the line it marks',
    apply: h => h.replace('                              opacity:0.14, lineCap:', '                              opacity:0.95, lineCap:'),
  },
  {
    name: 'bring back the red-cased yellow caution band',
    expect: 'the opaque caution band does not come back',
    apply: h => h.replace('color:col, weight:core+5,', "color:'#F5C518', weight:core+5,"),
  },
  {
    name: 'clear a recovered line to no dash instead of its own',
    expect: 'a suspended line is dashed, and gets its own dash back',
    apply: h => h.replace('    const want = susp.has(o.ref) ? SUSP_DASH : o._normDash;',
      '    const want = susp.has(o.ref) ? SUSP_DASH : null;'),
  },
  {
    name: 'change the dash without repainting the canvas',
    expect: 'a suspended line is dashed, and gets its own dash back',
    apply: h => h.replace('    o.pl.redraw();          // canvas only repaints on its own when the weight changes', ''),
  },
  {
    name: 'stripe a suspended line end to end as well as dashing it',
    expect: 'a suspended line is dashed, and gets its own dash back',
    apply: h => h.replace('    const bands = suspended ? [] : disruptionPaths(d).filter(c=>c && c.length>=2);',
      '    const bands = disruptionPaths(d).filter(c=>c && c.length>=2);'),
  },
  // ---- ferry announcements, translated ----
  {
    name: 'put the old and new times the wrong way round in a ferry timetable change',
    expect: 'a ferry timetable change keeps every time on the right side of "instead of"',
    apply: h => h.replace("{ en:'$1 departure: $3 instead of $2',", "{ en:'$1 departure: $2 instead of $3',"),
  },
  {
    name: 'show a translation whose numbers differ from the original',
    expect: 'a translation whose numbers differ from the original is not shown',
    apply: h => h.replace('trNumbers(out) !== trNumbers(src)', 'false'),
  },
  {
    name: 'stop running the ferry templates for a ferry notice',
    expect: 'every ferry notice the templates cover reads in all three languages',
    apply: h => h.replace("const ferry = mode === 'ferry';", 'const ferry = false;'),
  },
  {
    name: 'run a ferry notice through the reorder pass that moves a "due to" across a full stop',
    expect: 'a season change and an event cancellation read as sentences',
    apply: h => h.replace('if(!ferry) for(const [re,rep] of (TR_REORDER[tgt]||[])) s = s.replace(re, rep);',
                          'for(const [re,rep] of (TR_REORDER[tgt]||[])) s = s.replace(re, rep);'),
  },
  {
    name: 'let a name capture run over the Arabic comma',
    expect: 'a name capture never reaches over Arabic punctuation',
    apply: h => h.replace(String.raw`[^\\s,;،؛]*\\s+)?[' + TR_FD_CAP + '][^\\s,;،؛]*)'`, String.raw`[^\\s,;]*\\s+)?[' + TR_FD_CAP + '][^\\s,;]*)'`),
  },
  {
    name: 'tell the translator nothing about what kind of notice it is translating',
    expect: 'the app translates a ferry notice with the ferry templates, and the scraper stores the same text',
    apply: h => h.replace('bestEffortTranslation(d.messageTr, disNames(d), lang, d.mode)', 'bestEffortTranslation(d.messageTr, disNames(d), lang)'),
  },
  {
    name: 'forget the electricity distributor behind a power cut',
    expect: 'a covered alert is translated into each language, not handed over in English',
    apply: h => h.replace(String.raw`/elektrik\s+dağıtım\s+kurumu\s+kaynaklı`, String.raw`/elektrik\s+dağıtımX\s+kurumu\s+kaynaklı`),
  },
  // ---- the app's own place search ----
  {
    name: 'ask the network for a typed destination without asking the offline file first',
    expect: 'the geocoder asks the offline file first and the network only to top up a thin answer',
    apply: h => h.replace('  const local = gazFind(q, 8);', '  const local = [];'),
  },
  {
    name: 'look places up online even when the user has turned that off',
    expect: 'turning online lookup off stops the network lookup, and is a switch in Settings in every language',
    apply: h => h.replace("  if(typeof onlineSearchPref !== 'undefined' && !onlineSearchPref) return [];", ''),
  },
  {
    name: 'rank a whole-name match below a longer name that starts with it',
    expect: 'the whole name outranks a longer name that merely starts with it',
    apply: h => h.replace('const GAZ_EXACT = 1000, GAZ_PREFIX_LO = 500,', 'const GAZ_EXACT = 100, GAZ_PREFIX_LO = 500,'),
  },
  {
    name: 'stop treating a type word on its own as "the nearest of those"',
    expect: 'a type word alone means "the nearest of those", in every language',
    apply: h => h.replace('    if (allType && T === 1 && tTypes[0][ti]) { consider(i, GAZ_TYPE, true); continue; }',
                          '    if (false && allType && T === 1 && tTypes[0][ti]) { consider(i, GAZ_TYPE, true); continue; }'),
  },
  {
    name: 'answer a district name with everything in that district',
    expect: 'a district is found by its name and comes before the streets and shops that carry it',
    apply: h => h.replace('    if (!ok || (nameWords === 0 && !typeUsed)) continue;', '    if (!ok) continue;'),
  },
  {
    name: 'hide a found place just for being near a stop in the planner',
    expect: 'the planner no longer hides a result just for being near a stop',
    apply: h => h.replace('    (foldQ(g.name).startsWith(foldQ(l.name)) && metersBetween([g.lat,g.lng],[l.lat,l.lng])<200)));',
                          '    metersBetween([g.lat,g.lng],[l.lat,l.lng])<200));'),
  },
  {
    name: 'run the typo pass even when a place already matches the name in full',
    expect: 'a query that already has a real match by name does not go looking for typos',
    apply: h => h.replace('if (top.length < 3 && !goodName && F.length >= 4 && !opt.noFuzzy) {', 'if (top.length < 3 && F.length >= 4 && !opt.noFuzzy) {'),
  },
  {
    name: 'let the letter-mask filter pass every word, so each typo scans the whole vocabulary with an edit distance',
    expect: 'the letter-mask filter never rules out a word that really is within the edit limit',
    apply: h => h.replace('return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }', 'return 0; }'),
  },
  {
    name: 'never join the words of a name to match a long word typed without spaces',
    expect: 'a name typed as one word is found, and ranks as the whole name when it is exactly that',
    apply: h => h.replace('if (!exactName && T === 1 && toks[0].length >= 6) {', 'if (false) {'),
  },
  {
    name: 'ask the public geocoder as well even when the file found the place',
    expect: 'the network is asked about a place only when the file found next to nothing, or when the query has a number',
    apply: h => h.replace('function gazThin(n, q) { return n < 2 || /\\d/.test(q); }', 'function gazThin(n, q) { return true; }'),
  },
  // ---- V4.0: names above the lines, fewer places, the new icon ----
  {
    name: 'put the names back under the metro lines, where a line hides the street or place beneath it',
    expect: 'the names are drawn above the metro lines and below the markers, and let every click through',
    apply: h => h.replace('map.createPane(VEC_LABEL_PANE).style.zIndex = 450;', 'map.createPane(VEC_LABEL_PANE).style.zIndex = 350;'),
  },
  {
    name: 'let the names pane swallow clicks meant for the lines and stations',
    expect: 'the names are drawn above the metro lines and below the markers, and let every click through',
    apply: h => h.replace("map.getPane(VEC_LABEL_PANE).style.pointerEvents = 'none';", ''),
  },
  {
    name: 'draw names in the lower map as well, so a name is hidden by a line again',
    expect: 'the names are drawn above the metro lines and below the markers, and let every click through',
    apply: h => h.replace("style: vecStyle(tone, lang, VEC_GLYPHS_ABS, 'base')", 'style: vecStyle(tone, lang, VEC_GLYPHS_ABS)'),
  },
  {
    name: 'draw every café on the map again',
    expect: 'the map names the places you asked for (visitors, worship, hospitals, police) and not the shops, food or hotels',
    apply: h => h.replace('hospital: [16, 15, 2], police: [16, 16, 0]', 'hospital: [16, 15, 2], police: [16, 16, 0], cafe: [17, 17, 0]'),
  },
  {
    name: 'point the browser tab at an icon that does not exist',
    expect: 'the page links the PNG icons, not the old inline picture, and the Apple icon is the right size',
    apply: h => h.replace('href="assets/favicon-32.png">', 'href="assets/favicon-33.png">'),
  },
  {
    name: 'point the top-bar mark at a picture that does not exist',
    expect: 'the mark inside the app (top bar and welcome dialog) is the new icon, not the old drawn "M"',
    apply: h => h.replace('<h1><img class="logo" src="assets/logo-96.png"', '<h1><img class="logo" src="assets/logo-69.png"'),
  },
  {
    name: 'tell chat apps the share card is a different size from the one that ships',
    expect: 'the preview card shown when the link is shared is 1200 x 630, matches the page\'s tags, and carries the new icon',
    apply: h => h.replace('og:image:width" content="1200"', 'og:image:width" content="1100"'),
  },
  // ---- V4.1: the loading screen ----
  {
    name: 'take away the CSS fallback that removes the loading screen after 12 s, so a stuck script leaves it over the app for good',
    expect: 'the loading screen can never be left covering the app: it sits above everything, fades out, and removes itself in CSS after 12 s',
    apply: h => h.replace('animation:bsGone .01s linear 12s forwards;', ''),
  },
  {
    name: 'put the loading screen under the map controls',
    expect: 'the loading screen can never be left covering the app: it sits above everything, fades out, and removes itself in CSS after 12 s',
    apply: h => h.replace('#bootSplash{position:fixed;inset:0;z-index:99999;', '#bootSplash{position:fixed;inset:0;z-index:5;'),
  },
  {
    name: 'let the faded-out loading screen keep catching touches',
    expect: 'the loading screen can never be left covering the app: it sits above everything, fades out, and removes itself in CSS after 12 s',
    apply: h => h.replace('#bootSplash.done{opacity:0;pointer-events:none;}', '#bootSplash.done{opacity:0;}'),
  },
  {
    name: 'start the loading screen on black again, a different colour from the one the phone shows before the page paints',
    expect: 'the colour the phone shows first (manifest) is the colour the page starts with, so nothing flashes between them',
    apply: h => h.replace('#bootSplash{position:fixed;inset:0;z-index:99999;background:#0E2A3F;', '#bootSplash{position:fixed;inset:0;z-index:99999;background:#000000;'),
  },
  {
    name: 'let the loading screen wait up to a minute for a map that never answers',
    expect: 'the script that does this is in the page the user receives',
    apply: h => h.replace('setTimeout(dismiss, 6000);', 'setTimeout(dismiss, 60000);'),
  },
  {
    name: 'drop the minimum time on the loading screen, so it flashes by on a fast connection',
    expect: 'the script that does this is in the page the user receives',
    apply: h => h.replace('Math.max(0, 700 - ', 'Math.max(0, 0 - '),
  },
  {
    name: 'stop preloading the loading screen\'s pictures, so it paints empty before they arrive',
    expect: 'the loading screen is the first thing in the page, is announced as a status, and its pictures are preloaded',
    apply: h => h.replace('<link rel="preload" as="image" href="assets/splash-bg.jpg">', ''),
  },
  {
    name: 'stop announcing the loading screen to a screen reader',
    expect: 'the loading screen is the first thing in the page, is announced as a status, and its pictures are preloaded',
    apply: h => h.replace('<div id="bootSplash" role="status" aria-label="Loading"', '<div id="bootSplash" aria-label="Loading"'),
  },
  // ---- V4.2: four bottom buttons, the back button, the warning bubble, buses, rotation ----
  {
    name: 'bring the Weather button back to the phone\'s bottom bar',
    expect: 'the phone has four bottom buttons - Map, Planner, Layers, Alerts - and no sheet of its own for the weather',
    apply: h => h.replace("['layers','◈','mLayers'], ['alerts','📢','mAlerts']", "['layers','◈','mLayers'], ['weather','☀','mWeather'], ['alerts','📢','mAlerts']"),
  },
  {
    name: 'put the weather card back in a sheet that no longer exists',
    expect: 'the weather card goes in the Layers sheet with the tab strip that selects it, and the layers card steps aside on every screen',
    apply: h => h.replace("if(el.id==='cardPlanner') mSheets.planner.appendChild(el);", "if(el.id==='cardPlanner') mSheets.planner.appendChild(el);\n    else if(el.id==='cardWeather') mSheets.weather.appendChild(el);"),
  },
  {
    name: 'let the warning sign open nothing but the old hover tooltip',
    expect: 'every way to open a warning pins the bubble, and a screen with no hover is not given a hover tooltip that vanishes',
    apply: h => h.replace("mk.on('click', ()=>{ mk.closeTooltip(); pinDisr(d, p, isz/2 + 4); openDisruption(d); });", "mk.on('click', ()=> openDisruption(d));"),
  },
  {
    name: 'give a phone a hover tooltip',
    expect: 'every way to open a warning pins the bubble, and a screen with no hover is not given a hover tooltip that vanishes',
    apply: h => h.replace("const CAN_HOVER = matchMedia('(hover:hover)').matches;", "const CAN_HOVER = true;"),
  },
  {
    name: 'close the bubble only on clicks that reach the page, so the zoom buttons leave it open',
    expect: 'it stays through a drag and a fly (neither is a click) and goes on the next press, a click anywhere, or Escape',
    apply: h => h.replace("document.addEventListener('click', unpinDisr, true);", "document.addEventListener('click', unpinDisr, false);"),
  },
  {
    name: 'make the bubble close itself like a hover tooltip',
    expect: 'pressing a warning sign opens a bubble that is its own layer on the map, holding the notice and the way to close it',
    apply: h => h.replace("pinnedDisr = L.tooltip({ permanent:true,", "pinnedDisr = L.tooltip({ permanent:false,"),
  },
  {
    name: 'leave the bubble up when the person switches to another scope',
    expect: 'the bubble is cleared when the scope changes or the notices are refreshed, and its text exists in all four languages',
    apply: h => h.replace('unpinDisr();                // an open warning bubble belongs to the scope it was opened on', ''),
  },
  {
    name: 'forget which sheet a panel came from, so back from the panel goes straight to the map',
    expect: 'the user\'s own example: from a line\'s panel opened out of the Layers sheet, back is the Layers sheet and back again is the map',
    apply: h => h.replace("if(l.id !== 'sheet' && goneSheet) e.returnTo = goneSheet;", ''),
  },
  {
    name: 'let back press close nothing',
    expect: 'back closes the newest layer only: a station panel over Settings goes first, Settings second',
    apply: h => h.replace('NAV.depth--; navCloseEntry(last); }', 'NAV.depth--; }'),
  },
  {
    name: 'leave the history entry of a panel behind when it is closed with its own button',
    expect: 'opening something puts one entry in the history, and closing it with its own button takes the entry away again',
    apply: h => h.replace('history.go(delta);', ''),
  },
  {
    name: 'treat an entry from an earlier visit as a press to close something',
    expect: 'entries left by an earlier visit are stepped over, and a forward press is undone, instead of closing something',
    apply: h => h.replace('if(st.d > NAV.depth){ history.back(); return; }', ''),
  },
  {
    name: 'let back change the map\'s scope no further than the sheet it was chosen in',
    expect: 'switching scope inside the Layers sheet is a step: back returns to the scope you came from, then closes the sheet',
    apply: h => h.replace('try{ setTab(e.from); }finally', 'try{ void 0; }finally'),
  },
  {
    name: 'make a scope change from the map a step in the history',
    expect: 'a scope change made from the map (no sheet open on a phone) is not a step, and closing the sheet drops its scope steps without undoing them',
    apply: h => h.replace("if(IS_MOBILE && !navHas('sheet_layers','open')) return;", ''),
  },
  {
    name: 'react to any popstate, so a link to #something closes the panel that is open',
    expect: 'a \\#link (a popstate that carries no state of ours) leaves everything open',
    apply: h => h.replace('if(!st || !st.irnNav) return;', ''),
  },
  {
    name: "draw both directions on the very same line again",
    expect: "both directions are drawn: an edge under each, then the two coloured lines, never one line over the other",
    apply: h => h.replace('P: busOffset(base, off), col:', 'P: base, col:'),
  },
  {
    name: "dash the return line, as it was when it hid the going line",
    expect: "both directions are drawn: an edge under each, then the two coloured lines, never one line over the other",
    apply: h => h.replace("{ color:r.col, weight:w, opacity:r.dim ? 0.3 : 0.98, lineCap:'round', lineJoin:'round' }", "{ color:r.col, weight:w, opacity:r.dim ? 0.3 : 0.98, lineCap:'round', lineJoin:'round', dashArray:r.di ? '9,6' : null }"),
  },
  {
    name: "put each direction on the LEFT of its travel",
    expect: "each direction is shifted to the RIGHT of its own travel, so the two directions of one street end up on opposite sides",
    apply: h => h.replace('N.push([-dy / l, dx / l]);', 'N.push([dy / l, -dx / l]);'),
  },
  {
    name: "point the arrowheads backwards",
    expect: "arrowheads point the way the bus goes, are spaced evenly, and are only made where they will be seen",
    apply: h => h.replace('out.push([L.point(cx + hx * alen * 0.6, cy + hy * alen * 0.6),', 'out.push([L.point(cx - hx * alen * 0.6, cy - hy * alen * 0.6),'),
  },
  {
    name: "make arrowheads for stretches nobody can see",
    expect: "arrowheads point the way the bus goes, are spaced evenly, and are only made where they will be seen",
    apply: h => h.replace('if(!out_ && cx >= vb.min.x && cx <= vb.max.x && cy >= vb.min.y && cy <= vb.max.y){', 'if(true){'),
  },
  {
    name: "draw arrowheads at city scale",
    expect: "zoomed out, only where each direction starts and ends is marked; zoomed in, every stop and the arrowheads",
    apply: h => h.replace('if(z >= 12) rows.forEach(r => {', 'if(z >= 5) rows.forEach(r => {'),
  },
  {
    name: "mark every stop on a whole-city view",
    expect: "zoomed out, only where each direction starts and ends is marked; zoomed in, every stop and the arrowheads",
    apply: h => h.replace('if(z < 12 && !end) return;', ''),
  },
  {
    name: "rebuild the two lines on every pan",
    expect: "the route is redrawn when the zoom changes (the gap between the lines is a number of screen pixels) and only the near arrowheads are redrawn when it moves",
    apply: h => h.replace('if(busDraw.key !== key){', 'if(true){'),
  },
  {
    name: "never fade the direction that was not chosen",
    expect: "showing one direction fades the other, drops its arrows and stops, and says so in the control",
    apply: h => h.replace("r.dim = view !== 'both' && view !== r.di;", 'r.dim = false;'),
  },
  {
    name: "offer a direction control for a one-way route",
    expect: "showing one direction fades the other, drops its arrows and stops, and says so in the control",
    apply: h => h.replace("if(!dirs || dirs.length < 2) return '';", "if(!dirs) return '';"),
  },
  {
    name: "let a search match a setting that has only SOME of the words typed",
    expect: "several words must all be present, and nothing found says so",
    apply: h => h.replace('return words.every(w => text.includes(w)); })();', 'return words.some(w => text.includes(w)); })();'),
  },
  {
    name: "leave sections as the search left them when it is cleared",
    expect: "clearing the search puts every section back as it was (open ones open, closed ones closed)",
    apply: h => h.replace('if(!on && before){ secs.forEach((d, i) => { d.open = before[i]; }); before = null; }', ''),
  },
  {
    name: "remember sections that a search opened",
    expect: "a section left open or closed stays that way, but a search opening sections is not remembered",
    apply: h => h.replace("if(panel.classList.contains('sp-searching')) return; try{", 'try{'),
  },
  {
    name: "search without folding capitals and the Turkish dotted I",
    expect: "typing finds a setting by what it says, opens the section it is in, and hides everything else",
    apply: h => h.replace('const q = foldQ(inp.value.trim()), on', 'const q = inp.value.trim(), on'),
  },
  {
    name: "keep what was typed in the search box when Settings is opened again",
    expect: "opening Settings again starts with an empty search box, and the reset is called from there",
    apply: h => h.replace('  spReset();     // 02a-settings-ui.js: start with nothing typed in the search box', ''),
  },
  {
    name: "put a full-screen blur behind the settings sheet on a phone",
    expect: "the sheet is light on a phone: no full-screen blur behind it, and a scroll in it does not scroll the map",
    apply: h => h.replace('body.mobile .settings-overlay{backdrop-filter:none;', 'body.mobile .settings-overlay{'),
  },
  {
    name: "lose the step-free switch in the move",
    expect: "no setting was lost in the move: every control the app looks for is there once, and inside a section",
    apply: h => h.replace('id="swStepFree"', 'id="swStepFree2"'),
  },
  {
    name: "open every section at the start",
    expect: "settings are eight sections, in this order, with Appearance open to begin with",
    apply: h => h.replace('<details class="sp-sec" data-sec="journey">', '<details class="sp-sec" data-sec="journey" open>'),
  },
  {
    name: "redraw every panel in the new language before the language button has been drawn",
    expect: "a press on a setting lights its button at once and does the heavy part (the other base map, every panel in the new language) after the browser has painted",
    apply: h => h.replace('later ? afterPaint(relocalise) : relocalise();', 'relocalise();'),
  },
  {
    name: "swap the base map before the theme button has been drawn",
    expect: "a press on a setting lights its button at once and does the heavy part (the other base map, every panel in the new language) after the browser has painted",
    apply: h => h.replace('applyTheme(b.dataset.theme, true, true)', 'applyTheme(b.dataset.theme, true)'),
  },
  {
    name: "wait for a frame that never comes (a hidden tab) before doing the work",
    expect: "afterPaint runs its work once, after a frame, and still runs it if no frame is ever produced",
    apply: h => h.replace('requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 150);', 'requestAnimationFrame(() => setTimeout(go, 0));'),
  },
  {
    name: "make controls wait to see whether a second tap is coming",
    expect: "controls answer a press at once: no double-tap-zoom wait on buttons, switches and the section headers",
    apply: h => h.replace('button,summary,select,.switch,.seg{touch-action:manipulation;}', ''),
  },
  {
    name: "turn the screen the wrong way when going from screen pixels to layer pixels",
    expect: "screen and layer pixels convert both ways at every angle, with the map panned",
    apply: h => h.replace("return turn(L.point(point).subtract(this._getMapPanePos()).subtract(c), -a).add(c);", "return turn(L.point(point).subtract(this._getMapPanePos()).subtract(c), a).add(c);"),
  },
  {
    name: "leave the pane's pan unturned when the map turns, so the middle of the screen drifts",
    expect: "the pan of the map pane turns with the map, so the middle of the screen does not drift",
    apply: h => h.replace("if(this._loaded && (pos.x || pos.y)) L.DomUtil.setPosition(this._mapPane, turn(pos, a - was));", ""),
  },
  {
    name: "work out the pixel origin as if the pane's pan were not turned",
    expect: "after a move the new centre is in the middle of the screen, at any angle and pan",
    apply: h => h.replace("._add(turn(this._getMapPanePos(), -a))._round();", "._add(this._getMapPanePos())._round();"),
  },
  {
    name: "load tiles for an upright screen while the map is turned",
    expect: "the box of tiles to load holds the whole turned screen, and swaps its sides at a right angle",
    apply: h => h.replace("return L.bounds(corners);", "return mapOrig.getPixelBounds.call(this, center, zoom);"),
  },
  {
    name: "fit bounds as if the screen were not turned",
    expect: "fitting bounds into a turned screen measures them as the turned screen sees them",
    apply: h => h.replace("const a = this._irnTheta; if(!a) return mapOrig.getBoundsZoom.call(this, bounds, inside, padding);", "const a = this._irnTheta; return mapOrig.getBoundsZoom.call(this, bounds, inside, padding);"),
  },
  {
    name: "make the canvases too small to hold a turned screen",
    expect: "the line and station canvases are one square that holds the screen at EVERY angle, so turning never redraws them",
    apply: h => h.replace("side = Math.ceil(Math.hypot(size.x, size.y) + 0.4 * Math.max(size.x, size.y))", "side = Math.ceil(Math.hypot(size.x, size.y) * 0.6)"),
  },
  {
    name: "move a canvas when nothing has moved",
    expect: "a canvas that is not moved or zoomed stays exactly where it is (the transform offset is its own top-left)",
    apply: h => h.replace("const scale = map.getZoomScale(zoom, this._zoom), half = this._bounds.getSize().multiplyBy(0.5);", "const scale = map.getZoomScale(zoom, this._zoom), half = map.getSize().multiplyBy(0.5 + this.options.padding);"),
  },
  {
    name: "put a pane made later outside the rotor, so it does not turn",
    expect: "everything Leaflet draws sits under a rotor that is turned about the middle of the screen, and a pane made later goes under it too",
    apply: h => h.replace("if(this._irnRotor && !container && name !== 'mapPane') container = this._irnRotor;", ""),
  },
  {
    name: "tell markers to turn back the wrong way",
    expect: "everything Leaflet draws sits under a rotor that is turned about the middle of the screen, and a pane made later goes under it too",
    apply: h => h.replace("rotor.style.setProperty('--irn-up', (-this._irnTheta) + 'rad');", "rotor.style.setProperty('--irn-up', (this._irnTheta) + 'rad');"),
  },
  {
    name: "turn a marker back about its corner instead of the place it points at",
    expect: "markers, tooltips and popups turn back about the place they point at, by one CSS variable, so a turn costs one write",
    apply: h => h.replace("upright(icon, -(parseFloat(icon.style.marginLeft) || 0), -(parseFloat(icon.style.marginTop) || 0));", "upright(icon, 0, 0);"),
  },
  {
    name: "turn a tooltip back about its corner instead of the place it points at",
    expect: "markers, tooltips and popups turn back about the place they point at, by one CSS variable, so a turn costs one write",
    apply: h => h.replace("upright(this._container, pos.x - at.x, pos.y - at.y);", "upright(this._container, 0, 0);"),
  },
  {
    name: "give MapLibre the angle with the wrong sign",
    expect: "the base map is told the angle (MapLibre turns the other way round) and its box is centred on the screen and turned back to upright",
    apply: h => h.replace("gl.transform.bearing = bearingOf(this._map); },", "gl.transform.bearing = -bearingOf(this._map); },"),
  },
  {
    name: "leave the base map's box turned with the map instead of turning it back",
    expect: "the base map is told the angle (MapLibre turns the other way round) and its box is centred on the screen and turned back to upright",
    apply: h => h.replace("rotate(' + (-this._map._irnTheta) + 'rad) scale('", "rotate(' + (this._map._irnTheta) + 'rad) scale('"),
  },
  {
    name: "let any wobble of two fingers turn the map",
    expect: "two fingers: a wobble of a few degrees does not turn the map, but zoom and the place under the fingers still follow",
    apply: h => h.replace("const TURN_START_DEG = 7;", "const TURN_START_DEG = 0.01;"),
  },
  {
    name: "put the place under the fingers back without allowing for the angle",
    expect: "two fingers: a clear twist turns the map from the end of the wobble (no jump), and the place under the fingers stays under them",
    apply: h => h.replace("MAP_TURN.turn(mid.subtract(c), -a)", "mid.subtract(c)"),
  },
  {
    name: "let the twist jump when the angle wraps past the half-turn",
    expect: "two fingers: a wobble that happens to straddle the half-turn is still a wobble",
    apply: h => h.replace("if(d > Math.PI) d -= 2 * Math.PI; else if(d < -Math.PI) d += 2 * Math.PI;", ""),
  },
  {
    name: "turn the map with two fingers although the person switched turning off",
    expect: "two fingers do not turn the map when the person has switched turning off, but still zoom it",
    apply: h => h.replace("if(map.options.irnTurn && turnAllowed(map)){", "if(map.options.irnTurn){"),
  },
  {
    name: "take a plain left-button drag from Leaflet",
    expect: "mouse: right-drag (or Ctrl + drag) sideways turns the map, a plain drag is left to Leaflet",
    apply: h => h.replace("(e.button === 2 || (e.button === 0 && e.ctrlKey))", "(e.button === 2 || e.button === 0)"),
  },
  {
    name: "turn on any wheel, not only Shift + wheel",
    expect: "wheel: Shift + wheel turns the map and is kept from zooming it; a plain wheel is left alone",
    apply: h => h.replace("if(!e.shiftKey || !turnAllowed(map)) return;", "if(!turnAllowed(map)) return;"),
  },
  {
    name: "turn on Shift + arrow with the other modifiers, or without Shift",
    expect: "keys: Shift + left/right turn by 15 degrees and are kept from panning Leaflet three times as far; other keys are left alone",
    apply: h => h.replace("if(!turnAllowed(map) || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;", "if(!turnAllowed(map) || e.altKey || e.ctrlKey || e.metaKey) return;"),
  },
  {
    name: "turn the long way round",
    expect: "turning the short way round: 350 to 10 is 20 degrees, not 340; and within 5 degrees of north the map settles onto it",
    apply: h => h.replace("diff = ((deg - from + 540) % 360) - 180;", "diff = deg - from;"),
  },
  {
    name: "leave Leaflet's own two-finger zoom on beside ours",
    expect: "the page makes a map that can be turned (unless the person switched it off), by our own two-finger handler, with a compass",
    apply: h => h.replace("touchZoom:!TURNABLE && L.Browser.touch", "touchZoom:L.Browser.touch"),
  },
  // ---- how old the rail and ferry notices are ----
  {
    name: 'never call the notices out of date, however long since the page was read',
    expect: '"may be out of date" starts at eight hours, not before',
    apply: h => h.replace('const ANN_STALE_MIN = 8 * 60;', 'const ANN_STALE_MIN = 8 * 60 * 1000;'),
  },
  {
    name: 'let the age go negative when the device clock is behind the file',
    expect: 'the age is whole minutes, never negative, and unknown when there is nothing to go on',
    apply: h => h.replace('const mins = Math.max(0, Math.round((nowMs - checkedMs) / 60000));', 'const mins = Math.round((nowMs - checkedMs) / 60000);'),
  },
  {
    name: 'fetch the notices once at start and never again, so a tab left open keeps an age that only grows',
    expect: 'the page fetches the status with the notices, and keeps fetching while the tab is in use',
    apply: h => h.replace('if(HAS.disruptions) setInterval(() => { if(!document.hidden) loadLiveDisruptions(); }, 10 * 60 * 1000);', ''),
  },
  {
    name: 'grey every announcement when the feed is stale, the live bus group and the opening cards included',
    expect: 'a stale feed shows a warning and greys the rail and ferry rows, but not the bus group or the opening cards',
    apply: h => h.replace('.ann-body.ann-stale > .ann-item[data-id]{opacity:', '.ann-body.ann-stale .ann-item{opacity:'),
  },
  // ---- the vector map ----
  {
    name: 'draw every name with no outline, so a street name vanishes into the road beneath it',
    expect: 'every name has a halo and enough contrast to read, by night and by day',
    apply: h => h.replace("'text-halo-width': hw == null ? 1.7 : hw,", "'text-halo-width': 0,"),
  },
  {
    name: 'keep neighbourhood names the same size however far you zoom in',
    expect: 'names grow as you zoom in',
    apply: h => h.replace("[[11.5, 11], [13, 12.5], [15, 15], [17, 19], [19, 24]]", "[[11.5, 11], [19, 11]]"),
  },
  {
    name: 'show English names to everyone, whatever language the app is in',
    expect: 'names follow the interface language, falling back to the local name',
    apply: h => h.replace("return lang === 'en' ? ['coalesce', ['get', 'name_en']", "return true ? ['coalesce', ['get', 'name_en']"),
  },
  {
    name: 'leave a map that cannot load its tiles blank instead of switching to the raster map',
    expect: 'a device that cannot draw it, or a tile service that cannot be reached, gets the raster map',
    apply: h => h.replace("if (!ready && errors > 0 && self._map && typeof vecFallback === 'function') vecFallback(self._key);", "if (!ready && false && self._map && typeof vecFallback === 'function') vecFallback(self._key);"),
  },
  {
    name: 'save an area for offline use at a raster address when the vector map is showing',
    expect: '"save this area" asks for the tile the vector map will really ask for, once',
    apply: h => h.replace('    if(lyr && lyr._glMap) return offVectorURL(z,x,y);', ''),
  },
  {
    name: 'save offline tiles six at a time from a service that allows four',
    expect: '"save this area" asks for the tile the vector map will really ask for, once',
    apply: h => h.replace('  const CONC = vec ? 4 : 6;', '  const CONC = 6;'),
  },
];

const original = fs.readFileSync(SRC, 'utf8');
let caughtCount = 0;
const problems = [];

console.log('Mutation check - each row must FAIL the named test.\n');

for (const m of MUTATIONS) {
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log('  ??  ' + m.name);
    console.log('      SKIPPED - the anchor no longer exists in index.html; update the mutation.');
    problems.push(m.name + ' (stale anchor)');
    continue;
  }
  fs.writeFileSync(TMP, mutated);

  let out = '';
  try {
    out = execFileSync(process.execPath, ['--test', ...SUITES], {
      cwd: ROOT,
      env: { ...process.env, RAYNET_HTML: TMP },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      /* execFileSync buffers 1MB by default. A mutation that breaks the whole script fails most
         of the suite at once, and each failure carries a TAP diagnostic block with a stack — at
         93 tests that runs past 1MB, execFileSync throws ENOBUFS, and the truncated stdout no
         longer contains the "not ok" line we are looking for. Five catastrophic mutations
         reported themselves UNCAUGHT for exactly that reason: the suite was working and the
         instrument reading it was not. A verification tool that under-reports as the suite
         grows is worse than none. */
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    // A non-zero exit is the NORMAL case here: the suite is supposed to fail. Losing the output
    // is not, and it looks identical to "not caught" unless we say so.
    if (e.code === 'ENOBUFS' || /maxBuffer/i.test(String(e.message || ''))) {
      console.log('  ??  ' + m.name);
      console.log('      UNREADABLE - the suite\'s output overran the buffer, so this row proves nothing.');
      problems.push(m.name + ' (output truncated)');
      continue;
    }
  }

  const escaped = m.expect.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
  const caught = new RegExp('^not ok \\d+ - ' + escaped, 'm').test(out);
  if (caught) {
    console.log('  ok  ' + m.name);
    console.log('      caught by: "' + m.expect + '"');
    caughtCount++;
  } else {
    console.log('  !!  ' + m.name);
    console.log('      expected "' + m.expect + '" to fail, but the suite stayed green');
    problems.push(m.name + ' (not caught)');
  }
}

try { fs.unlinkSync(TMP); } catch { /* best effort */ }

console.log('\n' + caughtCount + '/' + MUTATIONS.length + ' defects caught');
if (problems.length) {
  console.log('unresolved:\n  - ' + problems.join('\n  - '));
}
process.exit(problems.length ? 1 : 0);
