// Import Express.js
const express = require('express');
const axios = require('axios');

// Create an Express app
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Config
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

const PHONE_NUMBER_ID = '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

/* --------------------------------------------------
   GET — Webhook verification
-------------------------------------------------- */
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }

  return res.status(403).end();
});

/* --------------------------------------------------
   POST — Receive message + Send WhatsApp reply
-------------------------------------------------- */
app.post('/', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log('\n📩 Webhook received:', timestamp);
  console.log(JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message || !message.from) {
    return res.status(200).end();
  }

  const userPhone = message.from;

  // 🔥 Call async function SAFELY
  sendWelcomeMessage(userPhone)
    .then(() => {
      console.log('Welcome message sent to', userPhone);
    })
    .catch((err) => {
      console.error(
        '❌ WhatsApp API error:',
        err.response?.data || err.message
      );
    });

  // ALWAYS respond 200 to WhatsApp
  res.status(200).end();
});

/* --------------------------------------------------
   WhatsApp API Call (Async-safe)
-------------------------------------------------- */
function sendWelcomeMessage(to) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      body:
        '👋 Welcome to Ultimate FitBuddy AI! 💪🤖\n\n' +
        'I’m your personal AI fitness & nutrition coach, here to help you:\n' +
        '- 🏋️ Build strength\n' +
        '- 🔥 Lose fat\n' +
        '- 🥗 Eat smarter\n' +
        '- ⏰ Stay consistent\n\n' +
        'I’ll create personalized workout & diet plans based on your body, goals, and lifestyle.\n\n' +
        '✨ What you’ll get:\n' +
        '- Customized workout plans (home or gym)\n' +
        '- Daily diet reminders at your preferred time\n' +
        '- Smart adjustments as you progress\n' +
        '- Simple, practical guidance you can actually follow\n\n' +
        '⏳ It takes less than 2 minutes to get started.\n\n' +
        '👉 Let’s begin!\nWhat is your name? 😊'
    }
  };

  return axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });
}

/* --------------------------------------------------
   START SERVER
-------------------------------------------------- */
app.listen(port, () => {
  console.log(`🚀 Listening on port ${port}`);
});
