const express = require('express');
const router = express.Router();
const notificationHandler = require('../services/notification');

router.get('/imessage', (req, res) => {
  const dummyMessage = "This is a test message";
  const dummyRecipient = {
    id: '+14806658025',
    displayName: 'Dad' 
  };

  notificationHandler.sendNotification('iMessage', dummyMessage, dummyRecipient)
  
  res.status(200).send('Test notification sent!');
});

module.exports = router;
