'use strict';
/* The words of the legal pages (V4.3): privacy notice, terms of use, cookies & stored data, credits - in English and Turkish.
 *
 * Two lists here are CHECKED AGAINST THE CODE by test/legal.test.cjs, so the pages cannot drift from what the app does:
 *   HOSTS    every host the app can contact (the connect-src and img-src hosts of the page's own security policy) must be named,
 *   STORAGE  every localStorage key the app source writes must have a row.
 * Nothing here is legal advice, and the pages say so. Written plainly on purpose.
 */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ul = items => '<ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
const p = s => '<p>' + s + '</p>';
const table = (head, rows) => '<div class="tw"><table><thead><tr>' + head.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' +
  rows.map(r => '<tr>' + r.map((c, i) => (i === 0 ? '<th scope="row">' : '<td>') + c + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</tbody></table></div>';
const a = (href, text) => '<a href="' + esc(href) + '" rel="noopener">' + text + '</a>';
const code = s => '<code>' + esc(s) + '</code>';

/* ---- every host the app talks to ------------------------------------------------------------------------------------- */
const HOSTS = [
  { hosts: ['hero4mohamed.github.io'], name: 'GitHub Pages', url: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
    en: { when: 'Every time you open the app: it serves the page, its scripts, typefaces and data files, and these legal pages.',
          sees: 'Your IP address and browser details, as any web host sees them. To the author\'s knowledge GitHub does not pass its server logs to the owner of a site.' },
    tr: { when: 'Uygulamayı her açtığınızda: sayfayı, betikleri, yazı tiplerini, veri dosyalarını ve bu yasal sayfaları sunar.',
          sees: 'Her web sunucusunun gördüğü gibi IP adresinizi ve tarayıcı bilgilerinizi. Yazarın bildiği kadarıyla GitHub, sunucu kayıtlarını site sahibine iletmez.' } },
  { hosts: ['tiles.openfreemap.org'], name: 'OpenFreeMap', url: 'https://openfreemap.org/privacy/',
    en: { when: 'Whenever the street map is on screen (the default map): map tiles for the area you are looking at, and a small index naming the current map version.',
          sees: 'Your IP address, browser details and which map tiles you load, which is roughly the area you are looking at.' },
    tr: { when: 'Sokak haritası ekrandayken (varsayılan harita): baktığınız bölgenin harita karoları ve güncel harita sürümünü bildiren küçük bir dizin.',
          sees: 'IP adresinizi, tarayıcı bilgilerinizi ve hangi harita karolarını yüklediğinizi; yani kabaca baktığınız bölgeyi.' } },
  { hosts: ['server.arcgisonline.com'], name: 'Esri', url: 'https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement',
    en: { when: 'When you switch on the satellite layer, and as the backup street map if your device cannot draw the default map.',
          sees: 'Your IP address, browser details and which map tiles you load, which is roughly the area you are looking at.' },
    tr: { when: 'Uydu katmanını açtığınızda ve cihazınız varsayılan haritayı çizemiyorsa yedek sokak haritası olarak.',
          sees: 'IP adresinizi, tarayıcı bilgilerinizi ve hangi harita karolarını yüklediğinizi; yani kabaca baktığınız bölgeyi.' } },
  { hosts: ['api.ibb.gov.tr'], name: 'İBB Open Data (İstanbul Metropolitan Municipality)', url: 'https://data.ibb.gov.tr',
    en: { when: 'When you open a Metro İstanbul station (its official timetable is requested) and when the Announcements panel loads İETT bus notices.',
          sees: 'For a timetable, the identifier of the station you opened (so, which station you looked at), plus your IP address and browser details. The bus-notices request carries nothing about you.' },
    tr: { when: 'Bir Metro İstanbul istasyonunu açtığınızda (resmî sefer saatleri istenir) ve Duyurular paneli İETT otobüs duyurularını yüklediğinde.',
          sees: 'Sefer saatleri için açtığınız istasyonun kimliğini (yani hangi istasyona baktığınızı), IP adresinizi ve tarayıcı bilgilerinizi. Otobüs duyuruları isteği sizinle ilgili hiçbir şey taşımaz.' } },
  { hosts: ['api.open-meteo.com', 'air-quality-api.open-meteo.com'], name: 'Open-Meteo', url: 'https://open-meteo.com/en/terms',
    en: { when: 'When you open the Weather tab, and each time it refreshes.',
          sees: 'The coordinates of the city centre and of its districts (not your own position), plus your IP address and browser details.' },
    tr: { when: 'Hava Durumu sekmesini açtığınızda ve her yenilendiğinde.',
          sees: 'Şehir merkezinin ve ilçelerinin koordinatlarını (kendi konumunuzu değil), IP adresinizi ve tarayıcı bilgilerinizi.' } },
  { hosts: ['overpass-api.de'], name: 'Overpass API (an OpenStreetMap data service)', url: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    en: { when: 'When you open a bus or intercity route whose road shape is not already stored in the app.',
          sees: 'The line number or route identifier you opened, plus your IP address and browser details.' },
    tr: { when: 'Yol şekli uygulamada kayıtlı olmayan bir otobüs veya şehirlerarası hattı açtığınızda.',
          sees: 'Açtığınız hat numarasını veya hat kimliğini, IP adresinizi ve tarayıcı bilgilerinizi.' } },
  { hosts: ['photon.komoot.io'], name: 'Photon (run by komoot)', url: 'https://www.komoot.com/privacy', optional: true,
    en: { when: 'Only if you have allowed online look-ups: when you type in a search box and the places list stored on your device finds too little, and for "what is near here" questions.',
          sees: 'The text you typed together with the city centre. For nearby searches, the coordinates searched around, which is your own position if you asked for "near me". Plus your IP address and browser details.' },
    tr: { when: 'Yalnızca çevrimiçi aramalara izin verdiyseniz: bir arama kutusuna yazdığınızda ve cihazınızdaki yer listesi yeterince sonuç bulamadığında, ayrıca "yakınımda ne var" sorularında.',
          sees: 'Yazdığınız metni şehir merkeziyle birlikte. Yakın çevre aramalarında, çevresinde arama yapılan koordinatları; "yakınımda" dediyseniz bu sizin kendi konumunuzdur. Ayrıca IP adresinizi ve tarayıcı bilgilerinizi.' } },
  { hosts: ['routing.openstreetmap.de'], name: 'OSRM routing server (run by FOSSGIS)', url: 'https://routing.openstreetmap.de/', optional: true,
    en: { when: 'Only if you have allowed online look-ups: when a planned journey is refined so that its walking parts follow real streets.',
          sees: 'The start and end point of each walking part: places you typed or tapped, or your own position if you started from "my location". Plus your IP address and browser details.' },
    tr: { when: 'Yalnızca çevrimiçi aramalara izin verdiyseniz: planlanan bir yolculuğun yürüyüş bölümleri gerçek sokakları izlesin diye.',
          sees: 'Her yürüyüş bölümünün başlangıç ve bitiş noktasını: yazdığınız ya da dokunduğunuz yerleri, "konumum"dan başladıysanız kendi konumunuzu. Ayrıca IP adresinizi ve tarayıcı bilgilerinizi.' } },
  { hosts: ['api.anthropic.com'], name: 'Anthropic (Claude)', url: 'https://www.anthropic.com/legal/privacy', optional: true,
    en: { when: 'Only if you paste your own API key into Settings > Assistant AI: when you ask the Assistant a question.',
          sees: 'The question you typed, your key (so Anthropic can tell it is you) and your IP address. Anthropic\'s terms for your own account apply.' },
    tr: { when: 'Yalnızca Ayarlar > Asistan yapay zekâsına kendi API anahtarınızı yapıştırdıysanız: Asistan\'a soru sorduğunuzda.',
          sees: 'Yazdığınız soruyu, anahtarınızı (Anthropic sizin olduğunuzu anlasın diye) ve IP adresinizi. Kendi hesabınız için Anthropic\'in koşulları geçerlidir.' } },
];

/* ---- every key the app writes to localStorage -------------------------------------------------------------------------- */
const STORAGE = [
  { key: 'irn_lang', en: 'The language you picked.', tr: 'Seçtiğiniz dil.', when: 'You change the language.' , whenTr: 'Dili değiştirdiğinizde.' },
  { key: 'irn_theme', en: 'Theme: dark, light, automatic or mixed.', tr: 'Tema: koyu, açık, otomatik veya karma.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_uistyle', en: 'Icon and colour style.', tr: 'Simge ve renk stili.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_textsize', en: 'Larger text on or off.', tr: 'Büyük yazı açık/kapalı.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_motion', en: 'Reduced motion on or off.', tr: 'Hareketi azalt açık/kapalı.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_contrast', en: 'High contrast on or off.', tr: 'Yüksek karşıtlık açık/kapalı.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_units', en: 'Metric or imperial units.', tr: 'Metrik veya İngiliz (imperial) birimleri.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_clock', en: '12-hour or 24-hour clock.', tr: '12 veya 24 saatlik saat.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_walk', en: 'Your walking pace (slow, normal, fast).', tr: 'Yürüyüş hızınız (yavaş, normal, hızlı).', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_avoid', en: 'Modes of transport you chose to avoid.', tr: 'Kaçınmayı seçtiğiniz ulaşım türleri.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_stepfree', en: 'Prefer step-free routes on or off.', tr: 'Merdivensiz rotaları tercih et açık/kapalı.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_routePref', en: 'Whether the planner prefers the fastest route or the fewest changes.', tr: 'Planlayıcının en hızlı rotayı mı en az aktarmayı mı seçtiği.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_planmode', en: 'Which planner tab you last used.', tr: 'Planlayıcıda en son kullandığınız sekme.', when: 'You switch tab.', whenTr: 'Sekme değiştirdiğinizde.' },
  { key: 'irn_farecard', en: 'The fare card you chose, used to estimate fares.', tr: 'Ücret tahmini için seçtiğiniz kart.', when: 'You pick a card.', whenTr: 'Kart seçtiğinizde.' },
  { key: 'irn_turn', en: 'Whether the map may be turned (rotated).', tr: 'Haritanın döndürülüp döndürülemeyeceği.', when: 'You change it.', whenTr: 'Değiştirdiğinizde.' },
  { key: 'irn_city', en: 'The city you last looked at.', tr: 'En son baktığınız şehir.', when: 'You switch city.', whenTr: 'Şehir değiştirdiğinizde.' },
  { key: 'irn_layers', en: 'Whether the layers panel is open.', tr: 'Katmanlar panelinin açık olup olmadığı.', when: 'You open or close it.', whenTr: 'Açıp kapattığınızda.' },
  { key: 'irn_planner', en: 'Whether the planner panel is open.', tr: 'Planlayıcı panelinin açık olup olmadığı.', when: 'You open or close it.', whenTr: 'Açıp kapattığınızda.' },
  { key: 'irn_lyr_*', en: 'Which map layers you switched on or off (one entry per layer).', tr: 'Hangi harita katmanlarını açıp kapattığınız (katman başına bir kayıt).', when: 'You switch a layer.', whenTr: 'Bir katmanı değiştirdiğinizde.' },
  { key: 'irn_sec_*', en: 'Which sections of Settings you left open (one entry per section).', tr: 'Ayarlar\'ın hangi bölümlerini açık bıraktığınız (bölüm başına bir kayıt).', when: 'You open or close a section.', whenTr: 'Bir bölümü açıp kapattığınızda.' },
  { key: 'irn_welcomed', en: 'That you have seen the welcome dialog.', tr: 'Karşılama penceresini gördüğünüz.', when: 'You close the dialog.', whenTr: 'Pencereyi kapattığınızda.' },
  { key: 'irn_online', en: 'Your choice about online look-ups (on or off).', tr: 'Çevrimiçi aramalar konusundaki seçiminiz (açık/kapalı).', when: 'You answer the privacy notice or use the switch.', whenTr: 'Gizlilik bildirimini yanıtladığınızda veya anahtarı kullandığınızda.' },
  { key: 'irn_privacy', en: 'Which version of the privacy notice you answered, so you are not asked again.', tr: 'Hangi sürüm gizlilik bildirimini yanıtladığınız; böylece tekrar sorulmaz.', when: 'You answer the notice.', whenTr: 'Bildirimi yanıtladığınızda.' },
  { key: 'irn_home', en: 'Your Home place: its name and coordinates.', tr: 'Ev yeriniz: adı ve koordinatları.', when: 'You set it. Personal.', whenTr: 'Siz ayarladığınızda. Kişisel.', personal: true },
  { key: 'irn_work', en: 'Your Work place: its name and coordinates.', tr: 'İş yeriniz: adı ve koordinatları.', when: 'You set it. Personal.', whenTr: 'Siz ayarladığınızda. Kişisel.', personal: true },
  { key: 'irn_history', en: 'Your recent planned journeys (from, to, time).', tr: 'Son planladığınız yolculuklar (nereden, nereye, saat).', when: 'You plan a journey. Personal.', whenTr: 'Yolculuk planladığınızda. Kişisel.', personal: true },
  { key: 'irn_favourites', en: 'The journeys you starred.', tr: 'Yıldızladığınız yolculuklar.', when: 'You star a journey. Personal.', whenTr: 'Bir yolculuğu yıldızladığınızda. Kişisel.', personal: true },
  { key: 'irn_advfavs', en: 'The places you starred in Explore.', tr: 'Keşfet\'te yıldızladığınız yerler.', when: 'You star a place. Personal.', whenTr: 'Bir yeri yıldızladığınızda. Kişisel.', personal: true },
  { key: 'irn_recent', en: 'Your last few searches.', tr: 'Son birkaç aramanız.', when: 'You search. Personal.', whenTr: 'Arama yaptığınızda. Kişisel.', personal: true },
  { key: 'irn_trips', en: 'The count of journeys in your travel passport.', tr: 'Seyahat pasaportunuzdaki yolculuk sayısı.', when: 'You finish a live journey.', whenTr: 'Canlı bir yolculuğu bitirdiğinizde.' },
  { key: 'irn_ridden', en: 'The lines you have ridden, for the travel passport.', tr: 'Seyahat pasaportu için bindiğiniz hatlar.', when: 'You finish a live journey.', whenTr: 'Canlı bir yolculuğu bitirdiğinizde.' },
  { key: 'irn_km', en: 'Kilometres in your travel passport.', tr: 'Seyahat pasaportunuzdaki kilometre.', when: 'You finish a live journey.', whenTr: 'Canlı bir yolculuğu bitirdiğinizde.' },
  { key: 'irn_follow', en: 'The lines you follow for disruption alerts.', tr: 'Aksama uyarıları için takip ettiğiniz hatlar.', when: 'You follow or unfollow a line.', whenTr: 'Bir hattı takip ettiğinizde veya bıraktığınızda.' },
  { key: 'irn_alerted', en: 'Which notices you have already been alerted about, so you are not alerted twice.', tr: 'Hangi duyurular için zaten uyarıldığınız; böylece iki kez uyarılmazsınız.', when: 'A notice arrives for a followed line.', whenTr: 'Takip ettiğiniz bir hat için duyuru geldiğinde.' },
  { key: 'irn_ai_key', en: 'The Anthropic API key you pasted, if you did.', tr: 'Yapıştırdıysanız Anthropic API anahtarınız.', when: 'You save a key. Personal.', whenTr: 'Anahtarı kaydettiğinizde. Kişisel.', personal: true },
  { key: 'irn_diag', en: 'A short log of recent faults (error messages), for the Report a problem button.', tr: '"Sorun bildir" düğmesi için son hataların (hata iletileri) kısa kaydı.', when: 'Something goes wrong in the app.', whenTr: 'Uygulamada bir şey ters gittiğinde.' },
];

/* ---- shared fragments ---------------------------------------------------------------------------------------------- */
const NOT_ADVICE = {
  en: 'This is a plain-language statement written by the project\'s author. It is <strong>not legal advice</strong> and has not been reviewed by a lawyer.',
  tr: 'Bu, projenin yazarının sade bir dille hazırladığı bir açıklamadır. <strong>Hukuki tavsiye değildir</strong> ve bir avukat tarafından incelenmemiştir.',
};

const PAGES = {};

/* =============================================================== index */
PAGES.index = {
  en: c => ({ title: 'Legal and privacy', desc: 'Privacy, terms, cookies and credits for İstanbul Ray-Net.', h1: 'Legal and privacy', updated: true, body:
    p('İstanbul Ray-Net is a free, non-commercial, open-source map of public transport in Turkish cities. These pages say what it does with information, what you can expect from it, and where its data and software come from.') +
    ul([a('privacy.html', '<strong>Privacy notice</strong>') + ': what the app keeps, who it talks to, and your choices.',
        a('terms.html', '<strong>Terms of use</strong>') + ': what the app is, what it is not, that it is free (no fees, no refunds needed), and its limits.',
        a('storage.html', '<strong>Cookies and stored data</strong>') + ': exactly what is saved on your device, and how to delete it.',
        a('credits.html', '<strong>Credits and licences</strong>') + ': whose data, software, typefaces and images the app uses.',
        a('accessibility.html', '<strong>Accessibility statement</strong>') + ': what works with a keyboard and a screen reader, what does not yet, and how to report a barrier.']) +
    '<h2 id="who">Who is behind it</h2>' +
    ul(['<strong>Operator:</strong> ' + c.operatorEn + '. There is no company, no registered business address and no tax number: it is a personal project.',
        '<strong>Contact:</strong> ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '. Questions about privacy, a correction or a complaint all go here.',
        '<strong>Source code:</strong> ' + a(c.repoUrl, esc(c.repoUrl)) + ' (MIT licence).',
        '<strong>Not affiliated:</strong> with Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD or any other operator or authority. Their names identify where information comes from.']) }),
  tr: c => ({ title: 'Yasal bilgiler ve gizlilik', desc: 'İstanbul Ray-Net için gizlilik, koşullar, çerezler ve katkılar.', h1: 'Yasal bilgiler ve gizlilik', updated: true, body:
    p('İstanbul Ray-Net, Türkiye\'deki şehirlerin toplu taşımasını gösteren ücretsiz, ticari olmayan, açık kaynaklı bir haritadır. Bu sayfalar uygulamanın bilgilerle ne yaptığını, ondan neler bekleyebileceğinizi ve verilerinin ile yazılımının nereden geldiğini anlatır.') +
    ul([a('privacy.tr.html', '<strong>Gizlilik bildirimi</strong>') + ': uygulamanın neyi sakladığı, kimlerle konuştuğu ve seçimleriniz.',
        a('terms.tr.html', '<strong>Kullanım koşulları</strong>') + ': uygulamanın ne olduğu, ne olmadığı, ücretsiz olduğu (ücret yok, iade gerekmez) ve sınırları.',
        a('storage.tr.html', '<strong>Çerezler ve saklanan veriler</strong>') + ': cihazınızda tam olarak neyin saklandığı ve nasıl silineceği.',
        a('credits.tr.html', '<strong>Katkılar ve lisanslar</strong>') + ': uygulamanın kimin verilerini, yazılımını, yazı tiplerini ve görsellerini kullandığı.',
        a('accessibility.tr.html', '<strong>Erişilebilirlik bildirimi</strong>') + ': klavye ve ekran okuyucuyla nelerin çalıştığı, nelerin henüz çalışmadığı ve bir engelin nasıl bildirileceği.']) +
    '<h2 id="who">Arkasında kim var</h2>' +
    ul(['<strong>İşleten:</strong> ' + c.operatorTr + '. Bir şirket, kayıtlı ticari adres ve vergi numarası yoktur: kişisel bir projedir.',
        '<strong>İletişim:</strong> ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '. Gizlilik soruları, düzeltme ve şikâyetler buraya gelir.',
        '<strong>Kaynak kod:</strong> ' + a(c.repoUrl, esc(c.repoUrl)) + ' (MIT lisansı).',
        '<strong>Bağlantı yok:</strong> Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD veya başka bir işletmeci ya da kurumla. Adları, bilginin nereden geldiğini belirtmek içindir.']) }),
};

/* =============================================================== privacy */
const hostRows = (L, optional) => HOSTS.filter(h => !!h.optional === optional).map(h => [
  '<strong>' + esc(h.name) + '</strong><br>' + h.hosts.map(code).join('<br>') + '<br>' + a(h.url, L === 'tr' ? 'Gizlilik bilgisi' : 'Their privacy information'),
  esc(h[L].when), esc(h[L].sees)]);

PAGES.privacy = {
  en: c => ({ title: 'Privacy notice', desc: 'What İstanbul Ray-Net keeps on your device, which services it contacts, and your choices.', h1: 'Privacy notice', updated: true, body:
    '<h2 id="short">The short version</h2>' + ul([
      'No accounts, no sign-up, no ads, no analytics, no tracking pixels and no cookies.',
      'There is no server of ours. The app is a set of files served by GitHub Pages. What you save (settings, saved places, journeys) stays on your device and is never sent to the author, who could not read it if they wanted to.',
      'Like any website, using the app means your device contacts the services in section 4 (for map tiles, weather and so on), and they can see your IP address and browser details. We chose services that need no sign-in and no key.',
      'Two optional extras send what you typed, or the start and end of a walk, to other services. <strong>Both are off until you say yes</strong> (section 5).',
      'You can erase everything the app stored on your device: Settings, Search and privacy, <em>Delete all my data on this device</em>.']) +
    '<h2 id="who">1. Who is responsible</h2>' + p('The operator is ' + c.operatorEn + '. This is a personal project, not a company, and has no postal address. Contact: ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '. "We" on this page means that author.') +
    '<h2 id="device">2. What the app keeps on your device</h2>' + p('Your settings, the places you set as Home and Work, recent and starred journeys, followed lines, your travel passport figures, an optional API key, a short log of recent faults, and offline copies of the app and of map tiles you viewed. All of it is in your browser\'s own storage and none of it is sent to us. The full list, with when each item is written, is on the ' + a('storage.html', 'Cookies and stored data') + ' page.') +
    '<h2 id="how">3. How the app works, in one paragraph</h2>' + p('The network, stations, timetables and the places list you search in are files that ship with the app, so searching and planning mostly happen on your device without asking anyone. The carriages you see moving are a simulation drawn on your device. What does reach other services is listed next.') +
    '<h2 id="hosts">4. Who your device talks to</h2>' + p('Every service the app can contact is listed below, and the page\'s own security policy (its Content-Security-Policy) forbids contacting anything else. None of them is given an account, a key or an identifier by us, and we have no access to what they log.') +
    '<h3>Always, as part of showing the app</h3>' + table(['Service', 'When it is contacted', 'What it can see'], hostRows('en', false)) +
    '<h3>Only if you allow it</h3>' + table(['Service', 'When it is contacted', 'What it can see'], hostRows('en', true)) +
    p('<strong>Links you tap</strong> (the operators\' own websites such as metro.istanbul or the State Meteorological Service, and GitHub for "Report a problem") open other websites in your browser; the app sends them nothing, and their own policies apply.') +
    p('<strong>Cookies:</strong> the app sets none. On 3 November 2026 we asked each map, weather, search and routing service above for a map tile or data file and none replied with a cookie. We cannot control what they change later.') +
    '<h2 id="choices">5. Your choice about online look-ups</h2>' +
    p('The first time you use the app (and after a material change to this notice) it asks one question: allow online look-ups, or keep everything on your device. The two buttons are the same size and either is fine. <strong>Until you answer, they are off.</strong>') +
    p('When on, three things go to services run by others: the text you type into a place search when the list on your device finds too little (Photon), "what is near here" searches (Photon, sending the coordinates searched around), and the start and end of the walking parts of a planned journey (the OSRM server). If one of those points is your own position, that position is sent. You can change the choice at any time in Settings, Search and privacy.') +
    p('<strong>Your location.</strong> The app asks your browser for your position only when you press a button that needs it ("my location", nearest stops, live journey), and your browser asks you first. The position is used on your device. It leaves the device only in the cases above, and only if you allowed online look-ups.') +
    '<h2 id="notify">6. Notifications</h2>' + p('If you follow a line and allow notifications, the app shows a notification on your device when a notice appears for that line. It is created on your device from notices the app downloads; there is no push server and nothing is sent about you. To stop, tap the 🔔 Following button on the line again, or turn notifications off in your browser\'s site settings.') +
    '<h2 id="report">7. Reports and e-mail</h2>' + p('<em>Report a problem</em> opens a new public GitHub page with a draft already typed in: the recent fault messages, the app version, the city, the language, the screen size, whether you are online, and your browser\'s identification text. Nothing leaves your device until you press submit on GitHub, you can edit or delete any of it first, and what you post there is public. You need a GitHub account to post. The app never sends e-mails, text messages or marketing, and has no mailing list, so there is nothing to unsubscribe from.') +
    '<h2 id="children">8. Children</h2>' + p('The app collects no personal data from anyone, of any age, and has no accounts, so it needs no age check or parental consent. If a child uses it, a parent or guardian may prefer to leave online look-ups off, which is the default.') +
    '<h2 id="rights">9. Your rights</h2>' + p('We hold no personal data about you, so there is nothing for us to look up, correct or delete: the data on your device is yours and the delete button removes it. For what the services in section 4 log (such as IP addresses) contact them through the links above. Data-protection laws such as Turkey\'s KVKK and the EU and UK GDPR give you rights over personal data and the right to complain to the supervisory authority; if you have any question or concern, write to us first at ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' and we will answer.') +
    '<h2 id="changes">10. Changes to this notice</h2>' + p('If this notice changes in a way that matters, the date and version above change and the app asks its question again. Older versions are kept in the project\'s public source history.') }),
  tr: c => ({ title: 'Gizlilik bildirimi', desc: 'İstanbul Ray-Net\'in cihazınızda ne sakladığı, hangi servislere eriştiği ve seçimleriniz.', h1: 'Gizlilik bildirimi', updated: true, body:
    '<h2 id="short">Kısaca</h2>' + ul([
      'Hesap, kayıt, reklam, analiz, izleme pikseli ve çerez yoktur.',
      'Bizim bir sunucumuz yoktur. Uygulama, GitHub Pages\'in sunduğu bir dosya kümesidir. Kaydettikleriniz (ayarlar, kayıtlı yerler, yolculuklar) cihazınızda kalır ve yazara asla gönderilmez; yazar istese de okuyamaz.',
      'Her web sitesi gibi, uygulamayı kullanmak cihazınızın 4. bölümdeki servislerle (harita karoları, hava durumu vb. için) konuşması demektir; onlar IP adresinizi ve tarayıcı bilgilerinizi görebilir. Hesap ve anahtar gerektirmeyen servisleri seçtik.',
      'İki isteğe bağlı özellik, yazdığınız metni ya da bir yürüyüşün başlangıç ve bitişini başka servislere gönderir. <strong>İkisi de siz evet diyene kadar kapalıdır</strong> (5. bölüm).',
      'Uygulamanın cihazınızda sakladığı her şeyi silebilirsiniz: Ayarlar, Arama ve gizlilik, <em>Bu cihazdaki tüm verilerimi sil</em>.']) +
    '<h2 id="who">1. Sorumlu kim</h2>' + p('İşleten ' + c.operatorTr + '. Bu kişisel bir projedir, şirket değildir ve posta adresi yoktur. İletişim: ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '. Bu sayfada "biz" bu yazar demektir.') +
    '<h2 id="device">2. Uygulamanın cihazınızda sakladıkları</h2>' + p('Ayarlarınız, Ev ve İş olarak belirlediğiniz yerler, son ve yıldızlı yolculuklar, takip edilen hatlar, seyahat pasaportu rakamları, isteğe bağlı bir API anahtarı, son hataların kısa bir kaydı ve uygulamanın ile baktığınız harita karolarının çevrimdışı kopyaları. Hepsi tarayıcınızın kendi depolamasındadır ve hiçbiri bize gönderilmez. Her kaydın ne zaman yazıldığını gösteren tam liste ' + a('storage.tr.html', 'Çerezler ve saklanan veriler') + ' sayfasındadır.') +
    '<h2 id="how">3. Uygulama nasıl çalışır, tek paragrafta</h2>' + p('Ağ, istasyonlar, sefer saatleri ve içinde arama yaptığınız yer listesi uygulamayla birlikte gelen dosyalardır; bu yüzden arama ve planlama çoğunlukla kimseye sormadan cihazınızda gerçekleşir. Hareket eden vagonlar cihazınızda çizilen bir simülasyondur. Başka servislere ulaşanlar ise sıradadır.') +
    '<h2 id="hosts">4. Cihazınızın konuştuğu servisler</h2>' + p('Uygulamanın erişebildiği her servis aşağıda listelenmiştir ve sayfanın kendi güvenlik politikası (Content-Security-Policy) başka hiçbir yere erişimi yasaklar. Hiçbirine bizden bir hesap, anahtar veya kimlik verilmez ve neyi kaydettiklerini göremeyiz.') +
    '<h3>Her zaman, uygulamayı göstermenin parçası olarak</h3>' + table(['Servis', 'Ne zaman kullanılır', 'Ne görebilir'], hostRows('tr', false)) +
    '<h3>Yalnızca izin verirseniz</h3>' + table(['Servis', 'Ne zaman kullanılır', 'Ne görebilir'], hostRows('tr', true)) +
    p('<strong>Dokunduğunuz bağlantılar</strong> (metro.istanbul veya Meteoroloji Genel Müdürlüğü gibi işletmecilerin kendi siteleri ve "Sorun bildir" için GitHub) tarayıcınızda başka web siteleri açar; uygulama onlara hiçbir şey göndermez, kendi politikaları geçerlidir.') +
    p('<strong>Çerezler:</strong> uygulama hiç çerez koymaz. 3 Kasım 2026\'da yukarıdaki harita, hava durumu, arama ve rota servislerinin her birinden bir harita karosu ya da veri dosyası istedik; hiçbiri çerezle yanıt vermedi. Sonradan neyi değiştireceklerini denetleyemeyiz.') +
    '<h2 id="choices">5. Çevrimiçi aramalar konusundaki seçiminiz</h2>' +
    p('Uygulamayı ilk kullandığınızda (ve bu bildirimde önemli bir değişiklikten sonra) tek bir soru sorar: çevrimiçi aramalara izin ver, ya da her şey cihazınızda kalsın. İki düğme aynı boydadır ve ikisi de uygundur. <strong>Siz yanıtlayana kadar kapalıdır.</strong>') +
    p('Açıkken üç şey başkalarının işlettiği servislere gider: cihazınızdaki liste yetersiz kaldığında yer aramasına yazdığınız metin (Photon), "yakınımda ne var" aramaları (Photon; çevresinde arama yapılan koordinatlar gider) ve planlanan bir yolculuğun yürüyüş bölümlerinin başlangıç ve bitişi (OSRM sunucusu). Bu noktalardan biri sizin kendi konumunuzsa, o konum gönderilir. Seçiminizi istediğiniz zaman Ayarlar, Arama ve gizlilik bölümünden değiştirebilirsiniz.') +
    p('<strong>Konumunuz.</strong> Uygulama, tarayıcınızdan konumunuzu yalnızca bunu gerektiren bir düğmeye bastığınızda ister ("konumum", en yakın duraklar, canlı yolculuk) ve tarayıcınız önce size sorar. Konum cihazınızda kullanılır. Cihazdan yalnızca yukarıdaki durumlarda ve yalnızca çevrimiçi aramalara izin verdiyseniz çıkar.') +
    '<h2 id="notify">6. Bildirimler</h2>' + p('Bir hattı takip eder ve bildirimlere izin verirseniz, o hat için bir duyuru çıktığında uygulama cihazınızda bildirim gösterir. Bildirim, uygulamanın indirdiği duyurulardan cihazınızda üretilir; itme (push) sunucusu yoktur ve sizinle ilgili hiçbir şey gönderilmez. Durdurmak için hattın üzerindeki 🔔 Takipte düğmesine yeniden dokunun ya da tarayıcınızın site ayarlarından bildirimleri kapatın.') +
    '<h2 id="report">7. Raporlar ve e-posta</h2>' + p('<em>Sorun bildir</em>, taslağı hazır yazılmış yeni bir herkese açık GitHub sayfası açar: son hata iletileri, uygulama sürümü, şehir, dil, ekran boyutu, çevrimiçi olup olmadığınız ve tarayıcınızın tanımlama metni. GitHub\'da gönder\'e basana kadar cihazınızdan hiçbir şey çıkmaz, önce istediğiniz kısmı düzenleyebilir ya da silebilirsiniz ve orada yazdığınız herkese açıktır. Yazmak için bir GitHub hesabı gerekir. Uygulama asla e-posta, kısa mesaj veya pazarlama göndermez ve bir posta listesi yoktur; bu yüzden abonelikten çıkılacak bir şey de yoktur.') +
    '<h2 id="children">8. Çocuklar</h2>' + p('Uygulama hiç kimseden, hiçbir yaşta kişisel veri toplamaz ve hesap yoktur; bu yüzden yaş denetimi veya ebeveyn izni gerekmez. Bir çocuk kullanıyorsa, ebeveyn ya da vasi çevrimiçi aramaları kapalı bırakmayı (varsayılan budur) tercih edebilir.') +
    '<h2 id="rights">9. Haklarınız</h2>' + p('Hakkınızda kişisel veri tutmuyoruz; bu yüzden bakılacak, düzeltilecek ya da silinecek bir şey yok: cihazınızdaki veri sizindir ve silme düğmesi onu kaldırır. 4. bölümdeki servislerin kaydettiklerini (IP adresleri gibi) yukarıdaki bağlantılar üzerinden onlara sorabilirsiniz. Türkiye\'nin KVKK\'sı ile AB ve Birleşik Krallık GDPR\'ı gibi veri koruma yasaları kişisel veriler üzerinde haklar ve denetim makamına şikâyet hakkı verir; sorunuz ya da kaygınız varsa önce ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' adresine yazın, yanıtlayacağız.') +
    '<h2 id="changes">10. Bu bildirimdeki değişiklikler</h2>' + p('Bu bildirim önemli bir biçimde değişirse, yukarıdaki tarih ve sürüm değişir ve uygulama sorusunu yeniden sorar. Eski sürümler projenin herkese açık kaynak geçmişinde durur.') }),
};

/* =============================================================== terms */
PAGES.terms = {
  en: c => ({ title: 'Terms of use', desc: 'What İstanbul Ray-Net is, what it is not, and its limits. It is free: no fees, no purchases, no refunds needed.', h1: 'Terms of use', updated: true, body:
    '<h2 id="what">1. What this is</h2>' + p('İstanbul Ray-Net is a free map and journey planner for public transport in Turkish cities (metro, tram, ferry, bus and more). It is made by ' + c.operatorEn + ' as a non-commercial, open-source project. It is <strong>not</strong> an official service of Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD or any other operator or authority, and is not affiliated with or endorsed by them.') +
    '<h2 id="accuracy">2. Check before you travel</h2>' + ul([
      'Timetables, fares, step-free information and notices come from official and open sources and may be out of date, incomplete or wrong. Fares and walking times are estimates.',
      'The carriages you see moving on the map are a <strong>simulation</strong> worked out from published timetables and frequencies. They are not vehicle positions, and the "next departures" board says MODELLED when it is derived that way.',
      'Rail and ferry notices show how old they are; if they have not been refreshed for a while the app says so.',
      'Always confirm with the operator\'s own channels before a journey that matters.']) +
    '<h2 id="free">3. It is free, with no hidden costs</h2>' + p('Nothing in the app is for sale. There is no subscription, no in-app purchase, no auto-renewal and no advertising. The only cost to you is the mobile data your own phone plan charges for map tiles and data (the "Save this area" button downloads roughly 2 MB for one screenful of map).') +
    '<h2 id="refunds">4. Refunds and cancellation</h2>' + p('Because nothing is sold, there is nothing to refund or cancel. If a paid feature is ever added, its price, what it includes, how to cancel and how refunds work will be shown before you can buy it, and these terms will be updated first.') +
    '<h2 id="reviews">5. Reviews and claims</h2>' + p('The app shows no user reviews, ratings or testimonials and collects none. Any statement the project makes about the app is the author\'s own description. If you find a claim that the app does not live up to, tell us at ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '.') +
    '<h2 id="use">6. Using it</h2>' + p('Use the app lawfully. Please do not try to overload, attack or scrape the app or the public services it relies on, and do not present its content as official. The app needs no account, so there is nothing to keep secret or to share.') +
    '<h2 id="age">7. Age</h2>' + p('Anyone can use the app. It has no accounts and collects no personal data, so it has no age gate; see the ' + a('privacy.html#children', 'privacy notice') + ' for children.') +
    '<h2 id="licences">8. Software, data and names</h2>' + p('The app\'s code is open source under the MIT licence (' + a(c.repoUrl, 'source') + '). Its data and map come from other projects under their own licences (for example OpenStreetMap\'s ODbL), listed on the ' + a('credits.html', 'credits page') + '. Names, logos and card pictures belong to their owners and are shown only to identify what they are.') +
    '<h2 id="liability">9. No warranty, and limits on liability</h2>' + p('The app is provided "as is", without promises that it is accurate, complete, always available or fit for a particular purpose. To the fullest extent the law allows, the author is not liable for missed connections, delays, costs or other loss from relying on it. Nothing here limits liability that cannot be limited by law (for example for death or personal injury caused by negligence, or for fraud) or any consumer right you have that cannot be waived.') +
    '<h2 id="changes">10. Changes</h2>' + p('The app and these terms may change. The date and version above show the current text, and older versions are kept in the project\'s public source history. If you do not agree with the terms, please do not use the app.') +
    '<h2 id="contact">11. Contact</h2>' + p(a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '.') }),
  tr: c => ({ title: 'Kullanım koşulları', desc: 'İstanbul Ray-Net\'in ne olduğu, ne olmadığı ve sınırları. Ücretsizdir: ücret yok, satın alma yok, iade gerekmez.', h1: 'Kullanım koşulları', updated: true, body:
    '<h2 id="what">1. Bu nedir</h2>' + p('İstanbul Ray-Net, Türkiye\'deki şehirlerde toplu taşıma (metro, tramvay, vapur, otobüs ve daha fazlası) için ücretsiz bir harita ve yolculuk planlayıcıdır. ' + c.operatorTr + ' tarafından ticari olmayan, açık kaynaklı bir proje olarak yapılmıştır. Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD veya başka bir işletmecinin ya da kurumun resmî hizmeti <strong>değildir</strong>; onlarla bağlantılı değildir ve onlar tarafından onaylanmamıştır.') +
    '<h2 id="accuracy">2. Yolculuktan önce doğrulayın</h2>' + ul([
      'Sefer saatleri, ücretler, merdivensiz erişim bilgisi ve duyurular resmî ve açık kaynaklardan gelir; güncel olmayabilir, eksik veya yanlış olabilir. Ücretler ve yürüme süreleri tahmindir.',
      'Haritada hareket eden vagonlar, yayımlanmış sefer saatleri ve sıklıklarından hesaplanan bir <strong>simülasyondur</strong>. Araç konumu değildir; "sonraki kalkışlar" panosu bu şekilde türetildiğinde MODEL yazar.',
      'Raylı sistem ve vapur duyuruları ne kadar eski olduklarını gösterir; bir süredir yenilenmemişlerse uygulama bunu söyler.',
      'Önemli bir yolculuktan önce mutlaka işletmecinin kendi kanallarından doğrulayın.']) +
    '<h2 id="free">3. Ücretsizdir, gizli maliyet yoktur</h2>' + p('Uygulamada satılan hiçbir şey yoktur. Abonelik, uygulama içi satın alma, otomatik yenileme ve reklam yoktur. Size tek maliyeti, kendi telefon tarifenizin harita karoları ve veriler için aldığı mobil veri ücretidir ("Bu alanı kaydet" düğmesi bir ekranlık harita için yaklaşık 2 MB indirir).') +
    '<h2 id="refunds">4. İade ve iptal</h2>' + p('Hiçbir şey satılmadığı için iade edilecek ya da iptal edilecek bir şey yoktur. İleride ücretli bir özellik eklenirse, fiyatı, neleri kapsadığı, nasıl iptal edileceği ve iadelerin nasıl işlediği siz satın alamadan önce gösterilir ve bu koşullar önce güncellenir.') +
    '<h2 id="reviews">5. Yorumlar ve iddialar</h2>' + p('Uygulama kullanıcı yorumu, puanı veya referans göstermez ve toplamaz. Projenin uygulama hakkında söylediği her şey yazarın kendi tanımıdır. Uygulamanın karşılayamadığı bir iddia görürseniz bize ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' adresinden bildirin.') +
    '<h2 id="use">6. Kullanım</h2>' + p('Uygulamayı yasalara uygun kullanın. Lütfen uygulamayı ya da dayandığı herkese açık servisleri aşırı yüklemeye, saldırmaya veya kazımaya çalışmayın ve içeriğini resmî gibi sunmayın. Uygulama hesap gerektirmez; bu yüzden gizli tutulacak ya da paylaşılacak bir şey yoktur.') +
    '<h2 id="age">7. Yaş</h2>' + p('Uygulamayı herkes kullanabilir. Hesap yoktur ve kişisel veri toplanmaz; bu yüzden yaş sınırı yoktur. Çocuklar için ' + a('privacy.tr.html#children', 'gizlilik bildirimine') + ' bakın.') +
    '<h2 id="licences">8. Yazılım, veri ve adlar</h2>' + p('Uygulamanın kodu MIT lisansıyla açık kaynaktır (' + a(c.repoUrl, 'kaynak') + '). Verileri ve haritası, kendi lisansları altındaki başka projelerden gelir (örneğin OpenStreetMap\'in ODbL\'si); ' + a('credits.tr.html', 'katkılar sayfasında') + ' listelenmiştir. Adlar, logolar ve kart görselleri sahiplerine aittir ve yalnızca ne olduklarını belirtmek için gösterilir.') +
    '<h2 id="liability">9. Garanti yoktur, sorumluluk sınırlıdır</h2>' + p('Uygulama "olduğu gibi" sunulur; doğru, eksiksiz, her zaman erişilebilir ya da belirli bir amaca uygun olduğu vaat edilmez. Yasaların izin verdiği en geniş ölçüde, yazar bu uygulamaya güvenmekten doğan kaçırılan aktarmalardan, gecikmelerden, masraflardan veya başka zararlardan sorumlu değildir. Burada yazılanlar, yasayla sınırlanamayan sorumluluğu (örneğin ihmalin yol açtığı ölüm veya bedensel zarar ya da hile) ya da vazgeçilemeyen hiçbir tüketici hakkınızı sınırlamaz.') +
    '<h2 id="changes">10. Değişiklikler</h2>' + p('Uygulama ve bu koşullar değişebilir. Yukarıdaki tarih ve sürüm güncel metni gösterir; eski sürümler projenin herkese açık kaynak geçmişinde durur. Koşulları kabul etmiyorsanız lütfen uygulamayı kullanmayın.') +
    '<h2 id="contact">11. İletişim</h2>' + p(a('mailto:' + c.contactEmail, esc(c.contactEmail)) + '.') }),
};

/* =============================================================== storage */
const storageRows = L => STORAGE.map(s => ['<code>' + esc(s.key) + '</code>', esc(s[L]), esc(L === 'tr' ? s.whenTr : s.when)]);
PAGES.storage = {
  en: c => ({ title: 'Cookies and stored data', desc: 'Exactly what İstanbul Ray-Net saves on your device, and how to delete it.', h1: 'Cookies and stored data', updated: true, body:
    '<h2 id="cookies">Cookies</h2>' + p('The app sets <strong>no cookies</strong>, and uses no cookie-like tracking (no tracking IDs, no fingerprinting, no advertising or analytics scripts). It also does not use IndexedDB or session storage.') +
    '<h2 id="local">What it stores instead</h2>' + p('The app saves a small amount of data in your browser\'s own <em>local storage</em>, on your device only. It is never sent to the author or anyone else. Each item is created only when the thing it remembers happens.') +
    table(['Key', 'What it holds', 'Written when'], storageRows('en')) +
    '<h2 id="cache">Offline copies</h2>' + p('So the app opens without a connection, a <em>service worker</em> keeps copies of the app\'s own files in your browser\'s cache storage, in four caches whose names begin with <code>raynet-</code>: the app page (<code>raynet-shell-…</code>), its scripts, typefaces, data files and icons (<code>raynet-static-v1</code>), the street-map tiles you have viewed (<code>raynet-vtiles-v1</code>, up to 3,000 files) and the satellite or backup map tiles you have viewed (<code>raynet-tiles-v2</code>, up to 3,000 files). <em>Save this area</em> adds the tiles for one screenful on purpose; nothing is downloaded in bulk.') +
    '<h2 id="consent">Why there is no cookie banner</h2>' + p('Everything above is stored so the features you use can work (your settings, your saved places, offline use), is created because of something you did, and never leaves your device. In our reading that does not call for consent. The one real choice the app offers, whether to allow online look-ups, is asked about once in a notice with two equal buttons, and explained in the ' + a('privacy.html#choices', 'privacy notice') + '.') +
    '<h2 id="delete">How to delete it</h2>' + ul([
      '<strong>All of it, in one tap:</strong> Settings, Search and privacy, <em>Delete all my data on this device</em>. It removes every item above, the offline copies and the service worker, then restarts the app like a first visit.',
      '<strong>Just trips and favourites:</strong> <em>Clear saved trips and favourites</em>, in the same place.',
      '<strong>Your browser:</strong> clearing this site\'s data in your browser\'s settings removes everything too.']) +
    p('Other projects published under the same github.io address keep their own data; the button removes only what this app wrote (keys starting <code>irn_</code> and caches starting <code>raynet-</code>).') }),
  tr: c => ({ title: 'Çerezler ve saklanan veriler', desc: 'İstanbul Ray-Net\'in cihazınızda tam olarak neyi kaydettiği ve nasıl silineceği.', h1: 'Çerezler ve saklanan veriler', updated: true, body:
    '<h2 id="cookies">Çerezler</h2>' + p('Uygulama <strong>hiç çerez koymaz</strong> ve çereze benzer izleme kullanmaz (izleme kimliği, parmak izi, reklam veya analiz betiği yok). IndexedDB veya oturum depolamasını da kullanmaz.') +
    '<h2 id="local">Onun yerine ne saklar</h2>' + p('Uygulama, tarayıcınızın kendi <em>yerel depolamasında</em>, yalnızca cihazınızda küçük miktarda veri kaydeder. Yazara ya da başkasına asla gönderilmez. Her kayıt, ancak hatırladığı şey gerçekleştiğinde oluşturulur.') +
    table(['Anahtar', 'Ne tutar', 'Ne zaman yazılır'], storageRows('tr')) +
    '<h2 id="cache">Çevrimdışı kopyalar</h2>' + p('Uygulama bağlantısız da açılsın diye bir <em>hizmet çalışanı</em> (service worker) uygulamanın kendi dosyalarının kopyalarını tarayıcınızın önbellek depolamasında, adı <code>raynet-</code> ile başlayan dört önbellekte tutar: uygulama sayfası (<code>raynet-shell-…</code>), betikleri, yazı tipleri, veri dosyaları ve simgeleri (<code>raynet-static-v1</code>), baktığınız sokak haritası karoları (<code>raynet-vtiles-v1</code>, en çok 3.000 dosya) ve baktığınız uydu ya da yedek harita karoları (<code>raynet-tiles-v2</code>, en çok 3.000 dosya). <em>Bu alanı kaydet</em>, bilerek bir ekranlık karoyu ekler; toplu indirme yapılmaz.') +
    '<h2 id="consent">Neden çerez bildirimi yok</h2>' + p('Yukarıdaki her şey, kullandığınız özelliklerin çalışması için (ayarlarınız, kayıtlı yerleriniz, çevrimdışı kullanım) saklanır, sizin yaptığınız bir şey yüzünden oluşturulur ve cihazınızdan asla çıkmaz. Bizim okumamıza göre bu bir onay gerektirmez. Uygulamanın sunduğu tek gerçek seçim, yani çevrimiçi aramalara izin verip vermeyeceğiniz, iki eşit düğmeli bir bildirimle bir kez sorulur ve ' + a('privacy.tr.html#choices', 'gizlilik bildiriminde') + ' açıklanır.') +
    '<h2 id="delete">Nasıl silinir</h2>' + ul([
      '<strong>Hepsi, tek dokunuşla:</strong> Ayarlar, Arama ve gizlilik, <em>Bu cihazdaki tüm verilerimi sil</em>. Yukarıdaki her kaydı, çevrimdışı kopyaları ve hizmet çalışanını kaldırır, sonra uygulamayı ilk ziyaret gibi yeniden başlatır.',
      '<strong>Yalnızca yolculuklar ve favoriler:</strong> aynı yerdeki <em>Kayıtlı yolculukları ve favorileri temizle</em>.',
      '<strong>Tarayıcınız:</strong> tarayıcı ayarlarından bu sitenin verilerini temizlemek de her şeyi kaldırır.']) +
    p('Aynı github.io adresi altında yayımlanan diğer projeler kendi verilerini tutar; düğme yalnızca bu uygulamanın yazdıklarını (<code>irn_</code> ile başlayan anahtarlar ve <code>raynet-</code> ile başlayan önbellekler) kaldırır.') }),
};

/* =============================================================== credits */
const OFL = (en) => en ? 'SIL Open Font License 1.1' : 'SIL Açık Yazı Tipi Lisansı 1.1';
PAGES.credits = {
  en: c => ({ title: 'Credits and licences', desc: 'Whose data, software, typefaces and images İstanbul Ray-Net uses.', h1: 'Credits and licences', updated: true, body:
    '<h2 id="data">Map data and services</h2>' + ul([
      '<strong>OpenStreetMap contributors</strong>: the rail, tram, ferry and bus geometry, stations, and every named street and place the search runs on. © OpenStreetMap contributors, ' + a('https://www.openstreetmap.org/copyright', 'ODbL 1.0') + '. Because the app ships derived data, that data is offered under the same licence.',
      '<strong>OpenFreeMap</strong> and the <strong>OpenMapTiles</strong> schema: the street map drawn on your device. ' + a('https://openfreemap.org/', 'openfreemap.org') + '.',
      '<strong>Esri</strong> (World Imagery and the backup World Street Map): © Esri, Maxar, Earthstar Geographics, HERE, Garmin, USGS and contributors.',
      '<strong>İBB Open Data, İETT and Metro İstanbul</strong>: station registry, timetables, bus lines and notices, under the ' + a('https://data.ibb.gov.tr/license', 'İBB Open Data Licence') + ', which allows reuse with attribution. As the licence asks: <em>Contains public sector information licensed under Attribution 4.0 International (CC BY 4.0)</em> (Turkish: <em>Atıf 4.0 Uluslararası (CC BY 4.0) kapsamında lisanslanan kamu sektörü bilgilerini içerir.</em>). <strong>Şehir Hatları</strong>, <strong>TCDD Taşımacılık</strong>, <strong>EGO</strong> and the other city operators: published timetables and notices, shown with their source.',
      '<strong>Open-Meteo</strong>: weather and air quality, ' + a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0') + '. Official warnings come from the State Meteorological Service (MGM).',
      'The full list, with each source\'s terms, is in ' + a(c.repoUrl + '/blob/main/DATA-SOURCES.md', 'DATA-SOURCES.md') + '.']) +
    '<h2 id="software">Software</h2>' + ul([
      '<strong>Leaflet</strong> 1.9.4, BSD-2-Clause, © Volodymyr Agafonkin and Leaflet contributors.',
      '<strong>MapLibre GL JS</strong> 4.7.1, BSD-3-Clause, and <strong>maplibre-gl-leaflet</strong> 0.0.22, BSD-2-Clause.',
      'İstanbul Ray-Net itself: MIT licence, ' + a(c.repoUrl, 'source code') + '.',
      'Each library is shipped unchanged inside the app, with its licence file and a recorded hash, in the <code>vendor</code> folder.']) +
    '<h2 id="fonts">Typefaces</h2>' + ul([
      '<strong>Inter</strong>, © 2016 The Inter Project Authors. <strong>Space Grotesk</strong>, © 2020 The Space Grotesk Project Authors. <strong>JetBrains Mono</strong>, © 2020 The JetBrains Mono Project Authors. All under the ' + OFL(true) + '.',
      '<strong>Noto Sans</strong> (the map\'s place names), © 2018 The Noto Project Authors, ' + OFL(true) + '.',
      'The typefaces are served from this app, not from a font service.']) +
    '<h2 id="images">Images and icons</h2>' + ul([
      '<strong>App icon and share-preview picture</strong>: generated with ChatGPT (OpenAI) from the app owner\'s own description and supplied by the owner. Under ' + a('https://openai.com/policies/terms-of-use/', 'OpenAI\'s terms') + ' the person who asked for the picture owns it to the extent the law allows. In some countries a computer-generated picture may not be protected by copyright, and similar pictures may be made for other people.',
      '<strong>İstanbulkart pictures</strong> (the fare-card choice in Settings): Belbim A.Ş.\'s product artwork via Wikimedia Commons, where it is marked public domain as a simple text-and-logo mark (' + a('https://commons.wikimedia.org/wiki/Category:%C4%B0stanbulkart', 'Commons category') + '). Shown only to identify the card, with a credit; no affiliation is implied.',
      '<strong>Other cities\' fare cards</strong> are drawn by the app itself, as are the line symbols and every other icon (inline vector graphics). The app uses no stock photographs.',
      'Emoji are drawn by your device\'s own emoji font.']) +
    '<h2 id="marks">Names and trademarks</h2>' + p('Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD, İstanbulkart, Esri, OpenStreetMap and other names belong to their owners and are used only to say where information comes from.') +
    '<h2 id="report">Something missing or wrong?</h2>' + p('Tell us at ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' and we will correct or remove it.') }),
  tr: c => ({ title: 'Katkılar ve lisanslar', desc: 'İstanbul Ray-Net\'in kimin verilerini, yazılımını, yazı tiplerini ve görsellerini kullandığı.', h1: 'Katkılar ve lisanslar', updated: true, body:
    '<h2 id="data">Harita verisi ve servisler</h2>' + ul([
      '<strong>OpenStreetMap katkıcıları</strong>: raylı sistem, tramvay, vapur ve otobüs geometrisi, istasyonlar ve aramanın çalıştığı her adlı sokak ile yer. © OpenStreetMap katkıcıları, ' + a('https://www.openstreetmap.org/copyright', 'ODbL 1.0') + '. Uygulama türetilmiş veri sunduğu için o veri aynı lisansla sunulur.',
      '<strong>OpenFreeMap</strong> ve <strong>OpenMapTiles</strong> şeması: cihazınızda çizilen sokak haritası. ' + a('https://openfreemap.org/', 'openfreemap.org') + '.',
      '<strong>Esri</strong> (World Imagery ve yedek World Street Map): © Esri, Maxar, Earthstar Geographics, HERE, Garmin, USGS ve katkıcılar.',
      '<strong>İBB Açık Veri, İETT ve Metro İstanbul</strong>: istasyon kayıtları, sefer saatleri, otobüs hatları ve duyurular; kaynak göstererek yeniden kullanıma izin veren ' + a('https://data.ibb.gov.tr/license', 'İBB Açık Veri Lisansı') + ' altında. Lisansın istediği şekilde: <em>Atıf 4.0 Uluslararası (CC BY 4.0) kapsamında lisanslanan kamu sektörü bilgilerini içerir.</em> <strong>Şehir Hatları</strong>, <strong>TCDD Taşımacılık</strong>, <strong>EGO</strong> ve diğer şehir işletmecileri: yayımlanmış sefer saatleri ve duyurular, kaynaklarıyla gösterilir.',
      '<strong>Open-Meteo</strong>: hava durumu ve hava kalitesi, ' + a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0') + '. Resmî uyarılar Meteoroloji Genel Müdürlüğü\'nden (MGM) gelir.',
      'Her kaynağın koşullarıyla birlikte tam liste ' + a(c.repoUrl + '/blob/main/DATA-SOURCES.md', 'DATA-SOURCES.md') + ' dosyasındadır.']) +
    '<h2 id="software">Yazılım</h2>' + ul([
      '<strong>Leaflet</strong> 1.9.4, BSD-2-Clause, © Volodymyr Agafonkin ve Leaflet katkıcıları.',
      '<strong>MapLibre GL JS</strong> 4.7.1, BSD-3-Clause ve <strong>maplibre-gl-leaflet</strong> 0.0.22, BSD-2-Clause.',
      'İstanbul Ray-Net\'in kendisi: MIT lisansı, ' + a(c.repoUrl, 'kaynak kod') + '.',
      'Her kitaplık, uygulamanın içinde, <code>vendor</code> klasöründe, lisans dosyası ve kayıtlı bir özetiyle değiştirilmeden gönderilir.']) +
    '<h2 id="fonts">Yazı tipleri</h2>' + ul([
      '<strong>Inter</strong>, © 2016 The Inter Project Authors. <strong>Space Grotesk</strong>, © 2020 The Space Grotesk Project Authors. <strong>JetBrains Mono</strong>, © 2020 The JetBrains Mono Project Authors. Hepsi ' + OFL(false) + ' altında.',
      '<strong>Noto Sans</strong> (haritadaki yer adları), © 2018 The Noto Project Authors, ' + OFL(false) + '.',
      'Yazı tipleri bir yazı tipi servisinden değil, bu uygulamadan sunulur.']) +
    '<h2 id="images">Görseller ve simgeler</h2>' + ul([
      '<strong>Uygulama simgesi ve paylaşım önizleme görseli</strong>: uygulamanın sahibinin kendi tarifinden ChatGPT (OpenAI) ile üretilmiş ve sahibi tarafından sağlanmıştır. ' + a('https://openai.com/policies/terms-of-use/', 'OpenAI\'nin koşullarına') + ' göre görseli isteyen kişi, yasaların izin verdiği ölçüde onun sahibidir. Bazı ülkelerde bilgisayarla üretilen bir görsel telif hakkıyla korunmayabilir ve başkaları için de benzer görseller üretilebilir.',
      '<strong>İstanbulkart görselleri</strong> (Ayarlar\'daki ücret kartı seçimi): Belbim A.Ş.\'nin ürün görselleri, Wikimedia Commons üzerinden; orada basit bir yazı-logo işareti olarak kamu malı işaretlenmiştir (' + a('https://commons.wikimedia.org/wiki/Category:%C4%B0stanbulkart', 'Commons kategorisi') + '). Yalnızca kartı tanıtmak için, kaynak gösterilerek kullanılır; bağlantı ima edilmez.',
      '<strong>Diğer şehirlerin ücret kartları</strong>, hat simgeleri ve diğer tüm simgeler (satır içi vektör grafikler) uygulamanın kendisi tarafından çizilir. Uygulama hiç stok fotoğraf kullanmaz.',
      'Emojiler cihazınızın kendi emoji yazı tipiyle çizilir.']) +
    '<h2 id="marks">Adlar ve markalar</h2>' + p('Metro İstanbul, İETT, İBB, Şehir Hatları, TCDD, İstanbulkart, Esri, OpenStreetMap ve diğer adlar sahiplerine aittir ve yalnızca bilginin nereden geldiğini belirtmek için kullanılır.') +
    '<h2 id="report">Eksik ya da yanlış bir şey mi var?</h2>' + p('Bize ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' adresinden yazın; düzeltir ya da kaldırırız.') }),
};

/* =============================================================== accessibility */
PAGES.accessibility = {
  en: c => ({ title: 'Accessibility statement', desc: 'How accessible İstanbul Ray-Net is, what is not yet, and how to tell us about a barrier.', h1: 'Accessibility statement', updated: true, body:
    p('We want everyone to be able to use the app. It aims at the <em>Web Content Accessibility Guidelines</em> (WCAG) 2.2, level AA. It has been checked by automated tests and by hand in a browser, <strong>not yet with a real screen reader on a phone</strong>, so we say it <strong>partly</strong> meets that standard and list below what is missing.') +
    '<h2 id="works">What works</h2>' + ul([
      '<strong>Keyboard.</strong> Everything in the app can be reached and operated without a mouse or touch: buttons, the legend of lines, notices, Settings and panels. Panels take focus when they open, keep Tab inside while they are open, and give focus back when they close. Escape closes the newest panel.',
      '<strong>The map\'s stations by keyboard.</strong> Focus the map (Tab), then press <kbd>N</kbd> and <kbd>P</kbd> to step through the stations in view (nearest the centre first); the station is ringed on the map and announced. <kbd>Enter</kbd> opens it, <kbd>L</kbd> lists them all, <kbd>Esc</kbd> clears. A "Browse the stations in view" button does the same for screen readers. Arrow keys pan the map and <kbd>+</kbd> and <kbd>-</kbd> zoom it.',
      '<strong>Screen readers.</strong> Buttons, switches (with on and off), dialogs and the map have names, in English, Turkish, Arabic and French. Station choices and results are announced.',
      '<strong>Colour and contrast.</strong> Text colour against its background was measured in every style (Neon, Atlas, Calm, Paper) in dark, light and mixed themes, and with high contrast on, and meets 4.5:1 (WCAG AA). Line chips choose black or white text to stay readable on any line colour.',
      '<strong>Motion.</strong> The system "reduce motion" setting and Settings, Accessibility, Reduce motion both calm the animations.',
      '<strong>Text size.</strong> Settings, Text size makes text larger. Languages that read right to left (Arabic) are laid out right to left.']) +
    '<h2 id="limits">What does not work yet, or works differently</h2>' + ul([
      '<strong>Pinch-zooming the page is switched off on purpose.</strong> The app should behave like an app: only the map zooms and pans, and pinching a tab or a panel no longer zooms and distorts the whole page. This is a trade-off against the guideline that text should be resizable. To enlarge text use <em>Settings, Text size</em>, or your device\'s own magnifier (Android: Accessibility, Magnification, or "Force enable zoom"; iPhone: Accessibility, Zoom, or Display and Text Size).',
      '<strong>No real screen reader testing yet.</strong> TalkBack, VoiceOver and NVDA have not been used on the app. Expect rough edges and tell us about them.',
      '<strong>The names drawn on the map</strong> (streets, districts, places) are part of a map picture and are not read by screen readers; stations can be reached with the keys above, and places with the search box.',
      '<strong>The moving carriages</strong> are a visual simulation with no equivalent for a screen reader; timetables and departures are available as text.',
      '<strong>Legal pages</strong> are available in English and Turkish only.',
      '<strong>Colours of lines on the map</strong> against the map have not been measured against the 3:1 guideline for graphics.']) +
    '<h2 id="feedback">Tell us about a barrier</h2>' + p('If something does not work for you, write to ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' and say what you were trying to do, what device and assistive technology you use, and what happened. We read every message and fix what we can; this is a personal project, so we cannot promise a date.') +
    '<h2 id="date">This statement</h2>' + p('Written on 4 November 2026 from what was tested then. It will be updated when the app changes.') }),
  tr: c => ({ title: 'Erişilebilirlik bildirimi', desc: 'İstanbul Ray-Net\'in ne kadar erişilebilir olduğu, neyin henüz olmadığı ve bir engeli bize nasıl bildireceğiniz.', h1: 'Erişilebilirlik bildirimi', updated: true, body:
    p('Uygulamayı herkesin kullanabilmesini istiyoruz. <em>Web İçeriği Erişilebilirlik Yönergeleri</em> (WCAG) 2.2, AA düzeyini hedefler. Otomatik testlerle ve bir tarayıcıda elle denetlendi, <strong>henüz bir telefonda gerçek bir ekran okuyucuyla denenmedi</strong>; bu yüzden bu standardı <strong>kısmen</strong> karşıladığını söylüyoruz ve eksikleri aşağıda sıralıyoruz.') +
    '<h2 id="works">Çalışanlar</h2>' + ul([
      '<strong>Klavye.</strong> Uygulamadaki her şeye fare veya dokunma olmadan ulaşılır ve kullanılır: düğmeler, hat göstergesi, duyurular, Ayarlar ve paneller. Paneller açılınca odağı alır, açıkken Tab\'ı kendi içinde tutar, kapanınca odağı geri verir. Esc en yeni paneli kapatır.',
      '<strong>Haritadaki istasyonlar klavyeyle.</strong> Haritaya odaklanın (Tab), sonra görünümdeki istasyonlar arasında gezinmek için <kbd>N</kbd> ve <kbd>P</kbd> tuşlarına basın (merkeze en yakından başlar); istasyon haritada halkayla işaretlenir ve sesli bildirilir. <kbd>Enter</kbd> açar, <kbd>L</kbd> hepsini listeler, <kbd>Esc</kbd> seçimi temizler. "Görünümdeki istasyonlara göz at" düğmesi aynısını ekran okuyucular için yapar. Ok tuşları haritayı kaydırır, <kbd>+</kbd> ve <kbd>-</kbd> yakınlaştırır.',
      '<strong>Ekran okuyucular.</strong> Düğmelerin, anahtarların (açık ve kapalı durumuyla), iletişim kutularının ve haritanın İngilizce, Türkçe, Arapça ve Fransızca adları vardır. İstasyon seçimleri ve sonuçlar sesli bildirilir.',
      '<strong>Renk ve karşıtlık.</strong> Metin renginin arka planına karşı karşıtlığı her stilde (Neon, Atlas, Calm, Paper) koyu, açık ve karma temalarda, ayrıca yüksek karşıtlık açıkken ölçüldü ve 4,5:1\'i (WCAG AA) karşılıyor. Hat etiketleri, her hat renginde okunur kalmak için siyah ya da beyaz metin seçer.',
      '<strong>Hareket.</strong> Sistemin "hareketi azalt" ayarı ve Ayarlar, Erişilebilirlik, Hareketi azalt animasyonları yumuşatır.',
      '<strong>Yazı boyutu.</strong> Ayarlar, Yazı boyutu metni büyütür. Sağdan sola okunan diller (Arapça) sağdan sola dizilir.']) +
    '<h2 id="limits">Henüz çalışmayanlar veya farklı çalışanlar</h2>' + ul([
      '<strong>Sayfanın çimdikle yakınlaştırılması bilerek kapalıdır.</strong> Uygulama bir uygulama gibi davranmalı: yalnızca harita yakınlaşır ve kayar; bir sekmeyi ya da paneli çimdiklemek artık tüm sayfayı yakınlaştırıp bozmaz. Bu, metnin yeniden boyutlandırılabilmesi yönergesine karşı bir ödünleşimdir. Metni büyütmek için <em>Ayarlar, Yazı boyutu</em>\'nu ya da cihazınızın kendi büyüteçini kullanın (Android: Erişilebilirlik, Büyütme veya "Yakınlaştırmayı zorla"; iPhone: Erişilebilirlik, Zoom veya Ekran ve Metin Boyutu).',
      '<strong>Henüz gerçek ekran okuyucuyla test yok.</strong> TalkBack, VoiceOver ve NVDA uygulamada kullanılmadı. Pürüzler olabilir; bize bildirin.',
      '<strong>Haritada çizilen adlar</strong> (sokaklar, ilçeler, yerler) harita resminin parçasıdır ve ekran okuyucular tarafından okunmaz; istasyonlara yukarıdaki tuşlarla, yerlere arama kutusuyla ulaşılır.',
      '<strong>Hareket eden vagonlar</strong> ekran okuyucu karşılığı olmayan görsel bir simülasyondur; sefer saatleri ve kalkışlar metin olarak bulunur.',
      '<strong>Yasal sayfalar</strong> yalnızca İngilizce ve Türkçedir.',
      '<strong>Hat renklerinin</strong> harita karşısındaki karşıtlığı, grafikler için 3:1 yönergesine göre ölçülmedi.']) +
    '<h2 id="feedback">Bir engeli bize bildirin</h2>' + p('Bir şey sizin için çalışmıyorsa ' + a('mailto:' + c.contactEmail, esc(c.contactEmail)) + ' adresine yazın; ne yapmaya çalıştığınızı, hangi cihaz ve yardımcı teknolojiyi kullandığınızı ve ne olduğunu belirtin. Her mesajı okuruz ve yapabildiğimizi düzeltiriz; bu kişisel bir proje olduğundan tarih sözü veremeyiz.') +
    '<h2 id="date">Bu bildirim</h2>' + p('4 Kasım 2026\'da, o gün test edilenlere dayanarak yazıldı. Uygulama değiştikçe güncellenecek.') }),
};

module.exports = { HOSTS, STORAGE, PAGES, NOT_ADVICE };
