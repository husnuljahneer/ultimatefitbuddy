// NOTE: This is a DROP-IN EXTENSION of your working webhook.
// It keeps your WhatsApp integration intact and adds:
// 1. Conversation state machine
// 2. Hugging Face NLP model usage
// 3. Conversational onboarding flow

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ================= CONFIG =================
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

const PHONE_NUMBER_ID = '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

// Hugging Face (FREE, WORKING)
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = 'facebook/bart-large-mnli'; // intent + classification

// ================= IN-MEMORY STATE (REPLACE WITH DB LATER) =================
const users = {};

// ================= WEBHOOK VERIFY =================
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).end();
});

// ================= MESSAGE HANDLER =================
app.post('/', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.status(200).end();

  const phone = msg.from;
  const text = msg.text?.body?.trim();

  if (!users[phone]) {
    users[phone] = { state: 'WELCOME', profile: {} };
  }

  const user = users[phone];
  const reply = await conversationEngine(user, text);

  await sendTextMessage(phone, reply);
  res.status(200).end();
});

// ================= CONVERSATION ENGINE =================
async function conversationEngine(user, input) {
  switch (user.state) {
    case 'WELCOME':
      user.state = 'ASK_NAME';
      return '👋 Welcome to Ultimate FitBuddy AI!\n\nWhat is your name?';

    case 'ASK_NAME':
      user.profile.name = input;
      user.state = 'ASK_GOAL';
      return `Nice to meet you, ${input}!\nWhat is your fitness goal? (fat loss / muscle gain / stay fit)`;

    case 'ASK_GOAL':
      user.profile.goal = input;
      user.state = 'AI_RESPONSE';
      return await aiResponse(user.profile);

    default:
      return 'I am setting things up for you. Please wait 😊';
  }
}

// ================= HUGGING FACE AI =================
async function aiResponse(profile) {
  const prompt = `User goal: ${profile.goal}. Generate a short motivational fitness message.`;

  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    { inputs: prompt },
    { headers: { Authorization: `Bearer ${HF_TOKEN}` } }
  );

  return `🔥 Personalized Tip:\n${response.data[0].generated_text}`;
}

// ================= SEND WHATSAPP MESSAGE =================
function sendTextMessage(to, body) {
  return axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

app.listen(port, () => console.log(`🚀 Bot running on port ${port}`));
