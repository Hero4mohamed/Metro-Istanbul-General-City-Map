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
  /* A partial closure is announced as two clauses — normal running on one stretch, a shuttle on the other:
     "seferler A-B arasında normal işletme döngüsünde, C-D arasında ise mekik seferi olarak yapılmaktadır".
     Neither clause names the stations as "istasyonları", so the rules above missed them, and the word-level map
     turned the sentence into "trains Nurtepe-Mahmutbey between normal işletme döngüsünde …" — a real M7 alert
     that sat in the Announcements panel like that. Each clause is spelled out, in the reader's own word order. */
  [/(?:seferler(?:imiz)?\s+)?([^\s,]+)\s*[-–]\s*([^\s,]+)\s+arasında\s+normal\s+işletme\s+döngüsünde/gi,
    { en:'trains run normally between $1 and $2', ar:'تسير القطارات بشكل طبيعي بين $1 و$2', fr:'les trains circulent normalement entre $1 et $2' }],
  [/([^\s,]+)\s*[-–]\s*([^\s,]+)\s+arasında\s+ise\s+mekik\s+seferi\s+olarak(?:\s+yapılmaktadır)?/gi,
    { en:'and as a shuttle between $1 and $2', ar:'وبنظام المكوك بين $1 و$2', fr:'et en navette entre $1 et $2' }],
  /* A line closed for works with a replacement service, as metro.istanbul words it (the T3 notice):
     "Hat bakım ve ray yenileme çalışmaları nedeniyle hattımız işletmeye kapalıdır. Çalışma süresince
     İETT’ye ait elektrikli araçlar ile hizmet verilecektir." Neither sentence was in the table, so the
     notice reached the Announcements panel in Turkish. The leading "Hat" only names the subject (the next
     clause says "hattımız"), so the reason rule swallows it. "Çalışma süresince" opens its own sentence, so
     it captures the full stop before it and keeps its capital — the reason rules around it are lowercase
     because they sit mid-sentence, and nothing else here capitalises a second sentence. */
  [/^\s*(?:Hat\s+)?bakım\s+ve\s+ray\s+yenileme\s+çalışmaları\s+(?:nedeniyle|sebebiyle)/i,
    { en:'due to maintenance and track renewal works,', ar:'بسبب أعمال الصيانة وتجديد السكك،',
      fr:'en raison de travaux d’entretien et de renouvellement des voies,' }],
  [/ray\s+yenileme\s+çalışma(?:sı|ları)\s+(?:nedeniyle|sebebiyle)/gi,
    { en:'due to track renewal works,', ar:'بسبب أعمال تجديد السكك،', fr:'en raison de travaux de renouvellement des voies,' }],
  [/hattımız\s+[İi]şletmeye\s+kapalıdır/gi,
    { en:'our line is closed to service', ar:'خطنا مغلق أمام الخدمة', fr:'notre ligne est fermée à l’exploitation' }],
  [/[İi]şletmeye\s+kapalıdır/gi,
    { en:'is closed to service', ar:'مغلق أمام الخدمة', fr:'est fermé à l’exploitation' }],
  [/(^\s*|[.!?]\s+)[Çç]alışma\s+süresince/g,
    { en:'$1For the duration of the works,', ar:'$1خلال فترة الأعمال،', fr:'$1Pendant la durée des travaux,' }],
  [/([A-Za-zÇĞİÖŞÜçğıöşü]+)['’]\s*y?[ea]\s+ait\s+elektrikli\s+araçlar\s+ile\s+hizmet\s+verilecektir/gi,
    { en:'service will be provided by $1 electric vehicles', ar:'ستُقدَّم الخدمة بمركبات كهربائية تابعة لـ$1',
      fr:'le service sera assuré par des véhicules électriques de $1' }],
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
  /* "Elektrik dağıtım kurumu kaynaklı yaşanan enerji kesintisi nedeniyle" (the TF1 notice): the cause is the electricity
     distributor's, not the railway's, and says so. Named before the plain power-cut rules so the whole clause goes at once. */
  [/elektrik\s+dağıtım\s+kurumu\s+kaynaklı\s+(?:yaşanan\s+)?(?:enerji|elektrik)\s+kesintisi\s+(?:nedeniyle|sebebiyle)/gi,
    { en:'due to a power outage originating with the electricity distribution company,',
      ar:'بسبب انقطاع في التيار الكهربائي ناجم عن شركة توزيع الكهرباء،',
      fr:'en raison d’une coupure de courant imputable au distributeur d’électricité,' }],
  [/enerji\s+kesintisi\s+(?:nedeniyle|sebebiyle)/gi,
    { en:'due to a power outage,', ar:'بسبب انقطاع التيار الكهربائي،', fr:'en raison d’une coupure de courant,' }],
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
/* --- Şehir Hatları (the city ferries) ----------------------------------------------------------
   The ferry operator writes its notices in a few fixed shapes: a timetable change ("A kalkış saati: 15.40 yerine
   16.10"), an event that re-routes or cancels trips, extra trips, a season change, a stop restored. Unlike a rail
   fault they carry TIMES and DATES, which is where a wrong guess does real harm — so these are whole-sentence
   templates that carry every number across untouched, they run only for ferry notices (the rail rules above would
   turn "seferleri" into "trains"), and bestEffortTranslation refuses any result whose numbers differ from the
   original. Wording outside these shapes is not guessed at: it falls through to the coverage check and is shown
   in Turkish, flagged, exactly as a rail notice the rules cannot read is.
   Month and weekday names are left in place by the rules and turned into words by the word table below — which is
   why a rule only has to say where the date goes, not what the month is called. */
const TR_FD_DATE = '(\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?\\s+[A-Za-zÇĞİÖŞÜçğıöşü]+(?:\\s+\\d{4})?)';   // "12 Ekim 2026", "12-13 Eylül 2026", "7 Eylül"
const TR_FD_DAY  = '(Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar)';
const TR_FD_TODAY = '(?:\\s*\\((?:[Bb]ugün|[Yy]arın)\\))?';                // the operator's "(Bugün)" on the day itself
const TR_FD_TXT  = '((?:[^.;]|\\d\\.)+?)';                                // free text inside one sentence; "38. Yarışı" keeps its dot
/* A name is one or two CAPITALISED words, and never reaches over a comma or semicolon — ASCII or Arabic. Those limits
   matter because the templates run one after another on the same string: with a looser class a name capture swallowed
   the Arabic "ذلك،" an earlier rule had just written and put it inside a line name. Rules that use these are compiled
   without the i flag, which would make [A-Z] match lowercase too. */
const TR_FD_CAP  = 'A-ZÇĞİÖŞÜ';
const TR_FD_NAME = '((?:[' + TR_FD_CAP + '][^\\s,;،؛]*\\s+)?[' + TR_FD_CAP + '][^\\s,;،؛]*)';   // "Heybeliada", "Anadolu Kavağı", "Üsküdar-Haliç"
const TR_FD_PLACE = '((?:[' + TR_FD_CAP + '][^\\s,.;،؛]*\\s+)?[' + TR_FD_CAP + '][^\\s,.;،؛]*)[\'’ʼ](?:nda|nde|da|de|ta|te)';   // "Beşiktaş Stadyumu’nda", "Haliç’te"
const TR_FD_VERB = '(?:düzenlenecek|gerçekleştirilecek|yapılacak|düzenlenen|gerçekleştirilen)(?:\\s+olan)?';
const TR_FD_WHY  = '(?:sebebiyle|nedeniyle)';
/* "<date> [<weekday> günü | tarihinde] [<place>’da] düzenlenecek <event> sebebiyle" — four spellings of one clause,
   differing only in whether a weekday and a place are named, so they are generated rather than written four times. */
function trFerryEventRules(){
  const out = [];
  [true, false].forEach(function(hasPlace){ [true, false].forEach(function(hasDay){
    const re = new RegExp(TR_FD_DATE + TR_FD_TODAY + '\\s+' + (hasDay ? TR_FD_DAY + '\\s+günü' : 'tarihinde') + '\\s+' +
                          (hasPlace ? TR_FD_PLACE + '\\s+' : '') + TR_FD_VERB + '\\s+' + TR_FD_TXT + '\\s+' + TR_FD_WHY, 'g');
    const day = hasDay ? 2 : 0, place = hasPlace ? (hasDay ? 3 : 2) : 0, ev = 1 + (hasDay ? 1 : 0) + (hasPlace ? 1 : 0) + 1;
    out.push([re, {
      en:'due to the $' + ev + ' on ' + (day ? '$' + day + ' ' : '') + '$1' + (place ? ' at $' + place : '') + ',',
      ar:'بسبب $' + ev + ' ' + (day ? 'يوم $' + day + ' ' : 'بتاريخ ') + '$1' + (place ? ' في $' + place : '') + '،',
      // "de l’événement suivant :" because the event arrives as a bare name or a bare noun ("concert") with no article to agree with
      fr:'en raison de l’événement suivant : $' + ev + ', ' + (day ? 'le $' + day + ' ' : 'le ') + '$1' + (place ? ' à $' + place : '') + ','
    }]);
  }); });
  return out;
}
const TR_FERRY = [
  // official bodies and tours the notices name (proper names, so the words inside them must not be translated one by one)
  [/Ulaştırma\s+ve\s+Altyapı\s+Bakanlığı\s+[İi]stanbul\s+Bölge\s+Liman\s+Başkanlığı/gi,
    { en:'the İstanbul Regional Harbour Master’s Office of the Ministry of Transport and Infrastructure',
      ar:'رئاسة ميناء إسطنبول الإقليمية التابعة لوزارة النقل والبنية التحتية',
      fr:'la capitainerie régionale d’İstanbul du ministère des Transports et des Infrastructures' }],
  [/Ulaştırma\s+ve\s+Altyapı\s+Bakanlığı/gi,
    { en:'the Ministry of Transport and Infrastructure', ar:'وزارة النقل والبنية التحتية', fr:'le ministère des Transports et des Infrastructures' }],
  [/[İi]stanbul\s+Valiliği/gi, { en:'İstanbul Governorate', ar:'محافظة إسطنبول', fr:'la préfecture d’İstanbul' }],
  [/Gençlik\s+ve\s+Spor\s+[İi]l\s+Müdürlüğü/gi,
    { en:'the Provincial Directorate of Youth and Sports', ar:'مديرية الشباب والرياضة بالولاية', fr:'la direction provinciale de la jeunesse et des sports' }],
  [/[İi]stanbul\s+Büyükşehir\s+Belediyesi/gi,
    { en:'İstanbul Metropolitan Municipality', ar:'بلدية إسطنبول الكبرى', fr:'la municipalité métropolitaine d’İstanbul' }],
  [/uzun\s+Boğaz\s+Turu/gi, { en:'the long Bosphorus Tour', ar:'جولة البوسفور الطويلة', fr:'le long tour du Bosphore' }],
  // season change: "<operator>’nin yaz tarifesi sona eriyor. Yeni düzenlenen kış tarifesi D1 ile D2 tarihleri arasında uygulanacak."
  [/([^\s.;][^.;]*?)\s+iştiraki\s+(Şehir\s+Hatları\s+AŞ)[’']nin\s+(yaz|kış)\s+tarifesi\s+sona\s+eriyor/gi,
    { en:'the $3 timetable of $2, an affiliate of $1, is ending',
      ar:'ينتهي جدول $3 الخاص بـ$2 التابعة إلى $1',
      fr:'l’horaire d’$3 de $2, filiale de $1, prend fin' }],
  [new RegExp('[Yy]eni\\s+düzenlenen\\s+(yaz|kış)\\s+tarifesi,?\\s*' + TR_FD_DATE + '\\s+(?:ile|[-–])\\s*' + TR_FD_DATE + '\\s+tarihleri\\s+arasında\\s+uygulanacak', 'gi'),
    { en:'the newly arranged $1 timetable will apply between $2 and $3',
      ar:'سيُطبَّق جدول $1 الجديد في الفترة بين $2 و$3',
      fr:'le nouvel horaire d’$1 s’appliquera entre le $2 et le $3' }],
  [new RegExp(TR_FD_DATE + '\\s+' + TR_FD_DAY + '\\s+gününden\\s+itibaren\\s+(yaz|kış)\\s+tarifesine\\s+geçiyor', 'gi'),
    { en:'is switching to the $3 timetable from $2 $1', ar:'تنتقل إلى جدول $3 اعتبارًا من يوم $2 $1', fr:'passe à l’horaire d’$3 à partir du $2 $1' }],
  [new RegExp(TR_FD_DATE + '\\s+itibarıyla\\s+(yaz|kış)\\s+tarifesine\\s+geçiyor', 'gi'),
    { en:'is switching to the $2 timetable as of $1', ar:'تنتقل إلى جدول $2 اعتبارًا من $1', fr:'passe à l’horaire d’$2 à compter du $1' }],
  [/Avrupa[’']nın\s+en\s+büyük\s+toplu\s+deniz\s+ulaşım\s+sağlayıcısı\s+olan\s+ve\s+Şirket-i\s+Hayriye[’']den\s+bu\s+yana\s+(\d+)\s+yıldır\s+[İi]stanbul[’']da\s+deniz\s+ulaşımı\s+hizmeti\s+veren\s+(Şehir\s+Hatları)/gi,
    { en:'$2, Europe’s largest public sea transport provider, which has provided sea transport in İstanbul for $1 years, since the Şirket-i Hayriye,',
      ar:'$2، أكبر مزوّد للنقل البحري العام في أوروبا، التي تقدّم خدمة النقل البحري في إسطنبول منذ $1 عامًا، أي منذ Şirket-i Hayriye،',
      fr:'$2, premier opérateur européen de transport maritime public, qui assure le transport maritime à İstanbul depuis $1 ans, depuis la Şirket-i Hayriye,' }],
  // a timetable change
  [/([^\s,;:.،؛]+)\s+Hattı[’']ndaki\s+(\S+)\s+seferinin\s+saatleri,?\s*/gi,
    { en:'the times of the $2 trip on the $1 line ', ar:'مواعيد رحلة $2 على خط $1 ', fr:'les horaires de la traversée $2 sur la ligne $1 ' }],
  [/Güncel\s+sefer\s+saatleri\s+aşağıda\s+belirtilmiştir/gi,
    { en:'The current trip times are listed below', ar:'مواعيد الرحلات الحالية مبيّنة أدناه', fr:'Les horaires actuels sont indiqués ci-dessous' }],
  [new RegExp(TR_FD_NAME + '\\s+kalkış\\s+saati:\\s*(\\d{1,2}[.:]\\d{2})\\s+yerine\\s+(\\d{1,2}[.:]\\d{2})', 'g'),
    { en:'$1 departure: $3 instead of $2', ar:'المغادرة من $1: $3 بدلًا من $2', fr:'départ de $1 : $3 au lieu de $2' }],
  [new RegExp(TR_FD_NAME + '\\s+varış\\s+saati:\\s*(\\d{1,2}[.:]\\d{2})\\s+yerine\\s+(\\d{1,2}[.:]\\d{2})', 'g'),
    { en:'$1 arrival: $3 instead of $2', ar:'الوصول إلى $1: $3 بدلًا من $2', fr:'arrivée à $1 : $3 au lieu de $2' }],
  // an authority's decision, and the event behind it
  [/([^\s.;][^.;]*?)\s+tarafından\s+alınan\s+karar\s+doğrultusunda,?/gi,
    { en:'in line with the decision taken by $1,', ar:'وفقًا للقرار الصادر عن $1،', fr:'conformément à la décision prise par $1,' }],
  ...trFerryEventRules(),
  // "<place>’da düzenlenecek <event> sebebiyle" — the event first, the date later in the sentence
  [new RegExp(TR_FD_PLACE + '\\s+' + TR_FD_VERB + '\\s+' + TR_FD_TXT + '\\s+' + TR_FD_WHY + ',?', 'g'),
    { en:'due to the $2 at $1,', ar:'بسبب $2 في $1،', fr:'en raison de l’événement suivant : $2, à $1,' }],
  [/Sınava\s+girecek\s+tüm\s+öğrencilere\s+başarılar\s+dileriz/gi,
    { en:'We wish all students taking the exam success', ar:'نتمنى النجاح لجميع الطلاب المتقدمين للامتحان', fr:'Nous souhaitons bonne réussite à tous les élèves qui passent l’examen' }],
  [new RegExp(TR_FD_DATE + '\\s+tarihlerinde\\s+aşağıda\\s+detayları\\s+(?:belirtilen|verilen)\\s+seferlerde\\s+düzenlemeler\\s+yapılmıştır', 'gi'),
    { en:'adjustments have been made to the trips detailed below on $1',
      ar:'أُجريت تعديلات على الرحلات المبيّنة أدناه بتاريخ $1',
      fr:'des modifications ont été apportées aux traversées détaillées ci-dessous aux dates du $1' }],
  [/Bu\s+kapsamda;?/gi, { en:'Accordingly,', ar:'وبناءً على ذلك،', fr:'En conséquence,' }],
  // "<line> Hattı seferleri [ise] <pier> İskelesi’ne [kadar gerçekleştirilecektir]" — the last clause carries the verb for all
  [new RegExp(TR_FD_NAME + '\\s+Hattı\\s+seferleri\\s+ise\\s+' + TR_FD_NAME + '\\s+[İi]skelesi[\'’]ne\\s+kadar\\s+gerçekleştirilecektir', 'g'),
    { en:'while $1 line trips will run as far as $2 Pier', ar:'بينما ستسير رحلات خط $1 حتى رصيف $2', fr:'tandis que les traversées de la ligne $1 iront jusqu’à l’embarcadère de $2' }],
  [new RegExp(TR_FD_NAME + '\\s+Hattı\\s+seferleri\\s+' + TR_FD_NAME + '\\s+[İi]skelesi[\'’]ne\\s+kadar\\s+gerçekleştirilecektir', 'g'),
    { en:'$1 line trips will run as far as $2 Pier', ar:'ستسير رحلات خط $1 حتى رصيف $2', fr:'les traversées de la ligne $1 iront jusqu’à l’embarcadère de $2' }],
  [new RegExp(TR_FD_NAME + '\\s+Hattı\\s+seferleri\\s+' + TR_FD_NAME + '\\s+[İi]skelesi[\'’]ne,', 'g'),
    { en:'$1 line trips will run as far as $2 Pier,', ar:'ستسير رحلات خط $1 حتى رصيف $2،', fr:'les traversées de la ligne $1 iront jusqu’à l’embarcadère de $2,' }],
  // trips that cannot run, and lines where arrangements were made
  [/aşağıda\s+detayları\s+(?:verilen|belirtilen)\s+seferlerimiz\s+ve\s+(.+?)\s+gerçekleştirilemeyecektir/gi,
    { en:'the trips detailed below and $1 cannot be run', ar:'لا يمكن تنفيذ الرحلات المبيّنة أدناه و$1', fr:'les traversées détaillées ci-dessous et $1 ne pourront pas être assurées' }],
  [/aşağıda\s+detayları\s+(?:verilen|belirtilen)\s+seferlerimiz\s+gerçekleştirilemeyecektir/gi,
    { en:'the trips detailed below cannot be run', ar:'لا يمكن تنفيذ الرحلات المبيّنة أدناه', fr:'les traversées détaillées ci-dessous ne pourront pas être assurées' }],
  [/([^\s.;][^.;]*?)\s+Hattı[’']nda\s+ise\s+aşağıda\s+detayları\s+(?:verilen|belirtilen)\s+seferler\s+gerçekleştirilemeyecektir/gi,
    { en:'on the $1 line the trips detailed below cannot be run', ar:'وعلى خط $1 لا يمكن تنفيذ الرحلات المبيّنة أدناه', fr:'sur la ligne $1, les traversées détaillées ci-dessous ne pourront pas être assurées' }],
  [/aşağıda\s+belirtilen\s+([^\s.;][^.;]*?)\s+Hattı[’']nda\s+düzenlemeler\s+gerçekleştirilmiştir/gi,
    { en:'adjustments have been made on the $1 line, as detailed below', ar:'أُجريت تعديلات على خط $1 كما هو مبيّن أدناه', fr:'des modifications ont été apportées sur la ligne $1, comme indiqué ci-dessous' }],
  // extra trips
  [new RegExp(TR_FD_DATE + TR_FD_TODAY + '\\s+([“"][^”"]+[”"])\\s+kapsamında\\s+(\\d{1,2}[.:]\\d{2})\\s+(\\S+)\\s+ek\\s+seferi\\s+düzenlenecektir', 'gi'),
    { en:'on $1, as part of $2, an extra $3 $4 trip will be run', ar:'بتاريخ $1، وضمن $2، ستُنظَّم رحلة إضافية $4 الساعة $3', fr:'le $1, dans le cadre de $2, une traversée supplémentaire $4 de $3 sera organisée' }],
  [/aşağıda\s+belirtilen\s+ek\s+seferler\s+yapılacaktır/gi,
    { en:'the extra trips listed below will be run', ar:'ستُنظَّم الرحلات الإضافية المبيّنة أدناه', fr:'les traversées supplémentaires indiquées ci-dessous seront assurées' }],
  [/aşağıda\s+belirtilen\s+ek\s+sefer\s+düzenlenecektir/gi,
    { en:'the extra trip listed below will be run', ar:'ستُنظَّم الرحلة الإضافية المبيّنة أدناه', fr:'la traversée supplémentaire indiquée ci-dessous sera assurée' }],
  // a stop added or restored, a service resumed
  [/(\S+)\s+Hattı[’']na\s+(\S+)\s+uğraması\s+eklenmiştir/gi,
    { en:'a stop at $2 has been added to the $1 line', ar:'أُضيف توقف في $2 إلى خط $1', fr:'un arrêt à $2 a été ajouté à la ligne $1' }],
  [new RegExp(TR_FD_DATE + '\\s+' + TR_FD_DAY + '\\s+günü\\s+geçerli\\s+olacak\\s+sefer\\s+tarifesi\\s+aşağıda\\s+belirtilmiştir', 'gi'),
    { en:'The timetable valid on $2 $1 is given below', ar:'جدول الرحلات الساري يوم $2 $1 مبيّن أدناه', fr:'L’horaire en vigueur le $2 $1 est indiqué ci-dessous' }],
  [/(\S+)\s+Hattı[’']\S*\s+(\S+)\s+[İi]skelesi\s+uğraması\s+normale\s+dönmüştür/gi,
    { en:'the $2 Pier stop on the $1 line has returned to normal', ar:'عاد التوقف في رصيف $2 على خط $1 إلى وضعه الطبيعي', fr:'l’arrêt de l’embarcadère de $2 sur la ligne $1 est revenu à la normale' }],
  [/([^\s.;][^.;]*?)\s+Hattı\s+seferlerimiz\s+normal\s+tarifesinde\s+(\S+)\s+[İi]skelesinden\s+yapılmaya\s+başlanmıştır/gi,
    { en:'our $1 line trips have started running from $2 Pier on the normal timetable', ar:'بدأت رحلات خط $1 من رصيف $2 وفق الجدول العادي', fr:'les traversées de la ligne $1 ont repris au départ de l’embarcadère de $2 selon l’horaire normal' }],
  // dates: "<date> tarihinden itibaren"
  [new RegExp(TR_FD_DATE + '\\s+tarihinden\\s+itibaren\\s+aşağıdaki\\s+şekilde\\s+güncellenecektir(:?)', 'gi'),
    { en:'will be updated from $1 as follows$2', ar:'ستُحدَّث اعتبارًا من $1 على النحو التالي$2', fr:'seront modifiés à partir du $1 comme suit $2' }],
  [new RegExp(TR_FD_DATE + '\\s+tarihinden\\s+itibaren', 'gi'),
    { en:'from $1', ar:'اعتبارًا من $1', fr:'à partir du $1' }],
  // trips, in the ferry sense — after everything above, so the rail "trains" rule never sees them
  [/seferler(?:imiz|ini|ine|i)?/gi, { en:'trips', ar:'الرحلات', fr:'les traversées' }]
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
  'maç':     { en:'match', ar:'مباراة', fr:'match' },
  /* dates and seasons, for the ferry notices: a rule leaves the month or weekday where it stands and this turns it
     into a word, in the order each language writes the date in ("12 October 2026", "12 أكتوبر 2026", "12 octobre 2026") */
  'ocak':   { en:'January',   ar:'يناير',   fr:'janvier' },
  'şubat':  { en:'February',  ar:'فبراير',  fr:'février' },
  'mart':   { en:'March',     ar:'مارس',    fr:'mars' },
  'nisan':  { en:'April',     ar:'أبريل',   fr:'avril' },
  'mayıs':  { en:'May',       ar:'مايو',    fr:'mai' },
  'haziran':{ en:'June',      ar:'يونيو',   fr:'juin' },
  'temmuz': { en:'July',      ar:'يوليو',   fr:'juillet' },
  'ağustos':{ en:'August',    ar:'أغسطس',   fr:'août' },
  'eylül':  { en:'September', ar:'سبتمبر',  fr:'septembre' },
  'ekim':   { en:'October',   ar:'أكتوبر',  fr:'octobre' },
  'kasım':  { en:'November',  ar:'نوفمبر',  fr:'novembre' },
  'aralık': { en:'December',  ar:'ديسمبر',  fr:'décembre' },
  'pazartesi':{ en:'Monday',    ar:'الاثنين',  fr:'lundi' },
  'salı':     { en:'Tuesday',   ar:'الثلاثاء', fr:'mardi' },
  'çarşamba': { en:'Wednesday', ar:'الأربعاء', fr:'mercredi' },
  'perşembe': { en:'Thursday',  ar:'الخميس',   fr:'jeudi' },
  'cuma':     { en:'Friday',    ar:'الجمعة',   fr:'vendredi' },
  'cumartesi':{ en:'Saturday',  ar:'السبت',    fr:'samedi' },
  'pazar':    { en:'Sunday',    ar:'الأحد',    fr:'dimanche' },
  'yaz':     { en:'summer', ar:'الصيف',  fr:'été' },
  'kış':     { en:'winter', ar:'الشتاء', fr:'hiver' },
  'konser':  { en:'concert', ar:'حفل موسيقي', fr:'concert' },
  'sınavı':  { en:'exam',    ar:'امتحان',    fr:'examen' }
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
/* `mode` is the kind of notice being translated; only 'ferry' changes anything. A ferry notice goes through its own
   templates first (TR_FERRY), skips the reorder pass below — the templates already come out in the target
   language's word order, and that pass looks for a "due to" anywhere in the text, which in a notice of several
   sentences would drag a reason across a full stop — and gets a capital after each full stop, since a template
   that starts a later sentence cannot know it is not the start of the text. */
function translateTR(text, target, mode){
  const tgt = TR_TARGETS.indexOf(target) >= 0 ? target : 'en';
  const ferry = mode === 'ferry';
  let s=' '+text+' ';
  if(ferry) for(const [re,rep] of TR_FERRY) s=s.replace(re, rep[tgt]);
  for(const [re,rep] of TR_PHRASES) s=s.replace(re, rep[tgt]);
  // whole-word stragglers (base forms only; station/line names pass through unchanged)
  s=s.replace(/[A-Za-zÇĞİıÖŞÜçğöşü]+/g, w=>{ const k=w.toLocaleLowerCase('tr');
                                             return (TR_WORDS[k] && TR_WORDS[k][tgt]) || w; });
  if(!ferry) for(const [re,rep] of (TR_REORDER[tgt]||[])) s = s.replace(re, rep);
  s=s.replace(/\s+([,،])/g,'$1').replace(/([,،])\s*[,،]/g,'$1').replace(/\s{2,}/g,' ').replace(/\s+\./g,'.').trim();
  // Arabic is caseless; capitalising its first character is a no-op, but doing it only where
  // it means something keeps the intent legible.
  if(tgt !== 'ar') s=s.charAt(0).toUpperCase()+s.slice(1);
  if(ferry && tgt !== 'ar') s=s.replace(/([.!?]\s+)(\p{Ll})/gu, (m,a,b)=>a+b.toUpperCase());
  if(ferry && tgt === 'ar') s=s.replace(/;/g,'؛');          // the operator's list separator, in Arabic's own mark
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
    for(const rule of TR_FERRY) add(rule[1][tgt]);
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
/* The numbers in an announcement — times, dates, counts — are the one thing a translation must not change. Rules
   carry them across by capture, but a rule that dropped one, doubled one or swapped two would still read like a
   sentence, so this compares them: the translation must contain exactly the numbers the original does (order
   aside, since the languages order a date differently). Any difference and the original is shown instead. */
function trNumbers(s){ return (String(s||'').match(/\d+/g) || []).sort().join(','); }
function bestEffortTranslation(tr, names, target, mode){
  const tgt   = TR_TARGETS.indexOf(target) >= 0 ? target : 'en';
  const src   = String(tr||'').trim();
  const out   = translateTR(src, tgt, mode);
  const share = turkishShare(out, names, tgt);
  return (share > TR_FALLBACK_SHARE || trNumbers(out) !== trNumbers(src)) ? { text:src, lang:'tr', share:share }
                                                                          : { text:out, lang:tgt, share:share };
}
// the English-only entry point the scraper and the older call sites use
function bestEffortEnglish(tr, names, mode){ return bestEffortTranslation(tr, names, 'en', mode); }
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

/* GET a page as text, with a few attempts. The status page answers from a developer's machine at the very moment the
   scheduled run on GitHub's network gets "fetch failed" (twice running on 23 Oct 2026, after days of success), and
   that message alone says nothing about why — so every failed attempt logs its CAUSE (a timeout, a reset, a refused
   connection), and a transient one gets a second and third chance before the run is written off as "source
   unreachable". Giving up still leaves disruptions.json untouched, exactly as before. */
async function getWithRetry(url, opts, tries, pauseMs, fetchFn){
  const doFetch = fetchFn || fetch;
  let last;
  for(let i=1; i<=tries; i++){
    try{
      const r = await doFetch(url, Object.assign({ signal: AbortSignal.timeout(25000) }, opts));
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.text();
    }catch(e){
      last = e;
      const why = e && e.cause ? ' ('+(e.cause.code || e.cause.message || e.cause)+')' : '';
      console.error('metro.istanbul attempt '+i+'/'+tries+' failed: '+e.message+why);
      if(i < tries) await new Promise(res=>setTimeout(res, pauseMs*i));
    }
  }
  throw last;
}
async function main(){
  let metro=[], fetchOk=false;
  try{
    metro=parseMetro(await getWithRetry(SRC,{headers:{'User-Agent':UA}},3,6000)); fetchOk=true;
  }catch(e){ console.error('metro.istanbul fetch failed:', e.message); process.exitCode=2; }
  // a transient fetch failure must NOT erase the current file — bail out, leave it untouched
  if(!fetchOk){ console.error('Source unreachable — leaving disruptions.json unchanged.'); return; }
  await llmRefine(metro);   // optional high-quality translation for anything the phrase map missed
  const x=await parseX();
  /* Şehir Hatları (the city ferries) publishes announcements of its own: timetable changes, extra and cancelled
     trips. They are read from the operator's site by scrape-ferry.cjs and travel the same road the rail faults do.
     That page is not an interface — its text is inside an ASP.NET view-state — so a failure here must never cost the
     rail notices, and must not make the ferry ones vanish either: they are carried over from the current file and
     expire by their own end date. */
  let ferry=[], ferryOk=false;
  try{
    const { fetchFerryNotices } = require('./scrape-ferry.cjs');
    const lines=JSON.parse(fs.readFileSync(path.join(__dirname,'ferry-lines.json'),'utf8'));
    const today=new Date().toLocaleDateString('en-CA',{ timeZone:'Europe/Istanbul' });
    ferry=await fetchFerryNotices(today, lines); ferryOk=true;
  }catch(e){ console.error('ferry notices failed:', e.message); }
  if(!ferryOk){
    try{ ferry=JSON.parse(fs.readFileSync(OUT,'utf8')).filter(e=>e.mode==='ferry'); }catch(e){ ferry=[]; }
    if(ferry.length) console.error('kept', ferry.length, 'ferry notice(s) from the current file');
  }
  /* The English a ferry notice is stored with comes from the same ferry templates the app runs for every reader, on the
     notices read just now AND on any carried over from the current file (a rule added since is picked up on the next
     run). A notice the templates do not cover keeps its Turkish, flagged, as a rail notice the rules cannot read does. */
  ferry.forEach(function(e){
    const best = bestEffortEnglish(e.messageTr || e.message, [e.ref].concat(e.lines||[]).filter(Boolean), 'ferry');
    e.message = best.text; e.messageLang = best.lang;
    if(best.lang === 'tr') e.translatedBy = 'none'; else delete e.translatedBy;
  });
  // merge curated manual entries (lines the metro.istanbul page does NOT cover — Marmaray/B2/
  // ferries/buses). Live parse wins for any ref it actually reports.
  let manual=[]; try{ manual=JSON.parse(fs.readFileSync(path.join(__dirname,'disruptions-manual.json'),'utf8')); }catch(e){}
  const liveRefs=new Set(metro.map(e=>e.ref));
  const keptManual=manual.filter(m=> !liveRefs.has(m.ref));
  const all=keptManual.concat(metro, x, ferry);
  // keep a stable, readable order
  all.sort((a,b)=> (a.ref||'zzz').localeCompare(b.ref||'zzz','tr') || a.id.localeCompare(b.id));
  if(!metro.length && !process.env.ALLOW_EMPTY){
    console.error('No metro.istanbul disruptions parsed — keeping manual-only set (safety).');
  }
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2)+'\n');
  console.log('WROTE', OUT, '—', all.length, 'item(s):', all.map(e=>e.ref+'/'+e.id).join(', '));
}
main();
