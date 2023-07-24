require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;

const dbPath = `/Users/${process.env.USER}/Library/Messages/chat.db`; 
const db = new sqlite3.Database(dbPath);

db.all("SELECT message.text FROM chat_message_join ORDER BY chat_message_join.ROWID DESC LIMIT 15", (err, rows) => {
  if (error) return console.error(error);
  
  // I am getting an error before I get to here.
  console.log('rows', rows);
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
