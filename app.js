// ================= IMPORTS =================
const express = require('express');
const axios = require('axios');
const { Groq } = require('groq-sdk');
const Stripe = require('stripe');

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

// ================= STRIPE CONFIG =================
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_51HEybmEtfPQmF2px');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://your-domain.com'; // Update this

// Stripe Price IDs (create these in Stripe Dashboard)
let PRICE_IDS = {
  weekly: null,  // Will be created on startup
  monthly: null
};

// Subscription Plans
const SUBSCRIPTION_PLANS = {
  weekly: {
    name: 'Weekly Plan',
    price: 49, // ₹49 or $0.99
    currency: 'inr', // Change to 'usd' if needed
    interval: 'week',
    description: '7 days unlimited access'
  },
  monthly: {
    name: 'Monthly Plan', 
    price: 149, // ₹149 or $2.99
    currency: 'inr',
    interval: 'month',
    description: '30 days unlimited access + Save 25%'
  }
};

// ================= ONBOARDING OPTIONS =================
const GENDERS = ['male', 'female', 'other'];

const CONDITIONS = {
  none: 'None',
  diabetes: 'Diabetes',
  hypertension: 'High BP',
  thyroid: 'Thyroid',
  pcos: 'PCOS',
  arthritis: 'Arthritis',
  asthma: 'Asthma',
  heart: 'Heart Condition'
};

const DIET_TYPES = {
  vegetarian: '🥗 Vegetarian',
  'non-vegetarian': '🍗 Non-Vegetarian',
  vegan: '🌱 Vegan',
  eggetarian: '🥚 Eggetarian'
};

const GOALS = {
  weight_loss: '🔥 Weight Loss',
  muscle_gain: '💪 Muscle Gain',
  recomposition: '⚖️ Body Recomposition',
  general_fitness: '🏃 General Fitness',
  endurance: '🚴 Endurance',
  flexibility: '🧘 Flexibility'
};

const ACTIVITY_LEVELS = {
  sedentary: '🪑 Sedentary (Desk job)',
  lightly_active: '🚶 Lightly Active',
  active: '🏃 Active',
  very_active: '⚡ Very Active'
};

const TRAINING_PLACES = {
  home: '🏠 Home',
  gym: '🏋️ Gym',
  both: '🔄 Both',
  outdoor: '🌳 Outdoor'
};

const EQUIPMENT = {
  none: 'No Equipment',
  dumbbells: 'Dumbbells',
  resistance_bands: 'Resistance Bands',
  barbell: 'Barbell & Plates',
  kettlebell: 'Kettlebell',
  pull_up_bar: 'Pull-up Bar',
  bench: 'Bench',
  machines: 'Gym Machines',
  cardio_machines: 'Treadmill/Bike'
};

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'full_body', 'upper_body', 'lower_body', 'push', 'pull', 'cardio'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ================= IN-MEMORY STORE =================
const users = {};
const subscriptions = {}; // phone -> { status, plan, expiresAt, stripeCustomerId, stripeSubscriptionId }

// ================= WEBHOOK VERIFY =================
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).end();
});

// ================= HEALTH CHECK =================
app.get('/health', (req, res) => res.json({ status: 'ok', users: Object.keys(users).length, timestamp: new Date().toISOString() }));

// ================= STRIPE WEBHOOK =================
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionUpdate(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSuccess(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
  }

  res.json({ received: true });
});

// ================= STRIPE SUCCESS/CANCEL PAGES =================
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; }
        .check { font-size: 60px; margin-bottom: 20px; }
        h1 { color: #22c55e; margin: 0 0 10px; }
        p { color: #666; margin: 0 0 20px; }
        .btn { background: #22c55e; color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="check">✅</div>
        <h1>Payment Successful!</h1>
        <p>Your subscription is now active. Go back to WhatsApp to continue your fitness journey!</p>
        <a href="https://wa.me/${PHONE_NUMBER_ID}" class="btn">Back to WhatsApp</a>
      </div>
    </body>
    </html>
  `);
});

app.get('/payment-cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
        .card { background: white; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.1); max-width: 400px; }
        .icon { font-size: 60px; margin-bottom: 20px; }
        h1 { color: #ef4444; margin: 0 0 10px; }
        p { color: #666; margin: 0 0 20px; }
        .btn { background: #3b82f6; color: white; padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">😕</div>
        <h1>Payment Cancelled</h1>
        <p>No worries! You can subscribe anytime from WhatsApp. Type "subscribe" to try again.</p>
        <a href="https://wa.me/${PHONE_NUMBER_ID}" class="btn">Back to WhatsApp</a>
      </div>
    </body>
    </html>
  `);
});

// ================= WEBHOOK MESSAGE =================
app.post('/', async (req, res) => {
  res.status(200).end();
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.from) return;
  
  const phone = msg.from;
  const text = msg.text?.body?.trim() || '';
  const buttonId = msg.interactive?.button_reply?.id;
  const listId = msg.interactive?.list_reply?.id;
  
  try {
    await handleMessage(phone, text, buttonId || listId);
  } catch (err) {
    console.error('Handler error:', err);
    await sendText(phone, '❌ Something went wrong. Type "menu" to continue or "restart" to start over.');
  }
});

// ================= MAIN MESSAGE HANDLER =================
async function handleMessage(phone, text, interactiveId) {
  const input = interactiveId || text.toLowerCase();
  
  // Global commands
  if (['restart', 'reset', 'start over', 'start'].includes(input)) {
    delete users[phone];
    return sendWelcome(phone);
  }
  
  // Subscription commands (always available)
  if (['subscribe', 'plans', 'pricing', 'upgrade'].includes(input)) {
    return sendSubscriptionPlans(phone);
  }
  
  if (input === 'weekly' || input === 'subscribe_weekly') {
    return createCheckoutSession(phone, 'weekly');
  }
  
  if (input === 'monthly' || input === 'subscribe_monthly') {
    return createCheckoutSession(phone, 'monthly');
  }
  
  if (['status', 'subscription', 'my plan'].includes(input)) {
    return sendSubscriptionStatus(phone);
  }
  
  if (['menu', 'help'].includes(input) && users[phone]?.step === 'COMPLETE') {
    return sendMainMenu(phone, users[phone].data.name);
  }

  // Initialize new user
  if (!users[phone]) {
    users[phone] = { 
      step: 'WELCOME', 
      data: { conditions: [], equipment: [] }, 
      history: [], 
      trialUsed: false,
      createdAt: Date.now() 
    };
    return sendWelcome(phone);
  }

  const user = users[phone];

  // Handle completed user actions
  if (user.step === 'COMPLETE') {
    return handleCompletedUserAction(phone, user, input);
  }

  // Handle onboarding flow
  return handleOnboarding(phone, user, input, text);
}

// ================= ONBOARDING HANDLER =================
async function handleOnboarding(phone, user, input, originalText) {
  switch (user.step) {
    // Step 1: Name
    case 'WELCOME':
      if (originalText.length < 2 || originalText.length > 50) {
        return sendText(phone, '❌ Please enter a valid name (2-50 characters).');
      }
      user.data.name = capitalizeWords(originalText.trim());
      user.step = 'AGE';
      return sendText(phone, `Nice to meet you, ${user.data.name}! 👋\n\n*How old are you?*\n\n_Enter your age (13-100):_`);

    // Step 2: Age
    case 'AGE':
      const age = parseInt(originalText);
      if (isNaN(age) || age < 13 || age > 100) {
        return sendText(phone, '❌ Please enter a valid age between 13 and 100.');
      }
      user.data.age = age;
      user.step = 'GENDER';
      return sendButtons(phone, '👤 *What is your gender?*\n\n_Used for accurate calorie calculations_', [
        { id: 'male', title: '👨 Male' },
        { id: 'female', title: '👩 Female' },
        { id: 'other', title: '🧑 Other' }
      ]);

    // Step 3: Gender
    case 'GENDER':
      if (!GENDERS.includes(input)) return sendButtons(phone, '👤 *Please select your gender:*', [
        { id: 'male', title: '👨 Male' },
        { id: 'female', title: '👩 Female' },
        { id: 'other', title: '🧑 Other' }
      ]);
      user.data.gender = input;
      user.step = 'HEIGHT';
      return sendText(phone, '📏 *What is your height?*\n\n_Enter height in cm (e.g., 170):_');

    // Step 4: Height
    case 'HEIGHT':
      const height = parseFloat(originalText);
      if (isNaN(height) || height < 100 || height > 250) {
        return sendText(phone, '❌ Please enter a valid height between 100-250 cm.');
      }
      user.data.height = Math.round(height);
      user.step = 'WEIGHT';
      return sendText(phone, '⚖️ *What is your current weight?*\n\n_Enter weight in kg (e.g., 70):_');

    // Step 5: Weight
    case 'WEIGHT':
      const weight = parseFloat(originalText);
      if (isNaN(weight) || weight < 30 || weight > 300) {
        return sendText(phone, '❌ Please enter a valid weight between 30-300 kg.');
      }
      user.data.weight = Math.round(weight * 10) / 10;
      user.step = 'CONDITIONS';
      return sendConditionsMenu(phone, user.data.conditions);

    // Step 6: Medical Conditions (Multi-select)
    case 'CONDITIONS':
      if (input === 'conditions_done') {
        user.step = 'OTHER_CONDITIONS';
        return sendButtons(phone, '🏥 *Any other health considerations?*\n\n_Such as pregnancy, recent surgery, etc._', [
          { id: 'other_yes', title: '✍️ Yes, let me type' },
          { id: 'other_no', title: '✅ No, continue' }
        ]);
      }
      if (input === 'none') {
        user.data.conditions = ['none'];
        user.step = 'OTHER_CONDITIONS';
        return sendButtons(phone, '🏥 *Any other health considerations?*\n\n_Such as pregnancy, recent surgery, etc._', [
          { id: 'other_yes', title: '✍️ Yes, let me type' },
          { id: 'other_no', title: '✅ No, continue' }
        ]);
      }
      if (CONDITIONS[input] && !user.data.conditions.includes(input)) {
        user.data.conditions = user.data.conditions.filter(c => c !== 'none');
        user.data.conditions.push(input);
      }
      return sendConditionsMenu(phone, user.data.conditions);

    // Step 7: Other Conditions (Text)
    case 'OTHER_CONDITIONS':
      if (input === 'other_yes') {
        return sendText(phone, '✍️ *Please describe any other health conditions:*\n\n_Type your response or "skip" to continue:_');
      }
      if (input === 'other_no' || input === 'skip') {
        user.data.otherConditions = null;
        user.step = 'INJURIES';
        return sendButtons(phone, '🩹 *Do you have any current or past injuries?*\n\n_This helps us modify exercises for safety_', [
          { id: 'injury_yes', title: '✍️ Yes, let me type' },
          { id: 'injury_no', title: '✅ No injuries' }
        ]);
      }
      // User typed their conditions
      user.data.otherConditions = originalText.trim();
      user.step = 'INJURIES';
      return sendButtons(phone, '🩹 *Do you have any current or past injuries?*', [
        { id: 'injury_yes', title: '✍️ Yes, let me type' },
        { id: 'injury_no', title: '✅ No injuries' }
      ]);

    // Step 8: Injuries (Text)
    case 'INJURIES':
      if (input === 'injury_yes') {
        return sendText(phone, '🩹 *Please describe your injuries:*\n\n_E.g., "Lower back pain", "Knee surgery 2023":_');
      }
      if (input === 'injury_no') {
        user.data.injuries = null;
        user.step = 'DIET';
        return sendDietButtons(phone);
      }
      // User typed their injuries
      user.data.injuries = originalText.trim();
      user.step = 'DIET';
      return sendDietButtons(phone);

    // Step 9: Diet Preference
    case 'DIET':
      if (!DIET_TYPES[input]) return sendDietButtons(phone);
      user.data.diet = input;
      user.step = 'ALLERGIES';
      return sendButtons(phone, '🚫 *Any food allergies or dislikes?*\n\n_We\'ll exclude these from your meal plans_', [
        { id: 'allergy_yes', title: '✍️ Yes, let me type' },
        { id: 'allergy_no', title: '✅ No allergies' }
      ]);

    // Step 10: Allergies/Dislikes (Text)
    case 'ALLERGIES':
      if (input === 'allergy_yes') {
        return sendText(phone, '🚫 *List your allergies/dislikes:*\n\n_E.g., "peanuts, shellfish, mushrooms":_');
      }
      if (input === 'allergy_no') {
        user.data.allergies = null;
        user.step = 'GOAL';
        return sendGoalMenu(phone);
      }
      user.data.allergies = originalText.trim();
      user.step = 'GOAL';
      return sendGoalMenu(phone);

    // Step 11: Primary Goal
    case 'GOAL':
      if (!GOALS[input]) return sendGoalMenu(phone);
      user.data.goal = input;
      user.step = 'ACTIVITY_LEVEL';
      return sendActivityMenu(phone);

    // Step 12: Activity Level
    case 'ACTIVITY_LEVEL':
      if (!ACTIVITY_LEVELS[input]) return sendActivityMenu(phone);
      user.data.activityLevel = input;
      user.step = 'TRAINING_PLACE';
      return sendTrainingPlaceButtons(phone);

    // Step 13: Training Place
    case 'TRAINING_PLACE':
      if (!TRAINING_PLACES[input]) return sendTrainingPlaceButtons(phone);
      user.data.trainingPlace = input;
      user.step = 'EQUIPMENT';
      return sendEquipmentMenu(phone, user.data.equipment);

    // Step 14: Equipment (Multi-select)
    case 'EQUIPMENT':
      if (input === 'equipment_done') {
        return completeOnboarding(phone, user);
      }
      if (input === 'none') {
        user.data.equipment = ['none'];
        return completeOnboarding(phone, user);
      }
      if (EQUIPMENT[input] && !user.data.equipment.includes(input)) {
        user.data.equipment = user.data.equipment.filter(e => e !== 'none');
        user.data.equipment.push(input);
      }
      return sendEquipmentMenu(phone, user.data.equipment);

    default:
      return sendText(phone, 'Type "restart" to begin again.');
  }
}

// ================= ONBOARDING MENUS =================
async function sendWelcome(phone) {
  const msg = `🏋️ *Welcome to Ultimate FitBuddy AI!* 🏋️

Your personal AI-powered fitness & nutrition coach!

I'll create customized plans based on:
✅ Your body metrics
✅ Health conditions & injuries  
✅ Dietary preferences
✅ Fitness goals
✅ Available equipment

Let's get started with a quick setup (~2 mins)

*What's your name?*`;
  return sendText(phone, msg);
}

async function sendConditionsMenu(phone, selected) {
  const selectedText = selected.length > 0 
    ? `\n\n✅ Selected: ${selected.map(c => CONDITIONS[c]).join(', ')}`
    : '';
  
  const msg = `🏥 *Any medical conditions?*

Select all that apply, then tap "Done":

1️⃣ None
2️⃣ Diabetes
3️⃣ High Blood Pressure
4️⃣ Thyroid Issues
5️⃣ PCOS
6️⃣ Arthritis
7️⃣ Asthma
8️⃣ Heart Condition${selectedText}

_Type the number or tap below:_`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Quick select:', [
    { id: 'none', title: '✅ None' },
    { id: 'diabetes', title: '🩺 Diabetes' },
    { id: 'conditions_done', title: '✔️ Done' }
  ]);
}

async function sendDietButtons(phone) {
  return sendButtons(phone, '🍽️ *What\'s your dietary preference?*', [
    { id: 'vegetarian', title: '🥗 Vegetarian' },
    { id: 'non-vegetarian', title: '🍗 Non-Veg' },
    { id: 'vegan', title: '🌱 Vegan' }
  ]);
}

async function sendGoalMenu(phone) {
  const msg = `🎯 *What's your primary fitness goal?*

1️⃣ 🔥 Weight Loss
2️⃣ 💪 Muscle Gain  
3️⃣ ⚖️ Body Recomposition
4️⃣ 🏃 General Fitness
5️⃣ 🚴 Endurance
6️⃣ 🧘 Flexibility

_Tap below or type the number:_`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Top goals:', [
    { id: 'weight_loss', title: '🔥 Weight Loss' },
    { id: 'muscle_gain', title: '💪 Muscle Gain' },
    { id: 'general_fitness', title: '🏃 General Fitness' }
  ]);
}

async function sendActivityMenu(phone) {
  const msg = `📊 *How active are you daily?*

🪑 *Sedentary* - Desk job, minimal movement
🚶 *Lightly Active* - Light walking, some stairs
🏃 *Active* - Regular exercise, on feet often
⚡ *Very Active* - Intense daily activity/labor`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Select your level:', [
    { id: 'sedentary', title: '🪑 Sedentary' },
    { id: 'lightly_active', title: '🚶 Light Active' },
    { id: 'active', title: '🏃 Active' }
  ]);
}

async function sendTrainingPlaceButtons(phone) {
  return sendButtons(phone, '📍 *Where do you prefer to train?*', [
    { id: 'home', title: '🏠 Home' },
    { id: 'gym', title: '🏋️ Gym' },
    { id: 'both', title: '🔄 Both' }
  ]);
}

async function sendEquipmentMenu(phone, selected) {
  const selectedText = selected.length > 0 
    ? `\n\n✅ Selected: ${selected.map(e => EQUIPMENT[e]).join(', ')}`
    : '';

  const msg = `🏋️ *What equipment do you have?*

Select all that apply:

1️⃣ No Equipment (Bodyweight only)
2️⃣ Dumbbells
3️⃣ Resistance Bands
4️⃣ Barbell & Plates
5️⃣ Kettlebell
6️⃣ Pull-up Bar
7️⃣ Bench
8️⃣ Gym Machines
9️⃣ Cardio Machines${selectedText}

_Tap below or type number:_`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Quick select:', [
    { id: 'none', title: '🙅 No Equipment' },
    { id: 'dumbbells', title: '🏋️ Dumbbells' },
    { id: 'equipment_done', title: '✔️ Done' }
  ]);
}

// ================= COMPLETE ONBOARDING =================
async function completeOnboarding(phone, user) {
  user.data.weekPlan = generateWeeklySchedule(user.data);
  user.step = 'COMPLETE';
  
  await sendProfileSummary(phone, user.data);
  await delay(1500);
  await sendText(phone, '🎉 *Setup Complete!*\n\nYour personalized fitness journey begins now!');
  await delay(500);
  return sendMainMenu(phone, user.data.name);
}

async function sendProfileSummary(phone, data) {
  const stats = calculateStats(data);
  
  const conditionsText = data.conditions.includes('none') || data.conditions.length === 0
    ? 'None'
    : data.conditions.map(c => CONDITIONS[c]).join(', ');
  
  const equipmentText = data.equipment.includes('none') || data.equipment.length === 0
    ? 'Bodyweight only'
    : data.equipment.map(e => EQUIPMENT[e]).join(', ');

  const msg = `✅ *Your Profile*

👤 *${data.name}*
📊 ${data.age} yrs | ${data.gender} | ${data.height}cm | ${data.weight}kg

📈 *Calculated Stats:*
- BMI: ${stats.bmi} (${stats.bmiCategory})
- BMR: ${stats.bmr} kcal/day
- Daily Calories: ${stats.calories} kcal
- Protein Target: ${stats.protein}g

🎯 *Goal:* ${GOALS[data.goal]}
🍽️ *Diet:* ${DIET_TYPES[data.diet]}
📍 *Training:* ${TRAINING_PLACES[data.trainingPlace]}
🏋️ *Equipment:* ${equipmentText}

🏥 *Conditions:* ${conditionsText}
${data.injuries ? `🩹 *Injuries:* ${data.injuries}` : ''}
${data.allergies ? `🚫 *Allergies:* ${data.allergies}` : ''}`;

  return sendText(phone, msg);
}

// ================= MAIN MENU =================
async function sendMainMenu(phone, name) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  
  // Check subscription status for display
  const sub = subscriptions[phone];
  const subStatus = sub?.status === 'active' 
    ? `\n✅ *${sub.plan.toUpperCase()}* subscription active` 
    : '\n💡 Type "subscribe" for unlimited access';
  
  const msg = `${greeting}, ${name}! 👋
${subStatus}

🏋️ *Ultimate FitBuddy Menu*

📋 *Plans*
• today - Full plan (workout + diet)
• tomorrow - Tomorrow's plan  
• week - Weekly overview

💪 *Workouts*
• workout - Today's workout
• quick - 15-min express
• muscle - Target specific muscle

🍽️ *Nutrition*
• diet - Today's meal plan
• tips - Nutrition advice

⚙️ *Account*
• status - Subscription status
• subscribe - View plans
• profile - Your profile
• restart - Start fresh

_Tap below or type a command:_`;

  await sendText(phone, msg);
  
  return sendButtons(phone, '⚡ Quick Actions:', [
    { id: 'today', title: "📅 Today's Plan" },
    { id: 'workout', title: '💪 Workout' },
    { id: 'diet', title: '🥗 Diet' }
  ]);
}

// ================= COMPLETED USER ACTIONS =================
async function handleCompletedUserAction(phone, user, input) {
  // Actions that require subscription
  const premiumActions = ['today', 'tomorrow', 'week', 'workout', 'quick', 'diet', 'muscle', 'day_'];
  const isPremiumAction = premiumActions.some(a => input.startsWith(a)) || MUSCLE_GROUPS.includes(input);
  
  if (isPremiumAction) {
    const accessCheck = await checkAccess(phone, user);
    if (!accessCheck.allowed) {
      return accessCheck.response;
    }
  }
  
  const actions = {
    'menu': () => sendMainMenu(phone, user.data.name),
    'help': () => sendMainMenu(phone, user.data.name),
    'today': () => generateDayPlan(phone, user.data, 0),
    'tomorrow': () => generateDayPlan(phone, user.data, 1),
    'week': () => sendWeekOverview(phone, user.data),
    'workout': () => generateWorkoutOnly(phone, user.data),
    'quick': () => generateQuickWorkout(phone, user.data),
    'muscle': () => sendMuscleGroupMenu(phone),
    'diet': () => generateDietOnly(phone, user.data),
    'tips': () => generateNutritionTips(phone, user.data),
    'progress': () => sendProgressSummary(phone, user),
    'profile': () => sendProfileSummary(phone, user.data),
    'motivation': () => sendMotivation(phone, user.data),
    'subscribe': () => sendSubscriptionPlans(phone),
    'status': () => sendSubscriptionStatus(phone),
    'restart': () => { delete users[phone]; return sendWelcome(phone); }
  };

  // Muscle group selection
  if (MUSCLE_GROUPS.includes(input)) {
    return generateMuscleGroupWorkout(phone, user.data, input);
  }

  // Day selection
  if (input.startsWith('day_')) {
    const dayOffset = parseInt(input.split('_')[1]);
    return generateDayPlan(phone, user.data, dayOffset);
  }

  // Number shortcuts for goals
  const goalNumbers = { '1': 'weight_loss', '2': 'muscle_gain', '3': 'recomposition', '4': 'general_fitness', '5': 'endurance', '6': 'flexibility' };
  if (goalNumbers[input] && user.step === 'GOAL') {
    return handleOnboarding(phone, user, goalNumbers[input], input);
  }

  const action = actions[input];
  if (action) return action();
  
  return sendMainMenu(phone, user.data.name);
}

// ================= SUBSCRIPTION CHECK =================
async function checkAccess(phone, user) {
  // Check if user has active subscription
  const sub = subscriptions[phone];
  
  if (sub && sub.status === 'active' && new Date(sub.expiresAt) > new Date()) {
    return { allowed: true };
  }
  
  // Check if trial is available
  if (!user.trialUsed) {
    user.trialUsed = true;
    await sendText(phone, `🎁 *FREE TRIAL*\n\nEnjoy your first plan on us! After this, you'll need a subscription to continue.\n\n_Generating your free plan..._`);
    await delay(1000);
    return { allowed: true };
  }
  
  // No access - show subscription prompt
  return {
    allowed: false,
    response: await sendSubscriptionRequired(phone)
  };
}

// ================= SUBSCRIPTION FUNCTIONS =================
async function sendSubscriptionRequired(phone) {
  const msg = `🔒 *Subscription Required*

Your free trial has ended. Subscribe to unlock:

✅ Unlimited daily workout plans
✅ Personalized meal plans
✅ Weekly schedules
✅ Quick workouts
✅ Muscle-specific training
✅ Progress tracking

Choose a plan to continue your fitness journey! 💪`;

  await sendText(phone, msg);
  
  return sendButtons(phone, '💳 Select a plan:', [
    { id: 'subscribe_weekly', title: '📅 Weekly ₹49' },
    { id: 'subscribe_monthly', title: '📆 Monthly ₹149' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendSubscriptionPlans(phone) {
  const sub = subscriptions[phone];
  const currentPlan = sub?.status === 'active' ? `\n\n✅ *Current Plan:* ${sub.plan.toUpperCase()} (expires ${new Date(sub.expiresAt).toLocaleDateString()})` : '';
  
  const msg = `💎 *Subscription Plans*${currentPlan}

📅 *WEEKLY PLAN*
💰 ₹49/week
• 7 days unlimited access
• All features included
• Cancel anytime

📆 *MONTHLY PLAN* ⭐ BEST VALUE
💰 ₹149/month (Save 25%!)
• 30 days unlimited access
• All features included
• Cancel anytime

*Both plans include:*
✅ Daily personalized workouts
✅ Custom meal plans
✅ Health condition support
✅ Equipment-based exercises
✅ Progress tracking
✅ Motivational content`;

  await sendText(phone, msg);
  
  return sendButtons(phone, '💳 Choose your plan:', [
    { id: 'subscribe_weekly', title: '📅 Weekly ₹49' },
    { id: 'subscribe_monthly', title: '📆 Monthly ₹149' },
    { id: 'menu', title: '📋 Back' }
  ]);
}

async function sendSubscriptionStatus(phone) {
  const sub = subscriptions[phone];
  
  if (!sub || sub.status !== 'active') {
    const msg = `📊 *Subscription Status*

❌ No active subscription

Subscribe now to unlock all features!`;
    await sendText(phone, msg);
    return sendButtons(phone, 'Get started:', [
      { id: 'subscribe_weekly', title: '📅 Weekly ₹49' },
      { id: 'subscribe_monthly', title: '📆 Monthly ₹149' }
    ]);
  }
  
  const expiresAt = new Date(sub.expiresAt);
  const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
  
  const msg = `📊 *Subscription Status*

✅ *Status:* Active
📋 *Plan:* ${sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)}
📅 *Expires:* ${expiresAt.toLocaleDateString()}
⏳ *Days Left:* ${daysLeft} days

Enjoy your unlimited access! 💪`;

  await sendText(phone, msg);
  return sendButtons(phone, 'Options:', [
    { id: 'today', title: "📅 Today's Plan" },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function createCheckoutSession(phone, plan) {
  try {
    // Ensure price exists
    if (!PRICE_IDS[plan]) {
      await initializeStripePrices();
    }
    
    // Get or create customer
    let customerId = subscriptions[phone]?.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { phone: phone }
      });
      customerId = customer.id;
      
      if (!subscriptions[phone]) {
        subscriptions[phone] = {};
      }
      subscriptions[phone].stripeCustomerId = customerId;
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[plan],
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/payment-cancel`,
      metadata: {
        phone: phone,
        plan: plan
      },
      subscription_data: {
        metadata: {
          phone: phone,
          plan: plan
        }
      }
    });
    
    const planInfo = SUBSCRIPTION_PLANS[plan];
    
    const msg = `💳 *Complete Your Payment*

📋 *Plan:* ${planInfo.name}
💰 *Price:* ₹${planInfo.price}/${planInfo.interval}
📝 *Details:* ${planInfo.description}

👆 *Tap the link below to pay securely:*

${session.url}

🔒 Secure payment powered by Stripe
💡 You can cancel anytime`;

    await sendText(phone, msg);
    
    return sendButtons(phone, 'After payment, type:', [
      { id: 'status', title: '✅ Check Status' },
      { id: 'menu', title: '📋 Menu' }
    ]);
    
  } catch (err) {
    console.error('Stripe checkout error:', err);
    await sendText(phone, '❌ Payment setup failed. Please try again or contact support.');
    return sendButtons(phone, 'Options:', [
      { id: 'subscribe', title: '🔄 Try Again' },
      { id: 'menu', title: '📋 Menu' }
    ]);
  }
}

// ================= STRIPE WEBHOOK HANDLERS =================
async function handleCheckoutComplete(session) {
  const phone = session.metadata?.phone;
  const plan = session.metadata?.plan;
  
  if (!phone || !plan) {
    console.error('Missing phone or plan in session metadata');
    return;
  }
  
  const expiresAt = new Date();
  if (plan === 'weekly') {
    expiresAt.setDate(expiresAt.getDate() + 7);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }
  
  subscriptions[phone] = {
    status: 'active',
    plan: plan,
    expiresAt: expiresAt.toISOString(),
    stripeCustomerId: session.customer,
    stripeSubscriptionId: session.subscription,
    createdAt: new Date().toISOString()
  };
  
  // Notify user
  try {
    const msg = `🎉 *Payment Successful!*

✅ Your ${plan} subscription is now active!

📅 *Valid until:* ${expiresAt.toLocaleDateString()}

You now have unlimited access to all features. Let's crush your fitness goals! 💪`;

    await sendText(phone, msg);
    await delay(500);
    await sendButtons(phone, 'Start now:', [
      { id: 'today', title: "📅 Today's Plan" },
      { id: 'week', title: '🗓️ Weekly Plan' },
      { id: 'menu', title: '📋 Menu' }
    ]);
  } catch (err) {
    console.error('Failed to notify user:', err);
  }
}

async function handleSubscriptionUpdate(subscription) {
  const phone = subscription.metadata?.phone;
  if (!phone) return;
  
  if (subscription.status === 'active') {
    const periodEnd = new Date(subscription.current_period_end * 1000);
    subscriptions[phone] = {
      ...subscriptions[phone],
      status: 'active',
      expiresAt: periodEnd.toISOString(),
      stripeSubscriptionId: subscription.id
    };
  } else if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
    if (subscriptions[phone]) {
      subscriptions[phone].status = subscription.status;
    }
    
    try {
      await sendText(phone, `⚠️ *Subscription ${subscription.status === 'canceled' ? 'Cancelled' : 'Issue'}*\n\nYour subscription is no longer active. Type "subscribe" to renew.`);
    } catch (err) {
      console.error('Failed to notify user of subscription issue:', err);
    }
  }
}

async function handlePaymentSuccess(invoice) {
  const phone = invoice.subscription_details?.metadata?.phone;
  if (!phone) return;
  
  // Extend subscription
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const periodEnd = new Date(subscription.current_period_end * 1000);
  
  if (subscriptions[phone]) {
    subscriptions[phone].expiresAt = periodEnd.toISOString();
    subscriptions[phone].status = 'active';
  }
  
  try {
    await sendText(phone, `✅ *Payment Received!*\n\nYour subscription has been renewed until ${periodEnd.toLocaleDateString()}. Keep crushing it! 💪`);
  } catch (err) {
    console.error('Failed to notify payment success:', err);
  }
}

async function handlePaymentFailed(invoice) {
  const phone = invoice.subscription_details?.metadata?.phone;
  if (!phone) return;
  
  try {
    await sendText(phone, `❌ *Payment Failed*\n\nWe couldn't process your payment. Please update your payment method to continue your subscription.\n\nType "subscribe" to try again.`);
  } catch (err) {
    console.error('Failed to notify payment failure:', err);
  }
}

// ================= STRIPE INITIALIZATION =================
async function initializeStripePrices() {
  try {
    // Check if prices already exist
    const prices = await stripe.prices.list({ limit: 10, active: true });
    
    for (const price of prices.data) {
      if (price.metadata?.app === 'Ultimate FitBuddy') {
        if (price.recurring?.interval === 'week') {
          PRICE_IDS.weekly = price.id;
        } else if (price.recurring?.interval === 'month') {
          PRICE_IDS.monthly = price.id;
        }
      }
    }
    
    // Create weekly price if not exists
    if (!PRICE_IDS.weekly) {
      const weeklyProduct = await stripe.products.create({
        name: 'Ultimate FitBuddy AI - Weekly Plan',
        description: '7 days unlimited access to personalized fitness plans',
        metadata: { app: 'Ultimate FitBuddy' }
      });
      
      const weeklyPrice = await stripe.prices.create({
        product: weeklyProduct.id,
        unit_amount: SUBSCRIPTION_PLANS.weekly.price * 100, // in paise/cents
        currency: SUBSCRIPTION_PLANS.weekly.currency,
        recurring: { interval: 'week' },
        metadata: { app: 'Ultimate FitBuddy' }
      });
      
      PRICE_IDS.weekly = weeklyPrice.id;
      console.log('✅ Created weekly price:', weeklyPrice.id);
    }
    
    // Create monthly price if not exists
    if (!PRICE_IDS.monthly) {
      const monthlyProduct = await stripe.products.create({
        name: 'Ultimate FitBuddy AI - Monthly Plan',
        description: '30 days unlimited access to personalized fitness plans',
        metadata: { app: 'Ultimate FitBuddy' }
      });
      
      const monthlyPrice = await stripe.prices.create({
        product: monthlyProduct.id,
        unit_amount: SUBSCRIPTION_PLANS.monthly.price * 100,
        currency: SUBSCRIPTION_PLANS.monthly.currency,
        recurring: { interval: 'month' },
        metadata: { app: 'Ultimate FitBuddy' }
      });
      
      PRICE_IDS.monthly = monthlyPrice.id;
      console.log('✅ Created monthly price:', monthlyPrice.id);
    }
    
    console.log('💳 Stripe prices initialized:', PRICE_IDS);
    
  } catch (err) {
    console.error('Failed to initialize Stripe prices:', err);
  }
}

// ================= WEEKLY SCHEDULE =================
function generateWeeklySchedule(data) {
  const schedules = {
    weight_loss: ['full_body', 'cardio', 'upper_body', 'cardio', 'lower_body', 'cardio', 'rest'],
    muscle_gain: ['push', 'pull', 'legs', 'rest', 'upper_body', 'lower_body', 'rest'],
    recomposition: ['full_body', 'cardio', 'push', 'pull', 'legs', 'cardio', 'rest'],
    general_fitness: ['full_body', 'cardio', 'rest', 'full_body', 'cardio', 'rest', 'rest'],
    endurance: ['cardio', 'full_body', 'cardio', 'rest', 'cardio', 'full_body', 'rest'],
    flexibility: ['full_body', 'rest', 'full_body', 'rest', 'full_body', 'rest', 'rest']
  };
  
  return schedules[data.goal] || schedules.general_fitness;
}

async function sendWeekOverview(phone, data) {
  const today = new Date().getDay();
  let msg = `🗓️ *Your Weekly Schedule*\n\n`;
  
  for (let i = 0; i < 7; i++) {
    const dayIndex = (today + i) % 7;
    const dayName = DAYS[dayIndex];
    const workout = data.weekPlan[dayIndex];
    const isToday = i === 0;
    const emoji = workout === 'rest' ? '😴' : '💪';
    const label = workout.replace('_', ' ').toUpperCase();
    
    msg += `${isToday ? '👉 ' : '   '}${emoji} *${dayName}${isToday ? ' (Today)' : ''}:* ${label}\n`;
  }
  
  await sendText(phone, msg);
  
  return sendButtons(phone, 'View plan for:', [
    { id: 'day_0', title: "📅 Today" },
    { id: 'day_1', title: '📆 Tomorrow' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

// ================= PLAN GENERATORS =================
async function generateDayPlan(phone, data, dayOffset = 0) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayOffset);
  const dayIndex = targetDate.getDay();
  const dayName = DAYS[dayIndex];
  const workoutType = data.weekPlan[dayIndex];
  
  const dateStr = targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  
  await sendText(phone, `📅 *${dateStr}*\n\n⏳ Generating your personalized plan...`);
  
  if (workoutType === 'rest') {
    await sendRestDayPlan(phone, data, dayName);
  } else {
    await generateWorkoutPlan(phone, data, workoutType, dayName);
    await delay(2000);
    await generateMealPlan(phone, data, dayName, true);
  }
  
  await delay(1000);
  return sendButtons(phone, 'What next?', [
    { id: 'tomorrow', title: '📆 Tomorrow' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendRestDayPlan(phone, data, dayName) {
  const waterIntake = Math.round(data.weight * 0.033 * 10) / 10;
  
  const msg = `😴 *REST DAY - ${dayName}*

Recovery is when your muscles grow!

🧘 *Active Recovery:*
- 10-15 min gentle stretching
- 20-30 min light walk
- Foam rolling if available

💆 *Self Care:*
- Sleep 7-9 hours tonight
- Drink ${waterIntake}L water
- Light mobility work

${data.injuries ? `\n⚠️ Focus on gentle stretches for: ${data.injuries}` : ''}

_Rest is part of the process!_ 💪`;

  await sendText(phone, msg);
  await delay(1000);
  await generateMealPlan(phone, data, dayName, false);
}

async function generateWorkoutPlan(phone, data, workoutType, dayName) {
  const stats = calculateStats(data);
  const equipmentList = data.equipment.includes('none') 
    ? 'Bodyweight only' 
    : data.equipment.map(e => EQUIPMENT[e]).join(', ');

  const prompt = `Create a ${workoutType.replace('_', ' ')} workout plan.

USER PROFILE:
- Name: ${data.name}
- Age: ${data.age}, Gender: ${data.gender}
- Weight: ${data.weight}kg, Height: ${data.height}cm
- Goal: ${data.goal.replace('_', ' ')}
- Training Location: ${data.trainingPlace}
- Equipment: ${equipmentList}
- Fitness Level: Based on ${ACTIVITY_LEVELS[data.activityLevel]}

HEALTH CONSIDERATIONS:
${data.conditions.length > 0 && !data.conditions.includes('none') ? `- Conditions: ${data.conditions.map(c => CONDITIONS[c]).join(', ')}` : '- No medical conditions'}
${data.injuries ? `- Injuries: ${data.injuries} (AVOID exercises that aggravate this)` : '- No injuries'}
${data.otherConditions ? `- Other: ${data.otherConditions}` : ''}

STRICT RULES:
1. Plain text only - NO markdown (no *, #, _, ~, etc.)
2. Use emojis for visual separation
3. Keep lines short for mobile
4. Use "-" for bullet points
5. Be specific with sets, reps, rest times
6. MUST match available equipment: ${equipmentList}
7. MUST consider injuries and conditions
8. Warm-up and cool-down required

FORMAT EXACTLY:
🏋️ ${workoutType.replace('_', ' ').toUpperCase()} WORKOUT
📅 ${dayName}

⏱️ Duration: [X] minutes
🔥 Est. Calories: [X] kcal

🔥 WARM-UP (5 min)
- [Exercise 1]
- [Exercise 2]

💪 MAIN WORKOUT
[5-7 exercises with sets x reps and rest time]

🧘 COOL-DOWN (5 min)
- [Stretch 1]
- [Stretch 2]

💡 Form tip for ${data.name}

End with motivation using their name.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });

    const workout = completion.choices[0].message.content;
    
    // Send workout image first
    await sendWorkoutImage(phone, data, workoutType);
    await delay(1000);
    await sendText(phone, workout);

  } catch (err) {
    console.error('Workout generation error:', err);
    await sendText(phone, `💪 *${workoutType.replace('_', ' ').toUpperCase()} WORKOUT*\n\n❌ Generation failed. Type "workout" to retry.`);
  }
}

async function generateMealPlan(phone, data, dayName, isWorkoutDay) {
  const stats = calculateStats(data);
  const calories = isWorkoutDay ? stats.calories + 150 : stats.calories - 100;
  
  const prompt = `Create a ${data.diet} meal plan.

USER:
- Name: ${data.name}, Age: ${data.age}, Gender: ${data.gender}
- Weight: ${data.weight}kg, Height: ${data.height}cm
- Goal: ${data.goal.replace('_', ' ')}
- Diet Type: ${data.diet} ONLY (STRICT - no exceptions)
${data.allergies ? `- ALLERGIES/DISLIKES (MUST EXCLUDE): ${data.allergies}` : ''}

NUTRITION TARGETS:
- Daily Calories: ${calories} kcal
- Protein: ${stats.protein}g
- Workout Day: ${isWorkoutDay ? 'Yes' : 'No (rest day)'}

HEALTH CONDITIONS:
${data.conditions.length > 0 && !data.conditions.includes('none') ? data.conditions.map(c => `- ${CONDITIONS[c]}: Adjust food accordingly`).join('\n') : '- None'}

STRICT RULES:
1. Plain text only - NO markdown
2. Use emojis for meals
3. Specific portions (cups, grams, pieces)
4. Include protein per meal
5. ${data.diet === 'vegetarian' ? 'NO meat/fish, eggs OK' : ''}
6. ${data.diet === 'vegan' ? 'NO animal products at all' : ''}
7. ${data.diet === 'non-vegetarian' ? 'Include lean proteins' : ''}
8. ${data.conditions.includes('diabetes') ? 'LOW glycemic foods, minimal sugar' : ''}
9. ${data.conditions.includes('hypertension') ? 'LOW sodium foods' : ''}
${data.allergies ? `10. NEVER include: ${data.allergies}` : ''}

FORMAT EXACTLY:
🍽️ MEAL PLAN - ${dayName}
📊 Target: ${calories} kcal | ${stats.protein}g protein

☀️ BREAKFAST (7-8 AM)
[Meal with portions] - [X] kcal, [X]g protein

${isWorkoutDay ? '🍌 PRE-WORKOUT\n[Light snack] - [X] kcal\n\n' : ''}🍱 LUNCH (12-1 PM)
[Meal with portions] - [X] kcal, [X]g protein

🍎 SNACK (4 PM)
[Snack] - [X] kcal

${isWorkoutDay ? '🥤 POST-WORKOUT\n[Recovery nutrition] - [X] kcal, [X]g protein\n\n' : ''}🌙 DINNER (7-8 PM)
[Meal with portions] - [X] kcal, [X]g protein

💧 Water: ${Math.round(data.weight * 0.033)}L daily

📊 DAILY TOTAL: ~${calories} kcal | ~${stats.protein}g protein`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const mealPlan = completion.choices[0].message.content;
    
    await sendDietImage(phone, data);
    await delay(1000);
    await sendText(phone, mealPlan);

  } catch (err) {
    console.error('Meal plan error:', err);
    await sendText(phone, `🍽️ *MEAL PLAN*\n\n❌ Generation failed. Type "diet" to retry.`);
  }
}

async function generateWorkoutOnly(phone, data) {
  const dayIndex = new Date().getDay();
  const workoutType = data.weekPlan[dayIndex];
  const dayName = DAYS[dayIndex];
  
  if (workoutType === 'rest') {
    await sendText(phone, `😴 Today is a rest day!\n\nWant a workout anyway?`);
    return sendButtons(phone, 'Choose:', [
      { id: 'full_body', title: '🏋️ Full Body' },
      { id: 'cardio', title: '🏃 Cardio' },
      { id: 'menu', title: '📋 Menu' }
    ]);
  }
  
  await sendText(phone, '💪 Generating your workout...');
  await generateWorkoutPlan(phone, data, workoutType, dayName);
  
  return sendButtons(phone, 'What next?', [
    { id: 'diet', title: '🥗 Get Diet Plan' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateDietOnly(phone, data) {
  const dayIndex = new Date().getDay();
  const workoutType = data.weekPlan[dayIndex];
  const dayName = DAYS[dayIndex];
  
  await sendText(phone, '🥗 Preparing your meal plan...');
  await generateMealPlan(phone, data, dayName, workoutType !== 'rest');
  
  return sendButtons(phone, 'What next?', [
    { id: 'workout', title: '💪 Get Workout' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateQuickWorkout(phone, data) {
  const equipmentList = data.equipment.includes('none') 
    ? 'Bodyweight only' 
    : data.equipment.map(e => EQUIPMENT[e]).join(', ');

  const prompt = `Create a quick 15-minute HIIT workout.

USER: ${data.name}, ${data.activityLevel} activity level
EQUIPMENT: ${equipmentList}
GOAL: ${data.goal.replace('_', ' ')}
${data.injuries ? `INJURIES TO AVOID: ${data.injuries}` : ''}

RULES:
- Plain text only, NO markdown
- Exactly 15 minutes
- High intensity, minimal rest
- Match available equipment
- Avoid injury-aggravating moves

FORMAT:
⚡ 15-MIN QUICK BLAST

🔥 THE WORKOUT (3 rounds)
[6-8 exercises, 40 sec work / 20 sec rest]

💪 Go hard, ${data.name}!`;

  try {
    await sendText(phone, '⚡ Creating quick workout...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.8,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    await sendText(phone, completion.choices[0].message.content);
    
  } catch (err) {
    console.error('Quick workout error:', err);
    await sendText(phone, '❌ Could not generate. Try "workout" instead.');
  }
  
  return sendButtons(phone, 'Done?', [
    { id: 'quick', title: '⚡ Another Quick' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendMuscleGroupMenu(phone) {
  const msg = `🎯 *Target Muscle Group*

*Upper Body:*
• chest - Chest/Pecs
• back - Back/Lats  
• shoulders - Shoulders
• arms - Biceps & Triceps

*Lower Body:*
• legs - Quads, Hamstrings, Glutes
• core - Abs & Core

*Combos:*
• full_body - Full Body
• push - Push Day (Chest/Shoulders/Triceps)
• pull - Pull Day (Back/Biceps)
• cardio - Cardio Session

_Type muscle name or tap below:_`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Popular:', [
    { id: 'chest', title: '💪 Chest' },
    { id: 'legs', title: '🦵 Legs' },
    { id: 'full_body', title: '🏋️ Full Body' }
  ]);
}

async function generateMuscleGroupWorkout(phone, data, muscleGroup) {
  await sendText(phone, `🎯 Creating ${muscleGroup.replace('_', ' ')} workout...`);
  await generateWorkoutPlan(phone, data, muscleGroup, 'Today');
  
  return sendButtons(phone, 'What next?', [
    { id: 'muscle', title: '🎯 Another Muscle' },
    { id: 'diet', title: '🥗 Diet Plan' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateNutritionTips(phone, data) {
  const tips = {
    weight_loss: [
      "💡 Eat protein with every meal to stay full longer",
      "💡 Drink water before meals - reduces calorie intake by 13%",
      "💡 Fill half your plate with vegetables",
      "💡 Avoid liquid calories (sodas, juices)",
      "💡 Eat slowly - it takes 20 mins to feel full"
    ],
    muscle_gain: [
      "💡 Eat protein within 30 min post-workout",
      "💡 Aim for 1.6-2.2g protein per kg bodyweight",
      "💡 Don't fear carbs - they fuel your workouts",
      "💡 Eat every 3-4 hours to maintain muscle synthesis",
      "💡 Sleep 7-9 hours - muscles grow during rest"
    ],
    general_fitness: [
      "💡 Balance your plate: protein, carbs, veggies",
      "💡 Stay hydrated throughout the day",
      "💡 Prep meals ahead to avoid bad choices",
      "💡 Don't skip breakfast - it kickstarts metabolism",
      "💡 Eat whole foods over processed ones"
    ]
  };
  
  const goalTips = tips[data.goal] || tips.general_fitness;
  const randomTips = goalTips.sort(() => 0.5 - Math.random()).slice(0, 3);
  
  const msg = `💡 *Nutrition Tips for ${data.name}*\n\n${randomTips.join('\n\n')}\n\n_Based on your ${data.goal.replace('_', ' ')} goal_`;
  
  await sendText(phone, msg);
  
  return sendButtons(phone, 'What next?', [
    { id: 'diet', title: '🥗 Get Meal Plan' },
    { id: 'tips', title: '💡 More Tips' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendProgressSummary(phone, user) {
  const stats = calculateStats(user.data);
  const history = user.history || [];
  
  const msg = `📊 *Progress Summary*

👤 *${user.data.name}*
⚖️ Current: ${user.data.weight}kg
📏 Height: ${user.data.height}cm
📈 BMI: ${stats.bmi} (${stats.bmiCategory})

🎯 *Daily Targets:*
- Calories: ${stats.calories} kcal
- Protein: ${stats.protein}g
- Water: ${Math.round(user.data.weight * 0.033)}L

🏆 *Activity:*
- Plans Generated: ${history.length}
- Member Since: ${new Date(user.createdAt).toLocaleDateString()}

💪 Keep pushing, ${user.data.name}!`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Options:', [
    { id: 'profile', title: '👤 Full Profile' },
    { id: 'today', title: "📅 Today's Plan" },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendMotivation(phone, data) {
  const quotes = [
    "The only bad workout is the one that didn't happen.",
    "Your body can stand almost anything. It's your mind you have to convince.",
    "Don't wish for it. Work for it.",
    "Strive for progress, not perfection.",
    "The hard days are what make you stronger.",
    "Success is what comes after you stop making excuses.",
    "Your only limit is you."
  ];
  
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  
  await sendMotivationalImage(phone, data);
  await delay(1000);
  await sendText(phone, `🔥 *Daily Motivation*\n\n"${quote}"\n\n💪 You've got this, ${data.name}!`);
  
  return sendButtons(phone, 'Let\'s go!', [
    { id: 'today', title: "📅 Today's Plan" },
    { id: 'quick', title: '⚡ Quick Workout' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

// ================= IMAGE GENERATION (Fixed) =================
async function sendWorkoutImage(phone, data, workoutType) {
  try {
    const workoutDesc = {
      chest: 'person doing bench press chest workout',
      back: 'person doing lat pulldown back workout',
      shoulders: 'person doing shoulder press workout',
      arms: 'person doing bicep curl arm workout',
      legs: 'person doing squat leg workout',
      core: 'person doing plank core abs workout',
      full_body: 'person doing full body functional training',
      upper_body: 'person doing upper body dumbbell workout',
      lower_body: 'person doing leg press lower body workout',
      push: 'person doing push up chest workout',
      pull: 'person doing pull up back workout',
      cardio: 'person running cardio training'
    };
    
    const desc = workoutDesc[workoutType] || 'person doing fitness workout';
    const location = data.trainingPlace === 'gym' ? 'in modern gym' : data.trainingPlace === 'home' ? 'at home' : 'outdoors';
    
    const prompt = `${desc} ${location}, fitness motivation, professional photography, athletic, dynamic lighting, high quality`;
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 100000);
    
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&seed=${seed}`;
    
    // Pre-fetch to ensure image is ready
    await axios.get(imageUrl, { timeout: 15000, responseType: 'arraybuffer' });
    
    await sendImage(phone, imageUrl, `💪 ${workoutType.replace('_', ' ').toUpperCase()} WORKOUT`);
  } catch (err) {
    console.error('Workout image error:', err.message);
    // Skip image silently
  }
}

async function sendDietImage(phone, data) {
  try {
    const dietDesc = {
      vegetarian: 'healthy vegetarian meal with vegetables legumes paneer',
      'non-vegetarian': 'healthy protein meal grilled chicken vegetables rice',
      vegan: 'colorful vegan plant based meal vegetables fruits grains',
      eggetarian: 'healthy meal with eggs vegetables whole grains'
    };
    
    const desc = dietDesc[data.diet] || 'healthy balanced nutritious meal';
    
    const prompt = `${desc}, meal prep, healthy eating, beautiful food photography, natural lighting, top view, food magazine style`;
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 100000);
    
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&seed=${seed}`;
    
    // Pre-fetch to ensure image is ready
    await axios.get(imageUrl, { timeout: 15000, responseType: 'arraybuffer' });
    
    await sendImage(phone, imageUrl, `🥗 YOUR ${data.diet.toUpperCase()} MEAL PLAN`);
  } catch (err) {
    console.error('Diet image error:', err.message);
  }
}

async function sendMotivationalImage(phone, data) {
  try {
    const goalDesc = {
      weight_loss: 'fit person weight loss transformation success',
      muscle_gain: 'muscular athletic person bodybuilding success',
      general_fitness: 'healthy fit person exercising happy',
      recomposition: 'athletic toned person fitness transformation',
      endurance: 'runner athlete endurance training',
      flexibility: 'person doing yoga stretching flexibility'
    };
    
    const desc = goalDesc[data.goal] || 'fitness motivation success';
    
    const prompt = `${desc}, motivational, inspiring, sunrise, determination, epic cinematic lighting, professional photography`;
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 100000);
    
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&seed=${seed}`;
    
    await axios.get(imageUrl, { timeout: 15000, responseType: 'arraybuffer' });
    
    await sendImage(phone, imageUrl, `🔥 STAY FOCUSED, ${data.name.toUpperCase()}!`);
  } catch (err) {
    console.error('Motivation image error:', err.message);
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
        buttons: buttons.slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.substring(0, 20) }
        }))
      }
    }
  });
}

async function whatsappRequest(data) {
  try {
    const res = await axios.post(WHATSAPP_API_URL, data, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    return res;
  } catch (err) {
    console.error('WhatsApp API error:', err.response?.data || err.message);
    throw err;
  }
}

// ================= UTILITIES =================
function calculateStats(data) {
  const bmi = (data.weight / Math.pow(data.height / 100, 2)).toFixed(1);
  
  let bmiCategory;
  if (bmi < 18.5) bmiCategory = 'Underweight';
  else if (bmi < 25) bmiCategory = 'Normal';
  else if (bmi < 30) bmiCategory = 'Overweight';
  else bmiCategory = 'Obese';
  
  // Mifflin-St Jeor
  let bmr;
  if (data.gender === 'male') {
    bmr = 10 * data.weight + 6.25 * data.height - 5 * data.age + 5;
  } else {
    bmr = 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  }
  
  const activityMultipliers = {
    sedentary: 1.2,
    lightly_active: 1.375,
    active: 1.55,
    very_active: 1.725
  };
  
  const tdee = Math.round(bmr * (activityMultipliers[data.activityLevel] || 1.375));
  
  let calories;
  if (data.goal === 'weight_loss') calories = tdee - 500;
  else if (data.goal === 'muscle_gain') calories = tdee + 300;
  else if (data.goal === 'recomposition') calories = tdee;
  else calories = tdee;
  
  let proteinMultiplier;
  if (data.goal === 'muscle_gain') proteinMultiplier = 2.0;
  else if (data.goal === 'weight_loss' || data.goal === 'recomposition') proteinMultiplier = 1.8;
  else proteinMultiplier = 1.4;
  
  const protein = Math.round(data.weight * proteinMultiplier);
  
  return { bmi, bmiCategory, bmr: Math.round(bmr), calories, protein };
}

function capitalizeWords(str) {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================= SESSION CLEANUP =================
setInterval(() => {
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const phone in users) {
    if (now - users[phone].createdAt > threeDays) {
      delete users[phone];
    }
  }
}, 60 * 60 * 1000);

// ================= START =================
app.listen(PORT, async () => {
  console.log(`🏋️ Ultimate FitBuddy AI running on port ${PORT}`);
  console.log(`📱 Webhook ready at /`);
  console.log(`💳 Stripe webhook at /stripe-webhook`);
  console.log(`❤️ Health check at /health`);
  
  // Initialize Stripe prices
  await initializeStripePrices();
});
