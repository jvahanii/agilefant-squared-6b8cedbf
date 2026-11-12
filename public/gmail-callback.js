// Runs on gmail-callback.html, where Google sends the person back after
// they allow Gmail access. Kept in its own file because the site's
// Content-Security-Policy runs no script written into a page.
(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var error = params.get('error') || params.get('error_description');
  // Passed back untouched. With an organization's own Google client the
  // server signed it, and checks it proves who started this connection.
  var state = params.get('state');
  var payload = { source: 'gmail-oauth', code: code, state: state, error: error };
  var told = false;
  // Two ways back to the app. The window that opened this one, if it is
  // still known — a page on the way here can make a browser forget it —
  // and a channel every Agilefant page on this browser hears, which the
  // page that started the connection listens on. The app finishes a
  // given sign-in once, whichever way it arrives first.
  try {
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      told = true;
    }
  } catch (e) {
    /* fall through to the channel */
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      var channel = new BroadcastChannel('gmail-oauth');
      channel.postMessage(payload);
      channel.close();
      told = true;
    }
  } catch (e) {
    /* nothing more to try */
  }
  document.getElementById('msg').textContent = !told
    ? 'Could not reach Agilefant from this window. Close it and choose Connect Gmail again.'
    : error
      ? 'Connection failed. You can close this window.'
      : 'Finishing in Agilefant. You can close this window.';
  if (told) setTimeout(function () { window.close(); }, 800);
})();
