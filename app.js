// Import Express.js
const express = require('express');
const axios = require('axios');

// Create an Express app
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Set port and verify_token
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// WhatsApp config (PERMANENT API)
const PHONE_NUMBER_ID = '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

/* --------------------------------------------------
   GET — Webhook verification (UNCHANGED)
-------------------------------------------------- */
app.get('/', (req, res) => {
  const {
    'hub.mode': mode,
    'hub.challenge': challenge,
    'hub.verify_token': token
  } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

/* --------------------------------------------------
   POST — Receive message + Send WhatsApp reply
-------------------------------------------------- */
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    // Safely extract WhatsApp user number
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || !message.from) {
      return res.status(200).end();
    }

    const userPhone = message.from;

    // 🔥 Send welcome message using PERMANENT API
    await sendWelcomeMessage(userPhone);

    res.status(200).end();
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(200).end(); // Always return 200 to WhatsApp
  }
});

/* --------------------------------------------------
   WhatsApp API Call (Permanent Token)
-------------------------------------------------- */
async function sendWelcomeMessage(to) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      body:
        '👋 Welcome to Ultimate FitBuddy AI! 💪🤖\n\n' +
        'I’m your personal AI fitness & nutrition coach.\n\n' +
        'What is your name? 😊'
    }
  };

  try {
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });

    console.log('✅ WhatsApp API response:', response.data);
  } catch (err) {
    console.error(
      '❌ WhatsApp API error:',
      err.response?.data || err.message
    );
  }
}

  await axios.post(WHATSAPP_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  console.log('Welcome message sent to', to);
}

// Start the server
app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
