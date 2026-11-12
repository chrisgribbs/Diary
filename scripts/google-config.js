'use strict';
// Writes src/google-config.json for a release build from the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.
// Picks the values out by their shape, so a label, quotes, spaces or both values pasted into one secret still work.
// Fails the build if a Client ID was given but can't be found.
const fs = require('fs'), path = require('path');
const all = `${process.env.GOOGLE_CLIENT_ID || ''}\n${process.env.GOOGLE_CLIENT_SECRET || ''}`;
const id = (all.match(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/) || [])[0];
const secret = ((process.env.GOOGLE_CLIENT_SECRET || '').match(/GOCSPX-[A-Za-z0-9_-]+/) || all.match(/GOCSPX-[A-Za-z0-9_-]+/) || [])[0] || '';
if (!id) {
  console.log('::error title=Google Client ID not found::GOOGLE_CLIENT_ID should hold the Client ID (ending .apps.googleusercontent.com).');
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, '..', 'src', 'google-config.json'), JSON.stringify({ clientId: id, clientSecret: secret }));
console.log(`Google sign-in: client …${id.slice(-30)}, secret ${secret ? 'set' : 'missing'}`);
