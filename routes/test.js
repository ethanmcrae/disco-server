const express = require("express");
const router = express.Router();
const notificationHandler = require("../services/notification");

router.get("/imessage", (req, res) => {
  const dummyMessage = "Test complete. Errors? 0 & Warnings: 0. Success! 🎉";
  const dummyRecipient = {
    id: process.env.TEST_NUMBER,
    displayName: "Dad",
  };

  notificationHandler.sendNotification(
    "iMessage",
    dummyMessage,
    dummyRecipient
  );

  res.status(200).send("Test notification sent!");
});

module.exports = router;
