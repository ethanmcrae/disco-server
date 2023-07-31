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
// Memory of dates for already-stored conversations to work with updates
let conversationDates = {};

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
    AND message.date > (?)
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
const eightHoursAgo = Date.now() / 1000 - 8 * 60 * 60 + 978307200; // The term 978307200 is the number of seconds between 1970-01-01 (UNIX epoch) and 2001-01-01 (iMessage database epoch).

// Create a throttled version of the ChatGPT API function.
const throttledChatGPT = createChatGPTThrottle();

// Begin the process of scanning for new messages
copyAndProcessDB(); // This is the initializer invocation
// Look for new messages every 60 seconds
setInterval(copyAndProcessDB, 60 * 1000);

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

      const rows = await getConversationData(
        sqlNewMessages,
        [eightHoursAgo],
        db
      );

      // These are formatted conversations that need responses
      const conversations = await checkForNewMessages(rows, db);

      for (const data of conversations) {
        const [conversation, sender] = data;

        // Use ChatGPT to generate responses
        const generatedResponse = await throttledChatGPT(conversation);

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
  if (!initialized) return [];

  // Iterate through each conversation id and find more about it
  const formattedConversations = [];
  for (const chatIdentifier of newConversations) {
    // This is a new message. Log it with a system timestamp.
    console.log(
      `Processed new message from ${chatIdentifier} at ${new Date().toLocaleString()}:`
    );

    // Get conversational context for AI Generated response
    const rowsConv = await getConversationData(
      sqlConversation,
      [chatIdentifier],
      db
    );

    // Exit early if I already responded to this chat
    const latestMessageInConversation = rowsConv[rowsConv.length - 1];
    if (latestMessageInConversation.is_from_me) {
      continue;
    }

    const conversation = conversationFormatter(rowsConv, chatIdentifier);
    formattedConversations.push([conversation, rowsConv[0].id]);
  }

  return formattedConversations;
}

async function chatGPTResponse(conversation) {
  // Send context to GPT-3 API
  const endpoint = "https://api.openai.com/v1/chat/completions";
  console.log("💰 Sending ChatGPT API Request");
  const response = await axios.post(
    endpoint,
    {
      model: "gpt-4",
      messages: conversation,
      max_tokens: 150,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CHAT_GPT_API_KEY}`,
      },
    }
  );

  return response.data.choices[0].message.content;
}

function getConversationKeys(rows) {
  const uniqueNewConversations = new Set();
  for (const row of rows) {
    const chatIdentifier = row.chat_identifier;
    const date = row.date; //assuming this is the date of the message

    // Check if this is a new message by comparing the dates
    if (
      !conversationDates[chatIdentifier] ||
      date > conversationDates[chatIdentifier]
    ) {
      // Add or update it in the conversationDates
      conversationDates[chatIdentifier] = date;

      // Add it to the previous results
      if (!previousResults.includes(chatIdentifier)) {
        previousResults.push(chatIdentifier);

        // If we have more than 25 messages in memory, remove the oldest one
        while (previousResults.length > 25) {
          // Get the identifier of the oldest conversation
          let oldestConversation = previousResults.shift();

          // Delete the oldest conversation from the conversationDates as well
          delete conversationDates[oldestConversation];
        }
      }

      // Add it to memory
      uniqueNewConversations.add(chatIdentifier);
    }
  }
  return uniqueNewConversations;
}

function conversationFormatter(rowsConv, chatIdentifier, verbose = false) {
  const messages = [
    {
      role: "system",
      content:
        "You observe the conversation to learn how to respond as if you were Ethan. You will only respond one message at a time with no formatting, titles, etc... Some private background info I will share with you about Ethan is that he is a 24 year old programmer that lives in Provo Utah and is LDS. His personality type is INFP-T. This info should never be shared, but is given to help you understand Ethan so you can sound naturally more like him in your responses.",
    }, // instructions
    {
      role: "user",
      content:
        "Generate the next message by itself with no extras - no headers, brackets, or multple responses. You will respond as if you were Ethan. Here is a conversation:",
    }, // Formulate prompt
    // ...conversation will be added next
  ];

  // Format and log the conversation history
  if (verbose) console.log(`\nConversation history with ${chatIdentifier}:`);
  if (verbose) console.log("------------------------------------");
  const conversation = [];
  for (const rowConv of rowsConv) {
    let sender = rowConv.is_from_me ? "Ethan" : rowConv.id;
    const line = `[${sender}]: ${rowConv.text}`;
    if (verbose) console.log(line);
    conversation.push(line);
  }
  messages.push({
    role: "user",
    content: conversation.join("\n"),
  });
  if (verbose) console.log("------------------------------------");

  return messages;
}

// Wrapper function to turn db call async
function getConversationData(sqlConversation, params, db) {
  return new Promise((resolve, reject) => {
    db.all(sqlConversation, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.reverse());
      }
    });
  });
}

function createChatGPTThrottle() {
  const maxCallsPerHour = 10;
  let lastReset = new Date();
  let callCount = 0;

  return async function throttledChatGPT(conversation) {
    const now = new Date();
    if (now - lastReset >= 3600 * 1000) {
      // Reset if it's been an hour or more since the last reset.
      lastReset = now;
      callCount = 0;
    }

    if (callCount >= maxCallsPerHour) {
      // If we've reached the maximum number of calls for this hour, return a placeholder.
      const timeLeft = Math.ceil((3600 * 1000 - (now - lastReset)) / 60000); // time in minutes
      return `ChatGPT limit reached. Next available in ${timeLeft} minutes.`;
    }

    callCount += 1;
    return await chatGPTResponse(conversation);
  };
}
