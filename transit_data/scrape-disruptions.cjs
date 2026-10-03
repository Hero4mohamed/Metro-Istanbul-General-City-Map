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
/* One Turkish pattern, three destinations. The rules used to carry a single English string,
   which quietly made English the only language a disruption could be read in: an Arabic or
   French reader got the English translation, or the Turkish original, but never their own
   language. The pattern list is the hard-won part — the ordering comments below are about
   which Turkish form must be matched before which — so it stays exactly one list, and each
   rule names what it produces in each language instead. */
const TR_PHRASES = [
  // requests by authorities ("X'nin talebi doğrultusunda …")
  /* Named before the generic request rule, because that one captures the whole authority as
     one opaque group and leaves the word-level map to translate "Emniyeti" in place — which
     is correct in English ("İstanbul Police") and backwards in Arabic and French, where the
     institution leads and the city follows. */
  [/^\s*(\S+)\s+[Ee]mniyeti(?:nin)?\s+talebi\s+doğrultusunda[ ,]*/i,
    { en:'At the request of the $1 Police, ', ar:'بناءً على طلب مديرية أمن $1، ',
      fr:'À la demande de la police de $1, ' }],
  [/^\s*(.+?)['’ʼ]?\s*n[iı]n\s+talebi\s+doğrultusunda[ ,]*/i,
    { en:'At the request of $1, ', ar:'بناءً على طلب $1، ', fr:'À la demande de $1, ' }],
  [/talebi\s+doğrultusunda/gi, { en:'per request', ar:'بناءً على الطلب', fr:'à la demande' }],
  [/doğrultusunda/gi,          { en:'in line with', ar:'وفقًا لـ', fr:'conformément à' }],
  // station/segment ride patterns (most specific first)
  [/seferler(?:imiz)?\s+yapıl(?:a)?mamaktadır/gi,
    { en:'services cannot operate', ar:'لا يمكن تسيير الرحلات', fr:'les trains ne peuvent pas circuler' }],
  [/([^\s,]+)\s*[-–]\s*([^\s,]+)\s+istasyonları\s+arasında\s+yapılmaktadır/gi,
    { en:'operate between $1 and $2', ar:'تسير بين $1 و$2', fr:'circulent entre $1 et $2' }],
  [/([^\s,]+)\s+ve\s+([^\s,]+)\s+[İi]stasyon(?:undan|larından)\s+aktarmalı\s+olarak/gi,
    { en:'with a transfer at $1 and $2,', ar:'مع تحويل في $1 و$2،', fr:'avec correspondance à $1 et $2,' }],
  [/([^\s,]+)\s+[İi]stasyon(?:undan|larından)\s+aktarmalı\s+olarak/gi,
    { en:'with a transfer at $1,', ar:'مع تحويل في $1،', fr:'avec correspondance à $1,' }],
  [/([^\s,]+)\s*[-–]\s*([^\s,]+)\s+istasyonları\s+arasında/gi,
    { en:'between $1 and $2', ar:'بين $1 و$2', fr:'entre $1 et $2' }],
  // reasons — lowercase so they read correctly mid-sentence (first letter re-capitalised at end)
  [/planlı\s+bakım\s+(?:ve\s+onarım\s+)?çalış(?:ması|maları)?\s*(?:nedeniyle)?/gi,
    { en:'due to planned maintenance,', ar:'بسبب أعمال صيانة مخطّطة،', fr:'en raison de travaux de maintenance programmés,' }],
  [/onarım\s+çalış(?:ması|maları)\s+nedeniyle/gi,
    { en:'due to maintenance works,', ar:'بسبب أعمال الإصلاح،', fr:'en raison de travaux de réparation,' }],
  [/bakım\s+(?:ve\s+onarım\s+)?çalış(?:ması|maları)\s+nedeniyle/gi,
    { en:'due to maintenance works,', ar:'بسبب أعمال الصيانة،', fr:'en raison de travaux d’entretien,' }],
  [/teknik\s+(?:bir\s+)?arıza\s+nedeniyle/gi,
    { en:'due to a technical fault,', ar:'بسبب عطل فني،', fr:'en raison d’une panne technique,' }],
  [/sinyalizasyon\s+arızası\s+nedeniyle/gi,
    { en:'due to a signalling fault,', ar:'بسبب عطل في نظام الإشارات،', fr:'en raison d’une panne de signalisation,' }],
  [/elektrik\s+kesintisi\s+nedeniyle/gi,
    { en:'due to a power outage,', ar:'بسبب انقطاع التيار الكهربائي،', fr:'en raison d’une coupure de courant,' }],
  [/olumsuz\s+hava\s+koşulları\s+nedeniyle/gi,
    { en:'due to adverse weather conditions,', ar:'بسبب سوء الأحوال الجوية،', fr:'en raison de conditions météorologiques défavorables,' }],
  [/hava\s+muhalefeti\s+(?:nedeniyle|sebebiyle)/gi,
    { en:'due to adverse weather,', ar:'بسبب سوء الأحوال الجوية،', fr:'en raison du mauvais temps,' }],
  [/hava\s+muhalefeti/gi, { en:'adverse weather', ar:'سوء الأحوال الجوية', fr:'mauvais temps' }],
  [/olumsuz\s+hava\s+(?:şartları|koşulları)/gi,
    { en:'adverse weather', ar:'أحوال جوية سيئة', fr:'conditions météorologiques défavorables' }],
  [/hava\s+koşulları\s+nedeniyle/gi,
    { en:'due to weather conditions,', ar:'بسبب الأحوال الجوية،', fr:'en raison des conditions météorologiques,' }],
  [/yoğunluk\s+nedeniyle/gi, { en:'due to congestion,', ar:'بسبب الازدحام،', fr:'en raison de l’affluence,' }],
  /* "altyapı çalışmaları nedeniyle" reached the generic works rule below, which matched the
     "çalışmaları nedeniyle" inside it and left "altyapı" stranded in Turkish — the B2 alert
     shipped that way. Specific before generic, as everywhere else in this list. */
  [/altyapı\s+çalış(?:ması|maları)\s+(?:nedeniyle|sebebiyle)/gi,
    { en:'due to infrastructure works,', ar:'بسبب أعمال البنية التحتية،', fr:'en raison de travaux d’infrastructure,' }],
  [/altyapı\s+çalış(?:ması|maları)/gi,
    { en:'infrastructure works', ar:'أعمال البنية التحتية', fr:'travaux d’infrastructure' }],
  [/çalışmaları?\s+nedeniyle/gi, { en:'due to works,', ar:'بسبب الأعمال،', fr:'en raison de travaux,' }],
  [/(?:nedeniyle|sebebiyle|dolayısıyla)/gi, { en:'due to', ar:'بسبب', fr:'en raison de' }],
  // line/station nouns
  [/[Tt]eleferik\s+[Hh]attı(?:mız)?/gi, { en:'cable car line', ar:'خط التلفريك', fr:'ligne de téléphérique' }],
  [/[Ff]üniküler\s+[Hh]attı(?:mız)?/gi, { en:'funicular line', ar:'خط الفونيكولار', fr:'ligne de funiculaire' }],
  [/[Mm]etro\s+[Hh]attı(?:mız)?/gi,     { en:'metro line', ar:'خط المترو', fr:'ligne de métro' }],
  [/[Tt]ramvay\s+[Hh]attı(?:mız)?/gi,   { en:'tram line', ar:'خط الترام', fr:'ligne de tramway' }],
  [/[Bb]anliyö\s+[Hh]attı(?:mız)?/gi,   { en:'suburban line', ar:'خط الضواحي', fr:'ligne de banlieue' }],
  /* "B2 Halkalı–Bahçeşehir hattı" — Turkish and English both put the name before the noun,
     Arabic and French put it after. Anchored to the start of the announcement and limited to
     two tokens, which is the shape a line name actually takes ("B2 Halkalı–Bahçeşehir", "M2");
     "hattı" as part of a longer phrase falls through to the generic rules below.
     NOT \b after "hattı": JS word boundaries are ASCII-only, so ı/ş/ğ are already non-word
     characters and \b never fires between one and a following space. The lookahead spells the
     boundary out instead — with \b the rule matched nothing at all. */
  [/^\s*(\S+(?:\s+\S+)?)\s+[Hh]attı(?![A-Za-zÇĞİIÖŞÜçğıöşü])/,
    { en:'$1 line', ar:'خط $1', fr:'la ligne $1' }],
  [/[Hh]attımız/gi, { en:'our line', ar:'خطنا', fr:'notre ligne' }],
  [/[Hh]attında/gi, { en:'on the line', ar:'على الخط', fr:'sur la ligne' }],
  [/[Hh]attı/gi,    { en:'line', ar:'خط', fr:'ligne' }],
  [/[İi]stasyonumuzdan\b/gi, { en:'from our station', ar:'من محطتنا', fr:'depuis notre station' }],
  [/[İi]stasyonumuzda\b/gi,  { en:'at our station', ar:'في محطتنا', fr:'à notre station' }],
  // "Taksim istasyonumuz" — the name qualifies the noun, so it cannot simply be left in front
  [/(\S+)\s+[İi]stasyonumuz\b/g,
    { en:'our $1 station', ar:'محطتنا في $1', fr:'notre station $1' }],
  [/[İi]stasyonumuz\b/gi,    { en:'our station', ar:'محطتنا', fr:'notre station' }],
  // status clauses
  [/seferler(?:imiz)?\s+(?:geçici\s+(?:bir\s+)?süreyle\s+)?durdurul(?:muştur|du)/gi,
    { en:'services are temporarily suspended', ar:'أُوقفت الرحلات مؤقتًا', fr:'les trains sont temporairement interrompus' }],
  [/seferler(?:imiz)?\s+normale\s+dön(?:müştür|dü)/gi,
    { en:'services have returned to normal', ar:'عادت الرحلات إلى طبيعتها', fr:'les trains circulent de nouveau normalement' }],
  [/normale\s+dön(?:müştür|dü)/gi, { en:'has returned to normal', ar:'عاد إلى طبيعته', fr:'est revenu à la normale' }],
  [/geçici\s+(?:olarak|(?:bir\s+)?süreyle)\s+hizmet\s+dışıdır/gi,
    { en:'is temporarily out of service', ar:'خارج الخدمة مؤقتًا', fr:'est temporairement hors service' }],
  [/hizmet\s+dışına\s+alınmıştır/gi, { en:'has been taken out of service', ar:'أُخرج من الخدمة', fr:'a été mis hors service' }],
  [/hizmet\s+dışıdır/gi, { en:'is out of service', ar:'خارج الخدمة', fr:'est hors service' }],
  [/hizmet\s+dışı/gi,    { en:'out of service', ar:'خارج الخدمة', fr:'hors service' }],
  [/hizmete\s+kapatılmıştır/gi, { en:'has been closed to service', ar:'أُغلقت أمام الخدمة', fr:'a été fermée à l’exploitation' }],
  [/hizmete\s+(?:yeniden\s+)?alınmıştır/gi,
    { en:'has been brought back into service', ar:'أُعيد إلى الخدمة', fr:'a été remis en service' }],
  [/hizmet\s+ver(?:il)?memektedir/gi, { en:'is not in service', ar:'لا يقدّم الخدمة', fr:'n’est pas en service' }],
  [/hizmet\s+vermeye\s+(?:yeniden\s+)?başlamıştır/gi,
    { en:'has resumed service', ar:'استأنف الخدمة', fr:'a repris le service' }],
  [/geçici\s+(?:olarak|(?:bir\s+)?süreyle)\s+kapatılmıştır/gi,
    { en:'has been temporarily closed', ar:'أُغلقت مؤقتًا', fr:'a été temporairement fermée' }],
  /* "Kadıköy istasyonu kapalıdır" — again the name leads in Turkish and English and follows
     in Arabic and French, and here the noun's gender governs the adjective too, so the whole
     clause is spelled out rather than assembled from a noun rule and a separate "is closed". */
  [/^\s*(\S+(?:\s+\S+)?)\s+[İi]stasyon(?:u|umuz)?\s+kapalıdır/,
    { en:'$1 station is closed', ar:'محطة $1 مغلقة', fr:'La station $1 est fermée' }],
  [/[İi]stasyon(?:u|umuz)?\s+kapalıdır/gi, { en:'station is closed', ar:'المحطة مغلقة', fr:'la station est fermée' }],
  /* "çalışmamaktadır" contains "çalışma", so the generic noun rule further down would eat its
     stem and strand "maktadır" — the same half-eaten-word failure the locative rules below
     document. Negative and positive finite forms therefore come first. */
  [/çalışmamaktadır/gi, { en:'is not operating', ar:'لا يعمل', fr:'ne circule pas' }],
  [/çalışmaktadır/gi,   { en:'is operating', ar:'يعمل', fr:'circule' }],
  [/kapatılmıştır/gi, { en:'has been closed', ar:'أُغلقت', fr:'a été fermée' }],
  [/kapatılmış(?:tır)?/gi, { en:'closed', ar:'مغلق', fr:'fermé' }],
  /* Only the "seferler …" form of this was spelled out, so an announcement about a LINE being
     suspended split into a bare adverb and a bare verb and came out in Turkish order:
     "temporarily has been suspended", "مؤقتًا أُوقف". Adverb placement differs per language,
     so the clause is translated as a clause. */
  [/geçici\s+(?:(?:bir\s+)?süreyle|olarak)\s+durdurul(?:muştur|du)/gi,
    { en:'has been temporarily suspended', ar:'أُوقف مؤقتًا', fr:'est temporairement à l’arrêt' }],
  [/geçici\s+(?:bir\s+)?süreyle/gi, { en:'temporarily', ar:'مؤقتًا', fr:'temporairement' }],
  [/geçici\s+olarak/gi, { en:'temporarily', ar:'مؤقتًا', fr:'temporairement' }],
  [/aktarmalı\s+olarak/gi, { en:'with a transfer,', ar:'مع تحويل،', fr:'avec correspondance,' }],
  [/seferler(?:imiz|ini|ine|i)?/gi, { en:'trains', ar:'الرحلات', fr:'les trains' }],
  [/istasyonları\s+arasında/gi, { en:'between the stations', ar:'بين المحطات', fr:'entre les stations' }],
  [/arasında\s+yapılmaktadır/gi, { en:'operate between', ar:'تسير بين', fr:'circulent entre' }],
  [/yapılmaktadır/gi, { en:'are operating', ar:'تسير', fr:'circulent' }],
  [/yapıl(?:a)?mamaktadır/gi, { en:'cannot operate', ar:'لا يمكن تسييرها', fr:'ne peuvent pas circuler' }],
  /* The locative was missing, and the generic rules matched the "istasyonu" inside
     "istasyonunda" and left the "nda" stranded — real output was "Sanayi stationnda bir
     yolcunun…". A half-eaten word is worse than an untranslated one, so the inflected forms are
     spelled out FIRST (longest first, or the shorter stem consumes the stem and strands the
     suffix) and the general rules are \b-anchored: an inflection nobody listed now stays
     Turkish instead of becoming a non-word. */
  [/istasyonlarından/gi, { en:'from the stations', ar:'من المحطات', fr:'depuis les stations' }],
  [/istasyonlarında/gi,  { en:'at the stations', ar:'في المحطات', fr:'aux stations' }],
  [/[İi]stasyon(?:umuz|u)?ndan\b/gi, { en:'from the station', ar:'من المحطة', fr:'depuis la station' }],
  [/[İi]stasyondan\b/gi, { en:'from the station', ar:'من المحطة', fr:'depuis la station' }],
  [/[İi]stasyon(?:umuz|u)?nda\b/gi, { en:'at the station', ar:'في المحطة', fr:'à la station' }],
  [/[İi]stasyonda\b/gi, { en:'at the station', ar:'في المحطة', fr:'à la station' }],
  // \b would never fire here either — "istasyonları" ends in ı, which \b does not recognise
  [/istasyonları(?![A-Za-zÇĞİIÖŞÜçğıöşü])/gi, { en:'stations', ar:'المحطات', fr:'stations' }],
  [/[İi]stasyon(?:umuz|u)?\b/gi, { en:'station', ar:'محطة', fr:'station' }],
  [/aktarmalı/gi, { en:'with transfer', ar:'مع تحويل', fr:'avec correspondance' }],
  [/arasında/gi,  { en:'between', ar:'بين', fr:'entre' }],
  [/devam\s+etmektedir/gi, { en:'continues', ar:'مستمر', fr:'se poursuit' }],
  [/başlamıştır/gi, { en:'has started', ar:'بدأ', fr:'a commencé' }],
  [/kapalıdır/gi, { en:'is closed', ar:'مغلق', fr:'est fermé' }],
  [/açıktır/gi,   { en:'is open', ar:'مفتوح', fr:'est ouvert' }],
  [/[Oo]narım/gi, { en:'repair', ar:'إصلاح', fr:'réparation' }],
  [/[Bb]akım/gi,  { en:'maintenance', ar:'صيانة', fr:'entretien' }],
  [/arıza/gi,     { en:'fault', ar:'عطل', fr:'panne' }],
  [/çalışmaları/gi, { en:'works', ar:'أعمال', fr:'travaux' }],
  [/çalışması/gi,   { en:'works', ar:'أعمال', fr:'travaux' }],
  [/çalışma/gi,     { en:'work', ar:'عمل', fr:'travaux' }],
  [/vatandaşlarımız(?:ın|a|ı)?/gi, { en:'passengers', ar:'الركاب', fr:'les voyageurs' }],
  [/yolcularımız(?:ın|a|ı)?/gi,    { en:'passengers', ar:'الركاب', fr:'les voyageurs' }],
  [/(?:sayın\s+)?yolcular(?:ımız)?/gi, { en:'passengers', ar:'الركاب الكرام', fr:'les voyageurs' }],
  [/bilgi(?:lerinize|nize)\s+(?:saygıyla\s+)?sunulur/gi,
    { en:'for your information', ar:'للعلم', fr:'pour information' }],
  [/durdurul(?:muştur|du)/gi, { en:'has been suspended', ar:'أُوقف', fr:'a été suspendu' }],
];
// whole-word cleanup for the odd straggler the phrase rules missed (base forms only)
const TR_WORDS = {
  've':      { en:'and', ar:'و', fr:'et' },
  'ile':     { en:'with', ar:'مع', fr:'avec' },
  'için':    { en:'for', ar:'من أجل', fr:'pour' },
  'olarak':  { en:'as', ar:'بصفة', fr:'en tant que' },
  'ancak':   { en:'however', ar:'غير أن', fr:'toutefois' },
  'ayrıca':  { en:'also', ar:'كذلك', fr:'également' },
  'ise':     { en:'while', ar:'بينما', fr:'tandis que' },
  'teleferik':{ en:'cable car', ar:'التلفريك', fr:'téléphérique' },
  'füniküler':{ en:'funicular', ar:'الفونيكولار', fr:'funiculaire' },
  'metro':   { en:'metro', ar:'المترو', fr:'métro' },
  'tramvay': { en:'tram', ar:'الترام', fr:'tramway' },
  'vapur':   { en:'ferry', ar:'العبّارة', fr:'ferry' },
  'banliyö': { en:'suburban', ar:'الضواحي', fr:'banlieue' },
  'hat':     { en:'line', ar:'خط', fr:'ligne' },
  'sefer':   { en:'service', ar:'رحلة', fr:'circulation' },
  'seferler':{ en:'services', ar:'الرحلات', fr:'circulations' },
  'yön':     { en:'direction', ar:'اتجاه', fr:'sens' },
  'yönünde': { en:'toward', ar:'باتجاه', fr:'en direction de' },
  'yönü':    { en:'direction', ar:'اتجاه', fr:'sens' },
  'saatleri':{ en:'hours', ar:'ساعات', fr:'heures' },
  'saatlerinde':{ en:'hours', ar:'ساعات', fr:'heures' },
  'gün':     { en:'day', ar:'يوم', fr:'jour' },
  'saat':    { en:'hour', ar:'ساعة', fr:'heure' },
  'dakika':  { en:'minutes', ar:'دقائق', fr:'minutes' },
  'süreyle': { en:'temporarily', ar:'مؤقتًا', fr:'temporairement' },
  'geçici':  { en:'temporary', ar:'مؤقت', fr:'temporaire' },
  'planlı':  { en:'planned', ar:'مخطّط', fr:'programmé' },
  'planlanan':{ en:'planned', ar:'مخطّط', fr:'programmé' },
  'altyapı': { en:'infrastructure', ar:'البنية التحتية', fr:'infrastructure' },
  'kapalı':  { en:'closed', ar:'مغلق', fr:'fermé' },
  'açık':    { en:'open', ar:'مفتوح', fr:'ouvert' },
  'kapatıldı':{ en:'closed', ar:'أُغلق', fr:'fermé' },
  'yeniden': { en:'again', ar:'مجددًا', fr:'de nouveau' },
  'normal':  { en:'normal', ar:'طبيعي', fr:'normal' },
  'aksama':  { en:'disruption', ar:'اضطراب', fr:'perturbation' },
  'arıza':   { en:'fault', ar:'عطل', fr:'panne' },
  'bakım':   { en:'maintenance', ar:'صيانة', fr:'entretien' },
  'onarım':  { en:'repair', ar:'إصلاح', fr:'réparation' },
  'çalışıyor':{ en:'operating', ar:'يعمل', fr:'en service' },
  'çalışmıyor':{ en:'not operating', ar:'لا يعمل', fr:'hors service' },
  'durduruldu':{ en:'suspended', ar:'أُوقف', fr:'suspendu' },
  'başladı': { en:'started', ar:'بدأ', fr:'a commencé' },
  'bitti':   { en:'ended', ar:'انتهى', fr:'terminé' },
  'emniyeti':{ en:'Police', ar:'مديرية الأمن', fr:'la Police' },
  'emniyetinin':{ en:'Police', ar:'مديرية الأمن', fr:'la Police' },
  'valiliği':{ en:'Governorship', ar:'الولاية', fr:'la Préfecture' },
  'belediyesi':{ en:'Municipality', ar:'البلدية', fr:'la Municipalité' },
  'talebi':  { en:'request', ar:'طلب', fr:'demande' },
  'nedeni':  { en:'reason', ar:'سبب', fr:'motif' },
  'güvenlik':{ en:'security', ar:'أمن', fr:'sécurité' },
  'etkinlik':{ en:'event', ar:'فعالية', fr:'événement' },
  'maç':     { en:'match', ar:'مباراة', fr:'match' }
};
const TR_TARGETS = ['en', 'ar', 'fr'];
/* Turkish is verb-final and puts both the transfer clause and the reason before the thing
   they qualify; none of the three destinations reads that way. Substitution alone therefore
   produces grammatical words in Turkish order — "B2 Halkalı–Bahçeşehir line due to
   infrastructure works, is not operating" — which is understandable but is not how any of
   these languages writes it. These run last, on our own output, so each pattern is written
   in the language it repairs rather than in Turkish. */
const TR_REORDER = {
  en: [
    [/trains\s+with a transfer at (.+?),\s*operate between (.+?)[.\s]*$/i,
     'trains operate between $2, with a transfer at $1.'],
    /* subject + reason + predicate -> subject + predicate + reason. The reason phrase is
       captured whole, prefix included, rather than reassembled: French elides ("en raison
       d’une panne"), so a pattern that expected the uncontracted preposition matched nothing
       and left the sentence in Turkish order. */
    [/^\s*(?!due to)(.+?)\s+(due to [^,]*),\s*(.+?)[.\s]*$/i, '$1 $3 $2.']
  ],
  fr: [
    [/les trains\s+avec correspondance à (.+?),\s*circulent entre (.+?)[.\s]*$/i,
     'les trains circulent entre $2, avec correspondance à $1.'],
    [/^\s*(?!en raison d)(.+?)\s+(en raison d(?:e|’|')[^,]*),\s*(.+?)[.\s]*$/i, '$1 $3 $2.']
  ],
  ar: [
    [/الرحلات\s+مع تحويل في (.+?)،\s*تسير بين (.+?)[.\s]*$/,
     'تسير الرحلات بين $2، مع تحويل في $1.'],
    [/^\s*(?!بسبب)(.+?)\s+(بسبب [^،]*)،\s*(.+?)[.\s]*$/, '$1 $3 $2.']
  ]
};
function translateTR(text, target){
  const tgt = TR_TARGETS.indexOf(target) >= 0 ? target : 'en';
  let s=' '+text+' ';
  for(const [re,rep] of TR_PHRASES) s=s.replace(re, rep[tgt]);
  // whole-word stragglers (base forms only; station/line names pass through unchanged)
  s=s.replace(/[A-Za-zÇĞİıÖŞÜçğöşü]+/g, w=>{ const k=w.toLocaleLowerCase('tr');
                                             return (TR_WORDS[k] && TR_WORDS[k][tgt]) || w; });
  for(const [re,rep] of (TR_REORDER[tgt]||[])) s = s.replace(re, rep);
  s=s.replace(/\s+([,،])/g,'$1').replace(/([,،])\s*[,،]/g,'$1').replace(/\s{2,}/g,' ').replace(/\s+\./g,'.').trim();
  // Arabic is caseless; capitalising its first character is a no-op, but doing it only where
  // it means something keeps the intent legible.
  if(tgt !== 'ar') s=s.charAt(0).toUpperCase()+s.slice(1);
  if(s && !/[.!?]$/.test(s)) s+='.';
  return s;
}

// residual-Turkish detector: if the phrase translator left transit jargon untranslated,
// fall back to an LLM (only when ANTHROPIC_API_KEY is set — otherwise skipped).
const TR_RESIDUAL=/\b(nedeniyle|sebebiyle|istasyon\w*|seferler\w*|yapıl\w*|aktarma\w*|kapal\w*|kapat\w*|çalışm\w*|arası\w*|durdurul\w*|hizmet|geçici|yönünde|güzergah\w*|yoğunluk|doğrultusunda|talebi|hattı\w*|teleferik|füniküler|vatandaş\w*|yolcu\w*|muhalefet\w*|olumsuz|şartlar\w*|koşullar\w*|arıza\w*|bakım|onarım|bilgilerinize|sayın|değerli|ulaşım|sefer)\b/i;
const hasResidualTurkish = s => TR_RESIDUAL.test(s||'');

/* --- how much of the announcement did the rules actually reach? ---------------------------
   hasResidualTurkish is a keyword list, so it answers "is ANY known Turkish left" — the wrong
   question in both directions. One stray "hizmet" condemns an otherwise clean sentence, and
   vocabulary nobody thought to list sails straight through. A real M2 alert shipped as

     "Sanayi at the station bir yolcunun intihar girişiminde bulunması due to Sanayi our
      station işletmeye has been closed."

   — half of each language and readable in neither, because not one of "bir / yolcunun /
   intihar / girişiminde / bulunması / işletmeye" is on the list.

   What matters is the PROPORTION, and it can be measured exactly rather than sniffed at:
   every word translateTR is capable of producing comes from the replacement side of the two
   tables above. So a word in the output that is not in that vocabulary, and is not a proper
   noun, is BY CONSTRUCTION source text that no rule matched. No language detection, and no
   word list that has to be kept in step with the rules by hand. */
/* letter-initial, so dates and numbers are not words; digits allowed, so "M2"/"T1" stay whole.
   Accented Latin is in the class for French and the Arabic block for Arabic — a tokeniser that
   split "météorologiques" or skipped "الرحلات" would score those languages as untranslated. */
const TR_TOKEN  = /[A-Za-zÀ-ÖØ-öø-ÿÇĞİIÖŞÜçğıöşü؀-ۿ][A-Za-zÀ-ÖØ-öø-ÿÇĞİIÖŞÜçğıöşü0-9'’؀-ۿ]*/g;
const TR_CAPPED = /^[A-ZÀ-ÖØ-ÞÇĞİIÖŞÜ]/;
const TR_ARABIC = /[؀-ۿ]/;

const TR_EMITTED = (function(){
  const out = {};
  for(const tgt of TR_TARGETS){
    const set = new Set();
    const add = str => { for(const w of (String(str).replace(/\$\d/g,' ').match(TR_TOKEN)||[])){
                           set.add(w.toLowerCase()); set.add(w.toLocaleLowerCase('tr')); } };
    for(const rule of TR_PHRASES) add(rule[1][tgt]);
    for(const k in TR_WORDS) add(TR_WORDS[k][tgt]);
    for(const ro of (TR_REORDER[tgt]||[])) add(ro[1]);
    out[tgt] = set;
  }
  return out;
})();

/* Share of the classifiable words in `out` that are still Turkish, 0..1.
   `names` are this alert's station and line names: they pass through untranslated BY DESIGN
   and must never count against coverage. Capitalised words are read as proper nouns and left
   out of the count entirely — including the first word, whose capital was put there by
   translateTR itself and so says nothing about what it is. Leaving a word out is the honest
   move where we cannot classify it: it neither excuses the rules nor condemns them. */
function turkishShare(out, names, target){
  const tgt = TR_TARGETS.indexOf(target) >= 0 ? target : 'en';
  const known = new Set();
  for(const n of (names||[]))
    for(const w of (String(n).match(TR_TOKEN)||[])) known.add(w.toLocaleLowerCase('tr'));
  let translated=0, turkish=0;
  for(const w of (String(out||'').match(TR_TOKEN)||[])){
    const k = w.toLocaleLowerCase('tr');
    if(known.has(k)) continue;                  // a station or line name


    /* Arabic script in the output can only have come from our own replacement tables, so it
       is translated by construction. This is not merely a shortcut for the vocabulary lookup
       below: Arabic و is a proclitic and attaches to the word after it, so the tokeniser sees
       "وMahmutbey" as ONE word — absent from the Arabic vocabulary, absent from the list of
       station names, and not Latin-capitalised, so without this it is scored as source text
       nobody translated. Every station named after a conjunction cost coverage. */
    if(TR_ARABIC.test(w)){ translated++; continue; }
    if(TR_EMITTED[tgt].has(k)){ translated++; continue; }
    if(TR_CAPPED.test(w)) continue;             // proper noun (or, on word one, unknowable)
    turkish++;                                  // source text no rule touched
  }
  return (translated+turkish) ? turkish/(translated+turkish) : 0;
}
/* Past this share the hybrid is worse than either language, so the original ships instead.
   A quarter sits in a wide empty gap: the formulaic alerts the rules DO cover measure 0.00
   to 0.17, and the ones they do not measure 0.37 and up. Nothing real lands between. */
const TR_FALLBACK_SHARE = 0.25;

/* The one decision the scraper and the app both make about an announcement.
   It never invents a translation. Where the rules fall short it returns the CLEAN ORIGINAL,
   flagged lang:'tr' so the UI can say so, instead of passing a half-translation off as one.
   The judgement is made per destination language: the rules can cover an announcement well
   enough in one language and not in another, and each reader is owed the honest answer for
   the language they are actually reading. */
function bestEffortTranslation(tr, names, target){
  const tgt   = TR_TARGETS.indexOf(target) >= 0 ? target : 'en';
  const src   = String(tr||'').trim();
  const out   = translateTR(src, tgt);
  const share = turkishShare(out, names, tgt);
  return share > TR_FALLBACK_SHARE ? { text:src, lang:'tr', share:share }
                                   : { text:out, lang:tgt, share:share };
}
// the English-only entry point the scraper and the older call sites use
function bestEffortEnglish(tr, names){ return bestEffortTranslation(tr, names, 'en'); }
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
    // refine both what the rules mangled and what they gave up on entirely
    if(!e.messageTr || !(e.messageLang==='tr' || hasResidualTurkish(e.message))) continue;
    const en=await llmTranslate(e.messageTr);
    if(en){ e.message=en; e.messageLang='en'; e.translatedBy='llm'; }
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
    // A segment needs two DIFFERENT ends. Emitting from===to produced a zero-length section
    // that drew no caution band at all and pushed the ⚠ to the middle of the line.
    const uniq=[...new Set(stations.filter(Boolean))];
    if(uniq.length>=2){ e.scope='segment'; e.from=uniq[0]; e.to=uniq[uniq.length-1]; }
    else if(uniq.length===1){ e.scope='stations'; e.stations=[uniq[0]]; }
    else { e.scope='line'; }
    e.severity=severity; e.title=title;
    e.messageTr=desc;              // keep the authoritative original
    // If the phrase table only got half of it, the result is a Turkish-English hybrid like
    // "Hava muhalefeti due to services cannot operate." — worse than either language alone.
    // bestEffortEnglish measures how much of it the rules actually reached and ships the clean
    // original when the answer is "not enough"; llmRefine still upgrades it when a key is
    // available, and the client re-runs the same decision on load, so a later phrase rule
    // repairs it in place. The station and line names go in so they are not mistaken for
    // untranslated Turkish — they are supposed to stay exactly as the operator wrote them.
    const best = bestEffortEnglish(desc, uniq.concat([lineName, ref]));
    e.message = best.text;
    e.messageLang = best.lang;                   // 'tr' = the rules did not cover this one
    if(best.lang === 'tr') e.translatedBy = 'none';
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
        const trText=decode(t.text);
        const best=bestEffortEnglish(trText, [user]);
        out.push({ id:slug('x-'+user+'-'+t.id).slice(0,40), ref:null, scope:'note',
                   severity:'minor', title:'@'+user, message:best.text, messageTr:trText,
                   messageLang:best.lang, source:'x:@'+user, untilText:null });
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
