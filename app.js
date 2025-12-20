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
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '944965828697095';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ================= CONSTANTS =================
const GOALS = { '1': 'muscle_gain', '2': 'fat_loss', '3': 'maintenance', '4': 'endurance' };
const DIETS = { '1': 'vegetarian', '2': 'non-vegetarian', '3': 'vegan', '4': 'keto' };
const PLACES = { '1': 'home', '2': 'gym', '3': 'outdoor' };
const LEVELS = { '1': 'beginner', '2': 'intermediate', '3': 'advanced' };

const GOAL_LABELS = { muscle_gain: '💪 Muscle Gain', fat_loss: '🔥 Fat Loss', maintenance: '⚖️ Maintenance', endurance: '🏃 Endurance' };
const DIET_LABELS = { vegetarian: '🥗 Vegetarian', 'non-vegetarian': '🍗 Non-Veg', vegan: '🌱 Vegan', keto: '🥑 Keto' };
const PLACE_LABELS = { home: '🏠 Home', gym: '🏋️ Gym', outdoor: '🌳 Outdoor' };
const LEVEL_LABELS = { beginner: '🌟 Beginner', intermediate: '⭐ Intermediate', advanced: '🔥 Advanced' };

// ================= IN-MEMORY STORE =================
const users = {};

// ================= WEBHOOK VERIFY =================
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).end();
});

// ================= HEALTH CHECK =================
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ================= WEBHOOK MESSAGE =================
app.post('/', async (req, res) => {
  res.status(200).end();
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.from) return;
  
  const phone = msg.from;
  const text = msg.text?.body?.trim().toLowerCase() || '';
  const buttonId = msg.interactive?.button_reply?.id;
  const listId = msg.interactive?.list_reply?.id;
  
  try {
    await handleMessage(phone, text, buttonId || listId);
  } catch (err) {
    console.error('Handler error:', err.message);
    await sendText(phone, '❌ Something went wrong. Type "restart" to begin again.');
  }
});

// ================= MESSAGE HANDLER =================
async function handleMessage(phone, text, interactiveId) {
  // Handle restart command
  if (text === 'restart' || text === 'reset' || text === 'start over') {
    delete users[phone];
    return sendWelcome(phone);
  }

  // Handle plan request from existing user
  if (text === 'plan' || text === 'new plan') {
    if (users[phone]?.step === 'COMPLETE') {
      users[phone].step = 'GENERATING';
      await sendText(phone, '⏳ Creating your personalized plan...');
      return generateAndSendPlan(phone, users[phone].data);
    }
  }

  // Initialize new user
  if (!users[phone]) {
    users[phone] = { step: 'WELCOME', data: {}, createdAt: Date.now() };
    return sendWelcome(phone);
  }

  const user = users[phone];
  const input = interactiveId || text;

  switch (user.step) {
    case 'WELCOME':
      user.data.name = capitalizeWords(text);
      user.step = 'PROFILE';
      return sendProfilePrompt(phone, user.data.name);

    case 'PROFILE':
      const profile = parseProfile(text);
      if (!profile) {
        return sendText(phone, '❌ Please use the format:\n\n*age height(cm) weight(kg)*\n\nExample: 25 175 70');
      }
      Object.assign(user.data, profile);
      user.step = 'GOAL';
      return sendGoalButtons(phone);

    case 'GOAL':
      const goal = GOALS[input] || Object.keys(GOALS).find(k => GOALS[k] === input);
      if (!goal) return sendGoalButtons(phone);
      user.data.goal = GOALS[goal] || goal;
      user.step = 'DIET';
      return sendDietButtons(phone);

    case 'DIET':
      const diet = DIETS[input] || Object.keys(DIETS).find(k => DIETS[k] === input);
      if (!diet) return sendDietButtons(phone);
      user.data.diet = DIETS[diet] || diet;
      user.step = 'PLACE';
      return sendPlaceButtons(phone);

    case 'PLACE':
      const place = PLACES[input] || Object.keys(PLACES).find(k => PLACES[k] === input);
      if (!place) return sendPlaceButtons(phone);
      user.data.place = PLACES[place] || place;
      user.step = 'LEVEL';
      return sendLevelButtons(phone);

    case 'LEVEL':
      const level = LEVELS[input] || Object.keys(LEVELS).find(k => LEVELS[k] === input);
      if (!level) return sendLevelButtons(phone);
      user.data.level = LEVELS[level] || level;
      user.step = 'GENERATING';
      await sendProfileSummary(phone, user.data);
      await sendText(phone, '⏳ Creating your personalized fitness plan...');
      return generateAndSendPlan(phone, user.data);

    case 'COMPLETE':
      return sendCompletedMenu(phone, user.data.name);

    default:
      return sendText(phone, 'Type "restart" to begin a new session.');
  }
}

// ================= ONBOARDING MESSAGES =================
async function sendWelcome(phone) {
  const welcome = `🏋️ *FitCoach AI* 🏋️

Welcome to your personal AI fitness coach!

I'll create a customized workout and diet plan just for you in under 60 seconds.

*What's your name?*`;
  return sendText(phone, welcome);
}

async function sendProfilePrompt(phone, name) {
  const msg = `Nice to meet you, ${name}! 👋

Now let's get your basic stats. Please reply with:

*Your age, height (cm), and weight (kg)*

Example: *25 175 70*

(Just the numbers, separated by spaces)`;
  return sendText(phone, msg);
}

async function sendProfileSummary(phone, data) {
  const bmi = (data.weight / Math.pow(data.height / 100, 2)).toFixed(1);
  const summary = `✅ *Profile Complete!*

👤 ${data.name}
📊 ${data.age} yrs | ${data.height}cm | ${data.weight}kg
📈 BMI: ${bmi}

🎯 ${GOAL_LABELS[data.goal]}
🍽️ ${DIET_LABELS[data.diet]}
📍 ${PLACE_LABELS[data.place]}
💪 ${LEVEL_LABELS[data.level]}`;
  return sendText(phone, summary);
}

async function sendCompletedMenu(phone, name) {
  return sendButtons(phone, 
    `Hey ${name}! 👋\n\nWhat would you like to do?`,
    [
      { id: 'new_plan', title: '📋 New Plan' },
      { id: 'restart', title: '🔄 Update Profile' }
    ]
  );
}

// ================= INTERACTIVE BUTTONS =================
async function sendGoalButtons(phone) {
  return sendButtons(phone, '🎯 *What\'s your fitness goal?*', [
    { id: 'muscle_gain', title: '💪 Muscle Gain' },
    { id: 'fat_loss', title: '🔥 Fat Loss' },
    { id: 'maintenance', title: '⚖️ Maintenance' }
  ]);
}

async function sendDietButtons(phone) {
  return sendButtons(phone, '🍽️ *What\'s your diet preference?*', [
    { id: 'vegetarian', title: '🥗 Vegetarian' },
    { id: 'non-vegetarian', title: '🍗 Non-Veg' },
    { id: 'vegan', title: '🌱 Vegan' }
  ]);
}

async function sendPlaceButtons(phone) {
  return sendButtons(phone, '📍 *Where do you work out?*', [
    { id: 'home', title: '🏠 Home' },
    { id: 'gym', title: '🏋️ Gym' },
    { id: 'outdoor', title: '🌳 Outdoor' }
  ]);
}

async function sendLevelButtons(phone) {
  return sendButtons(phone, '💪 *What\'s your fitness level?*', [
    { id: 'beginner', title: '🌟 Beginner' },
    { id: 'intermediate', title: '⭐ Intermediate' },
    { id: 'advanced', title: '🔥 Advanced' }
  ]);
}

// ================= GROQ PLAN GENERATION =================
async function generateAndSendPlan(phone, data) {
  const prompt = `You are an expert fitness coach creating a personalized daily plan.

USER PROFILE:
- Name: ${data.name}
- Age: ${data.age} years
- Height: ${data.height} cm  
- Weight: ${data.weight} kg
- BMI: ${(data.weight / Math.pow(data.height / 100, 2)).toFixed(1)}
- Goal: ${data.goal.replace('_', ' ')}
- Diet: ${data.diet}
- Location: ${data.place}
- Level: ${data.level}

FORMATTING RULES:
- Plain text only, NO markdown (no *, #, _, etc.)
- Use emojis for section headers
- Keep lines short for mobile
- Use "-" for bullet points
- One blank line between sections
- Be motivating and specific
- Include sets, reps, and rest times
- Calculate approximate calories based on their stats

OUTPUT FORMAT:

🏋️ TODAY'S WORKOUT
[4-6 exercises appropriate for their level and location]
[Include warm-up and cool-down]

🍽️ MEAL PLAN
[Breakfast, Lunch, Snack, Dinner with portions]
[Match their diet preference exactly]
[Include approximate calories per meal]

💧 DAILY TARGETS
[Water intake based on weight]
[Protein target based on goal]
[Sleep recommendation]

💡 PRO TIP
[One specific tip based on their goal]

End with an encouraging message using their name.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const plan = completion.choices[0].message.content;
    await sendText(phone, plan);
    
    // Generate and send motivational image
    await sendMotivationalImage(phone, data);
    
    users[phone].step = 'COMPLETE';
    
    // Send follow-up options
    await delay(2000);
    await sendButtons(phone, '📱 *Quick Actions*', [
      { id: 'new_plan', title: '📋 Tomorrow\'s Plan' },
      { id: 'restart', title: '🔄 Update Profile' }
    ]);

  } catch (err) {
    console.error('Groq error:', err.message);
    await sendText(phone, '❌ Could not generate your plan. Please try again with "new plan".');
    users[phone].step = 'COMPLETE';
  }
}

// ================= IMAGE GENERATION (Pollinations.ai - Free, No API Key) =================
async function sendMotivationalImage(phone, data) {
  try {
    const prompt = encodeURIComponent(
      `Fitness motivation poster, ${data.goal.replace('_', ' ')}, ${data.place} workout, ` +
      `healthy ${data.diet} food, energetic, professional photography, inspiring, 4k quality`
    );
    
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true`;
    
    // Verify image is accessible
    const check = await axios.head(imageUrl, { timeout: 10000 });
    if (check.status === 200) {
      await sendImage(phone, imageUrl, `🔥 Stay focused, ${data.name}! Your transformation starts today.`);
    }
  } catch (err) {
    console.error('Image generation skipped:', err.message);
    // Silently skip image if it fails - plan is the priority
  }
}

// ================= WHATSAPP API =================
async function sendText(to, body) {
  return whatsappRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body }
  });
}

async function sendImage(to, url, caption) {
  return whatsappRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { link: url, caption }
  });
}

async function sendButtons(to, bodyText, buttons) {
  return whatsappRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.substring(0, 20) }
        }))
      }
    }
  });
}

async function whatsappRequest(data) {
  try {
    return await axios.post(WHATSAPP_API_URL, data, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('WhatsApp API error:', err.response?.data || err.message);
    throw err;
  }
}

// ================= UTILITIES =================
function parseProfile(text) {
  const nums = text.match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  
  const [age, height, weight] = nums.map(Number);
  
  // Validation
  if (age < 13 || age > 100) return null;
  if (height < 100 || height > 250) return null;
  if (weight < 30 || weight > 300) return null;
  
  return { age, height, weight };
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================= CLEANUP OLD SESSIONS (every hour) =================
setInterval(() => {
  const oneDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const phone in users) {
    if (now - users[phone].createdAt > oneDay) {
      delete users[phone];
    }
  }
}, 60 * 60 * 1000);

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 FitCoach AI running on port ${PORT}`);
  console.log(`📱 WhatsApp webhook ready`);
});
