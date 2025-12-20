// ================= IMPORTS =================
const express = require('express');
const axios = require('axios');
const { pipeline } = require('@huggingface/transformers');

// ================= APP =================
const app = express();
app.use(express.json());

// ================= CONFIG =================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const PHONE_NUMBER_ID = '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

// ================= NLP MODEL =================
let classifier;
async function loadModel() {
  if (!classifier) {
    classifier = await pipeline(
      'sentiment-analysis',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
    );
    console.log('🤗 NLP model loaded');
  }
}
loadModel();

// ================= IN-MEMORY USER STORE =================
const users = {};

// ================= WEBHOOK VERIFY =================
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).end();
});

// ================= WEBHOOK MESSAGE =================
app.post('/', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.status(200).end();

  const phone = msg.from;
  const text = msg.text?.body?.toLowerCase();

  if (!users[phone]) {
    users[phone] = { state: 'ONBOARDING', profile: {} };
    await sendText(phone, welcomeMessage());
    return res.status(200).end();
  }

  const user = users[phone];

  if (user.state === 'ONBOARDING') {
    extractProfile(user.profile, text);

    if (isProfileComplete(user.profile)) {
      user.state = 'ACTIVE';
      const plan = generatePlan(user.profile);
      await sendText(phone, plan);
    } else {
      await sendText(phone, askMissing(user.profile));
    }
  } else {
    await sendText(phone, '✅ Your plan is active. More features coming soon!');
  }

  res.status(200).end();
});

// ================= NLP + EXTRACTION =================
function extractProfile(profile, text) {
  const age = text.match(/(\d{2})\s*(years|yr|yo)?/);
  const height = text.match(/(\d{3})\s*(cm)/);
  const weight = text.match(/(\d{2})\s*(kg)/);

  if (age) profile.age = Number(age[1]);
  if (height) profile.height = Number(height[1]);
  if (weight) profile.weight = Number(weight[1]);

  if (text.includes('muscle')) profile.goal = 'muscle gain';
  if (text.includes('fat')) profile.goal = 'fat loss';

  if (text.includes('veg')) profile.diet = 'veg';
  if (text.includes('non')) profile.diet = 'non-veg';
}

// ================= PROFILE CHECK =================
function isProfileComplete(p) {
  return p.age && p.height && p.weight && p.goal && p.diet;
}

function askMissing(p) {
  if (!p.age) return 'What is your age?';
  if (!p.height) return 'What is your height in cm?';
  if (!p.weight) return 'What is your weight in kg?';
  if (!p.goal) return 'What is your goal? (muscle gain / fat loss)';
  if (!p.diet) return 'Are you veg or non-veg?';
}

// ================= PLAN GENERATION (RULE BASED) =================
function generatePlan(p) {
  return (
    `🎉 Profile complete!\n\n` +
    `👤 Age: ${p.age}\n` +
    `📏 Height: ${p.height} cm\n` +
    `⚖️ Weight: ${p.weight} kg\n` +
    `🎯 Goal: ${p.goal}\n` +
    `🥗 Diet: ${p.diet}\n\n` +
    `🏋️ Workout Plan:\n` +
    `• Push-ups – 3x12\n` +
    `• Squats – 3x15\n` +
    `• Plank – 3x30 sec\n\n` +
    `🥗 Diet Plan:\n` +
    `• Breakfast: Oats + fruits\n` +
    `• Lunch: Rice + dal + veggies\n` +
    `• Dinner: Roti + protein\n\n` +
    `💪 Let’s begin!`
  );
}

// ================= WHATSAPP SEND =================
function sendText(to, body) {
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

// ================= WELCOME =================
function welcomeMessage() {
  return (
    '👋 Welcome to Ultimate FitBuddy AI!\n\n' +
    'Tell me about yourself in one message.\n\n' +
    'Example:\n' +
    '"I am 26 years old, 183 cm, 66 kg, want muscle gain, non veg"'
  );
}

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
