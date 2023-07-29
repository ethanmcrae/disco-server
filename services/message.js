const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const notificationService = require('./notificationService');

const dbPath = `/Users/${process.env.USER}/Library/Messages/chat.db`; 
const db = new sqlite3.Database(dbPath);

db.all("SELECT message.text FROM chat_message_join ORDER BY chat_message_join.ROWID DESC LIMIT 15", (err, rows) => {
  if (err) return console.error(err);
  
  // rows contains latest 15 messages
  console.log('rows', rows);

  const messageContext = ''; // TODO: Update with parsed rows data

  // Send context to GPT-3 API
  axios.post('https://api.openai.com/v1/engines/davinci-codex/completions', {
    prompt: messageContext,
    max_tokens: 150
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.CHAT_GPT_API_KEY}`
    }
  }).then((response) => {
    const suggestedResponse = response.data.choices[0].text;
    notificationService.sendNotification(suggestedResponse);
  }).catch((error) => {
    console.error(error);
  });
});
