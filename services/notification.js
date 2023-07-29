const apn = require('apn');
const fs = require('fs');

const apnsKeyPath = process.env.APN_PATH;
const bundleId = process.env.APP_BUNDLE_ID;
const deviceToken = process.env.DEVICE_TOKEN;

const apnProvider = new apn.Provider({
  token: {
    key: fs.readFileSync(apnsKeyPath),
    keyId: process.env.APP_KEY_ID,
    teamId: process.env.APP_TEAM_ID
  },
  production: false // Set to true if sending notifications in a production environment
});

function sendNotification(service, message, recipient) {
  // Create notification
  let note = new apn.Notification();
  note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now
  note.badge = 0;
  note.sound = 'ping.aiff';
  note.alert = `\uD83E\uDD16 ${recipient.id}: ${message}`;
  note.payload = {
    service,
    message,
    recipient
  };
  note.topic = bundleId;

  apnProvider.send(note, deviceToken).then((result) => {
    const { sent, failed } = result;
    // console.log(result); //// To see all data

    for (const success of sent) {
      console.log('🚀 Sent a message to', success.device);
    }
    for (const fail of failed) {
      console.log('💥 Failed to send message to', fail.device);
    }
  });
}

module.exports = { sendNotification };
