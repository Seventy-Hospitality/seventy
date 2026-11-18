// The 6-digit code Clutch just emailed EMAIL, read from the local stack's mail
// catcher (Mailpit, the Supabase CLI's [inbucket] port). Runs inside Maestro
// (runScript); sets output.code. Local stack only.
var MAILPIT = 'http://127.0.0.1:54324';

function latestCode() {
  var search = http.get(MAILPIT + '/api/v1/search?query=' + encodeURIComponent('to:"' + EMAIL + '"'));
  if (search.status !== 200) return null;
  var messages = json(search.body).messages || [];
  if (!messages.length) return null;
  // Newest first: the code just sent.
  var message = http.get(MAILPIT + '/api/v1/message/' + messages[0].ID);
  if (message.status !== 200) return null;
  var body = json(message.body);
  var match = /\b(\d{6})\b/.exec((body.Text || '') + ' ' + (body.HTML || ''));
  return match ? match[1] : null;
}

// Clutch answers /auth/otp after the email is handed to the mail catcher, so
// the code is normally there at once; a few more reads cover a slow hand-off.
var code = null;
for (var attempt = 0; attempt < 200 && !code; attempt++) code = latestCode();
if (!code) throw new Error('no sign-in code reached ' + EMAIL + ' in Mailpit');
output.code = code;
