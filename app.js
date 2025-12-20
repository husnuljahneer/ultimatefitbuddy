// ================= IMPORTS =================
const express = require('express');
const axios = require('axios');
const { Groq } = require('groq-sdk');

// ================= APP =================
const app = express();
app.use(express.json());

// ================= CONFIG =================
const PORT = process.env.PORT || 7860;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const PHONE_NUMBER_ID = '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ================= IN-MEMORY STORE =================
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
app.post('/', (req, res) => {
  res.status(200).end(); // ACK immediately

  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || !msg.from) return;

  handleMessage(msg.from, msg.text?.body?.trim());
});

// ================= MESSAGE HANDLER =================
async function handleMessage(phone, text) {
  if (!users[phone]) {
    users[phone] = { step: 'NAME', data: {} };
    return sendText(phone, '👋 Welcome! What is your name?');
  }

  const user = users[phone];

  switch (user.step) {
    case 'NAME':
      user.data.name = text;
      user.step = 'AGE';
      return sendText(phone, 'How old are you?');

    case 'AGE':
      user.data.age = text;
      user.step = 'HEIGHT';
      return sendText(phone, 'What is your height in cm?');

    case 'HEIGHT':
      user.data.height = text;
      user.step = 'WEIGHT';
      return sendText(phone, 'What is your weight in kg?');

    case 'WEIGHT':
      user.data.weight = text;
      user.step = 'GOAL';
      return sendText(phone, 'What is your goal? (muscle gain / fat loss / maintenance)');

    case 'GOAL':
      user.data.goal = text;
      user.step = 'DIET';
      return sendText(phone, 'What is your diet preference? (veg / non-veg / vegan)');

    case 'DIET':
      user.data.diet = text;
      user.step = 'PLACE';
      return sendText(phone, 'Where do you work out? (home / gym)');

    case 'PLACE':
      user.data.place = text;
      user.step = 'GENERATING';
      sendText(phone, '⏳ Generating your personalized plan...');
      return generateAndSendPlan(phone, user.data);

    default:
      return sendText(phone, 'Your plan is already active 💪');
  }
}

// ================= GROQ PLAN GENERATION =================
async function generateAndSendPlan(phone, data) {
  const prompt = `
You are a professional fitness and nutrition coach.

Generate a clear, friendly, WhatsApp-ready 1-day workout and diet plan.

User profile:
Name: ${data.name}
Age: ${data.age}
Height: ${data.height} cm
Weight: ${data.weight} kg
Goal: ${data.goal}
Diet preference: ${data.diet}
Workout place: ${data.place}

IMPORTANT FORMATTING RULES (STRICT):
- Output MUST be plain text only
- Do NOT use markdown (*, **, _, #)
- Use emojis for section headers
- Keep lines short (mobile friendly)
- Use simple bullet points with "-"
- Leave one blank line between sections
- No medical or clinical claims
- Tone should be motivating and friendly

OUTPUT STRUCTURE (FOLLOW EXACTLY):

Start with:
"Hey ${data.name}! 👋 Here’s your personalized fitness plan for today 💪"

Then include sections in this order:

🏋️ WORKOUT PLAN
- 3 to 5 exercises
- Mention reps or time
- Adjust for home or gym

🥗 DIET PLAN
- Breakfast
- Lunch
- Snack
- Dinner
- Match diet preference

💧 DAILY TIPS
- 2 or 3 simple tips (hydration, sleep, consistency)

End with:
"🔥 Stay consistent. I’ll be here to guide you every day!"

Keep the entire message concise and WhatsApp-friendly.
`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }]
    });

    const plan = completion.choices[0].message.content;
    await sendText(phone, plan);
  } catch (err) {
    console.error('Groq error:', err.message);
    await sendText(phone, '❌ Failed to generate your plan. Please try again.');
  }
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

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
