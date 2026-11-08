/* ===========================================================================
   THE ANDROID APP (GOOGLE PLAY): is this page running inside it?

   The Android app is this same website opened full-screen by a thin Android shell (a Trusted Web Activity), so there is one code base.
   A few things are deliberately different there, and this is the one place that decides it:
     - the OPTIONAL Claude layer of "Ask the map" is off: no key box in Settings, and the key is never read, so nothing is ever sent
       to api.anthropic.com. "Ask the map" itself (places, directions, what is nearby, from the map's own data) stays. Google Play asks
       generative-AI features to carry an in-app way to report offensive output; there is no such feature here, so there is no
       generative AI in that app;
     - the fare card is always the DRAWN face (labelled as a drawing), never an operator's real card picture, until the operators have
       been asked (Operator-Outreach/Draft-Card-Images.md).
   The website keeps both. To change either decision for the Android app, change it here and in the two places that read PLAY_APP.

   How the page knows (all three are needed; none is enough alone):
     1. document.referrer starts with android-app:// : what Chrome sets when the shell launches the page. A different default browser
        (Brave, Firefox) can leave it blank;
     2. ?src=play on the address: the shell's start address carries it, and it is how to try the Android behaviour in a desktop browser;
     3. a flag in sessionStorage (irn_play): this window remembers it was opened from the shell, so moving to a legal page and back
        (whose referrer is then that legal page) does not turn the website behaviour back on. It is gone when the window closes.
   =========================================================================== */
function detectPlayApp(){
  let on = false;
  try{ on = /^android-app:\/\//i.test(document.referrer || '') || /[?&]src=play(?:&|$)/.test(location.search || ''); }catch(e){}
  try{
    if(on) sessionStorage.setItem('irn_play', '1');
    else on = sessionStorage.getItem('irn_play') === '1';
  }catch(e){}
  return on;
}
const PLAY_APP = detectPlayApp();
if(PLAY_APP){ try{ document.documentElement.classList.add('play-app'); }catch(e){} }
