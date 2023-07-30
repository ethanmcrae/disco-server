const os = require("os");
const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const notificationService = require("./notification");
require("events").EventEmitter.defaultMaxListeners = 100; // Increase limit to 100

const sourceDBPath = path.join(os.homedir(), "Library/Messages/chat.db");
const targetDBPath = path.join(__dirname, "../db/chat_copy.db");

// Initialize an empty array to hold the previous results
let previousResults = [];

// iMessage queries
const sqlNewMessages = `
  SELECT m.text, h.id, m.is_from_me, datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch') as date, c.chat_identifier
  FROM message m
  JOIN handle h ON m.handle_id = h.ROWID
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON cmj.chat_id = c.ROWID
  WHERE m.date = (
    SELECT max(date)
    FROM message
    JOIN chat_message_join on chat_message_join.message_id = message.ROWID
    WHERE chat_message_join.chat_id = c.ROWID
  )
  AND m.text IS NOT NULL 
  AND m.is_from_me = 0
  ORDER BY m.date DESC
  LIMIT 25
`;
const sqlConversation = `
  SELECT m.text, h.id, m.is_from_me, datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch') as date, c.chat_identifier 
  FROM message m
  JOIN handle h ON m.handle_id = h.ROWID
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON cmj.chat_id = c.ROWID
  WHERE c.chat_identifier = ?
  ORDER BY m.date DESC
  LIMIT 25
`;

// Begin the process of scanning for new messages
copyAndProcessDB(); // This is the initializer invocation
// Look for new messages every 60 seconds
setInterval(copyAndProcessDB, 6 * 1000);

function copyAndProcessDB() {
  // The original file is locked, but not the copied file
  fs.copy(sourceDBPath, targetDBPath)
    .then(async () => {
      // Open database
      const db = new sqlite3.Database(
        targetDBPath,
        sqlite3.OPEN_READONLY,
        (err) => {
          if (err) {
            console.error(err.message);
          }
        }
      );

      const rows = await getConversationData(sqlNewMessages, [], db);

      // These are formatted conversations that need responses
      const conversations = await checkForNewMessages(rows, db);

      for (const data of conversations) {
        const [conversation, sender] = data;

        // Use ChatGPT to generate responses
        const generatedResponse = await chatGPTResponse(conversation);

        // Send those responses as notifications to the iOS device
        notificationService.sendNotification("iMessage", generatedResponse, {
          id: sender,
          displayName: "<Contact Name>", // TODO: Get contacts from iOS app
        });
      }

      // close the database connection
      db.close();
    })
    .catch((err) => console.error(err));
}

async function checkForNewMessages(rows, db) {
  const initialized = previousResults.length > 0;

  const newConversations = getConversationKeys(rows);

  // Do nothing more if this was the initializer invocation
  // if (!initialized) return []; // TODO: Uncomment

  // TODO: TODO: TODO: TODO: TODO: TODO: TODO: TODO: TODO:
  if (!initialized) {
    console.log("rows original length:", rows.length);
    console.log("newConversations original length:", newConversations.size);

    let i = 0;
    for (const chatIdentifier of newConversations) {
      const rowsConv = await getConversationData(
        sqlConversation,
        [chatIdentifier],
        db
      );

      const conversation = conversationFormatter(
        rowsConv,
        chatIdentifier,
        true
      );
      const formatted = conversation
        .map(({ role, content }) => {
          return `[${role}]: ${content}`;
        })
        .slice(1)
        .join("\n");

      console.log(`\n(${++i}/25) Old Conversation with ${chatIdentifier}:`);
      console.log(formatted);
    }

    console.log("\n\n" + "-=-x".repeat(100) + "-\n\n");
    return [];
  }
  // TODO: TODO: TODO: TODO: TODO: TODO: TODO: TODO: TODO:

  // Iterate through each conversation id and find more about it
  const formattedConversations = [];
  for (const chatIdentifier of newConversations) {
    // TODO: Remove after successful tests.
    // This is a new message. Log it with a system timestamp.
    // TODO: Remove new / old ternary
    console.log(`
=================================================================================
Processed new message from ${chatIdentifier} at ${new Date().toLocaleString()}:`);

    // Get conversational context for AI Generated response
    const rowsConv = await getConversationData(
      sqlConversation,
      [chatIdentifier],
      db
    );

    // Exit early if I already responded to this chat
    const latestMessageInConversation = rowsConv[rowsConv.length - 1];
    if (latestMessageInConversation.is_from_me) {
      // TODO: Remove LOG after successful tests BUT keep the continue.
      console.log(
        `Skipping response generation for ${chatIdentifier} because it appears that I already responded with: ${latestMessageInConversation.text}\n`
      );
      continue;
    }

    const conversation = conversationFormatter(rowsConv, chatIdentifier);
    formattedConversations.push([conversation, rowsConv[0].id]);
  }

  return formattedConversations;
}

async function chatGPTResponse(conversation) {
  // Formulate prompt
  const intro = "I will give you a conversation and I want you to...";
  const messageContext = intro + "\n\n" + conversation;
  // Send context to GPT-3 API
  const endpoint = "https://api.openai.com/v1/chat/completions";
  // TODO: Remove
  const response = {
    data: {
      choices: [
        {
          message: "Example response",
        },
      ],
    },
  };
  /* TODO: Uncomment
  const response = await axios.post(
    endpoint,
    {
      model: "gpt-4",
      messages: message,
      max_tokens: 100,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ❌${process.env.CHAT_GPT_API_KEY}❌`, // TODO: Remove emoji
      },
    }
  );
  */

  console.log("REMOVE THIS LOG (after the real GPT is tested):"); // TODO: Remove
  console.log(
    response.data.choices[0].message ||
      "❌ text: " + response.data.choices[0].text
  );
  return response.data.choices[0].message; // TODO: Might be `.text` instead..?
}

function getConversationKeys(rows) {
  const uniqueNewConversations = new Set();
  for (const row of rows) {
    // Convert each row to a string for easy comparison
    const rowString = JSON.stringify(row);
    const chatIdentifier = row.chat_identifier;

    // Check if this is a new message
    if (!previousResults.includes(rowString)) {
      // Add it to the previous results
      previousResults.push(rowString);

      // Add it to memory
      uniqueNewConversations.add(chatIdentifier);

      // If we have more than 25 messages in memory, remove the oldest one
      while (previousResults.length > 25) {
        previousResults.shift();
      }
    }
  }
  return uniqueNewConversations;
}

// TODO: Remove noLog
function conversationFormatter(rowsConv, chatIdentifier, noLog = undefined) {
  // TODO: Update `content` below.
  const conversation = [
    { role: "system", content: "You are a helpful assistant." }, // instructions
    // ...more will be added below
  ];

  // Format and log the conversation history
  if (!noLog) console.log(`\nConversation history with ${chatIdentifier}:`);
  if (!noLog) console.log("------------------------------------");
  for (const rowConv of rowsConv) {
    let sender = rowConv.is_from_me ? "Ethan" : rowConv.id;
    if (!noLog) console.log(`[${sender}]: ${rowConv.text}`);
    conversation.push({
      role: sender,
      content: rowConv.text,
    });
  }
  if (!noLog) console.log("------------------------------------");

  return conversation;
}

// Wrapper function to turn db call async
function getConversationData(sqlConversation, chatIdentifier, db) {
  return new Promise((resolve, reject) => {
    db.all(sqlConversation, chatIdentifier, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.reverse());
      }
    });
  });
}
