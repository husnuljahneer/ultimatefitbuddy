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

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'full_body', 'upper_body', 'lower_body', 'push', 'pull', 'cardio'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
app.get('/health', (req, res) => res.json({ status: 'ok', users: Object.keys(users).length, timestamp: new Date().toISOString() }));

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
    console.error('Handler error:', err);
    await sendText(phone, '❌ Something went wrong. Type "menu" to see options.');
  }
});

// ================= MAIN MESSAGE HANDLER =================
async function handleMessage(phone, text, interactiveId) {
  const input = interactiveId || text;
  
  // Global commands (work anytime)
  if (['restart', 'reset', 'start over', 'start'].includes(text)) {
    delete users[phone];
    return sendWelcome(phone);
  }
  
  if (['menu', 'help', 'options'].includes(text) && users[phone]?.step === 'COMPLETE') {
    return sendMainMenu(phone, users[phone].data.name);
  }

  // Initialize new user
  if (!users[phone]) {
    users[phone] = { step: 'WELCOME', data: {}, history: [], createdAt: Date.now() };
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
async function handleOnboarding(phone, user, input, text) {
  switch (user.step) {
    case 'WELCOME':
      user.data.name = capitalizeWords(text);
      user.step = 'PROFILE';
      return sendProfilePrompt(phone, user.data.name);

    case 'PROFILE':
      const profile = parseProfile(text);
      if (!profile) {
        return sendText(phone, '❌ Please use format: *age height(cm) weight(kg)*\n\nExample: 25 175 70');
      }
      Object.assign(user.data, profile);
      user.step = 'GENDER';
      return sendGenderButtons(phone);

    case 'GENDER':
      if (!['male', 'female'].includes(input)) return sendGenderButtons(phone);
      user.data.gender = input;
      user.step = 'GOAL';
      return sendGoalButtons(phone);

    case 'GOAL':
      const goal = GOALS[input] || input;
      if (!Object.values(GOALS).includes(goal)) return sendGoalButtons(phone);
      user.data.goal = goal;
      user.step = 'DIET';
      return sendDietButtons(phone);

    case 'DIET':
      const diet = DIETS[input] || input;
      if (!Object.values(DIETS).includes(diet)) return sendDietButtons(phone);
      user.data.diet = diet;
      user.step = 'PLACE';
      return sendPlaceButtons(phone);

    case 'PLACE':
      const place = PLACES[input] || input;
      if (!Object.values(PLACES).includes(place)) return sendPlaceButtons(phone);
      user.data.place = place;
      user.step = 'LEVEL';
      return sendLevelButtons(phone);

    case 'LEVEL':
      const level = LEVELS[input] || input;
      if (!Object.values(LEVELS).includes(level)) return sendLevelButtons(phone);
      user.data.level = level;
      user.data.weekPlan = generateWeeklySchedule(user.data);
      user.step = 'COMPLETE';
      
      await sendProfileSummary(phone, user.data);
      await delay(1000);
      await sendText(phone, '🎉 *Setup complete!* Your personalized fitness journey begins now.');
      await delay(500);
      return sendMainMenu(phone, user.data.name);

    default:
      return sendText(phone, 'Type "restart" to begin again.');
  }
}

// ================= COMPLETED USER ACTIONS =================
async function handleCompletedUserAction(phone, user, input) {
  const actions = {
    'menu': () => sendMainMenu(phone, user.data.name),
    'today': () => generateDayPlan(phone, user.data, 0),
    'tomorrow': () => generateDayPlan(phone, user.data, 1),
    'week': () => sendWeekOverview(phone, user.data),
    'workout_only': () => generateWorkoutOnly(phone, user.data),
    'diet_only': () => generateDietOnly(phone, user.data),
    'quick_workout': () => generateQuickWorkout(phone, user.data),
    'muscle_group': () => sendMuscleGroupMenu(phone),
    'progress': () => sendProgressSummary(phone, user),
    'tips': () => generateDailyTips(phone, user.data),
    'motivation': () => sendMotivationalContent(phone, user.data),
    'update_profile': () => { user.step = 'PROFILE'; return sendProfilePrompt(phone, user.data.name); },
    'update_goal': () => { user.step = 'GOAL'; return sendGoalButtons(phone); },
    'restart': () => { delete users[phone]; return sendWelcome(phone); }
  };

  // Check for muscle group selection
  if (MUSCLE_GROUPS.includes(input)) {
    return generateMuscleGroupWorkout(phone, user.data, input);
  }

  // Check for day selection (day_0, day_1, etc.)
  if (input.startsWith('day_')) {
    const dayOffset = parseInt(input.split('_')[1]);
    return generateDayPlan(phone, user.data, dayOffset);
  }

  const action = actions[input];
  if (action) return action();
  
  // Default: show menu
  return sendMainMenu(phone, user.data.name);
}

// ================= ONBOARDING MESSAGES =================
async function sendWelcome(phone) {
  const msg = `🏋️ *FitCoach AI* 🏋️

Your personal AI-powered fitness coach!

I'll create customized:
- Daily workout plans
- Personalized meal plans  
- Weekly schedules
- Progress tracking

Let's get started! *What's your name?*`;
  return sendText(phone, msg);
}

async function sendProfilePrompt(phone, name) {
  return sendText(phone, `Great, ${name}! 👋\n\nNow your stats. Reply with:\n*age  height(cm)  weight(kg)*\n\nExample: *28 175 72*`);
}

async function sendGenderButtons(phone) {
  return sendButtons(phone, '👤 *Select your gender:*\n\n(For accurate calorie calculations)', [
    { id: 'male', title: '👨 Male' },
    { id: 'female', title: '👩 Female' }
  ]);
}

async function sendGoalButtons(phone) {
  return sendButtons(phone, '🎯 *What\'s your primary goal?*', [
    { id: 'muscle_gain', title: '💪 Build Muscle' },
    { id: 'fat_loss', title: '🔥 Lose Fat' },
    { id: 'maintenance', title: '⚖️ Stay Fit' }
  ]);
}

async function sendDietButtons(phone) {
  return sendButtons(phone, '🍽️ *Your diet preference?*', [
    { id: 'vegetarian', title: '🥗 Vegetarian' },
    { id: 'non-vegetarian', title: '🍗 Non-Veg' },
    { id: 'vegan', title: '🌱 Vegan' }
  ]);
}

async function sendPlaceButtons(phone) {
  return sendButtons(phone, '📍 *Where do you workout?*', [
    { id: 'home', title: '🏠 Home' },
    { id: 'gym', title: '🏋️ Gym' },
    { id: 'outdoor', title: '🌳 Outdoor' }
  ]);
}

async function sendLevelButtons(phone) {
  return sendButtons(phone, '💪 *Your fitness level?*', [
    { id: 'beginner', title: '🌟 Beginner' },
    { id: 'intermediate', title: '⭐ Intermediate' },
    { id: 'advanced', title: '🔥 Advanced' }
  ]);
}

async function sendProfileSummary(phone, data) {
  const stats = calculateStats(data);
  const msg = `✅ *Profile Created!*

👤 ${data.name} (${data.gender})
📊 ${data.age} yrs | ${data.height}cm | ${data.weight}kg

📈 *Your Stats:*
- BMI: ${stats.bmi} (${stats.bmiCategory})
- Daily Calories: ${stats.calories} kcal
- Protein Target: ${stats.protein}g

🎯 ${GOAL_LABELS[data.goal]}
🍽️ ${DIET_LABELS[data.diet]}
📍 ${PLACE_LABELS[data.place]}
💪 ${LEVEL_LABELS[data.level]}`;
  return sendText(phone, msg);
}

// ================= MAIN MENU =================
async function sendMainMenu(phone, name) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  
  return sendList(phone, 
    `${greeting}, ${name}! 👋\n\nWhat would you like today?`,
    'View Options',
    [
      {
        title: '📋 Daily Plans',
        rows: [
          { id: 'today', title: "📅 Today's Full Plan", description: 'Workout + Diet + Tips' },
          { id: 'tomorrow', title: "📆 Tomorrow's Plan", description: 'Plan ahead for tomorrow' },
          { id: 'week', title: '🗓️ Weekly Overview', description: 'See your 7-day schedule' }
        ]
      },
      {
        title: '🏋️ Workouts',
        rows: [
          { id: 'workout_only', title: '💪 Workout Only', description: 'Just the exercise plan' },
          { id: 'quick_workout', title: '⚡ Quick 15-min', description: 'Short on time?' },
          { id: 'muscle_group', title: '🎯 Target Muscle', description: 'Focus on specific area' }
        ]
      },
      {
        title: '🍽️ Nutrition',
        rows: [
          { id: 'diet_only', title: '🥗 Diet Plan Only', description: 'Meals for today' },
          { id: 'tips', title: '💡 Nutrition Tips', description: 'Personalized advice' }
        ]
      },
      {
        title: '⚙️ Settings',
        rows: [
          { id: 'progress', title: '📊 My Progress', description: 'Track your journey' },
          { id: 'motivation', title: '🔥 Motivation', description: 'Get inspired!' },
          { id: 'update_goal', title: '🎯 Change Goal', description: 'Update your target' },
          { id: 'restart', title: '🔄 Start Fresh', description: 'Reset everything' }
        ]
      }
    ]
  );
}

async function sendMuscleGroupMenu(phone) {
  return sendList(phone,
    '🎯 *Target Muscle Group*\n\nSelect the area you want to train:',
    'Select Muscle',
    [
      {
        title: 'Upper Body',
        rows: [
          { id: 'chest', title: '🫁 Chest', description: 'Pecs, push movements' },
          { id: 'back', title: '🔙 Back', description: 'Lats, pull movements' },
          { id: 'shoulders', title: '💪 Shoulders', description: 'Delts, overhead' },
          { id: 'arms', title: '💪 Arms', description: 'Biceps & Triceps' }
        ]
      },
      {
        title: 'Lower Body & Core',
        rows: [
          { id: 'legs', title: '🦵 Legs', description: 'Quads, hamstrings, glutes' },
          { id: 'core', title: '🧘 Core', description: 'Abs, obliques, lower back' }
        ]
      },
      {
        title: 'Combo Workouts',
        rows: [
          { id: 'full_body', title: '🏋️ Full Body', description: 'Hit everything' },
          { id: 'push', title: '⬆️ Push Day', description: 'Chest, shoulders, triceps' },
          { id: 'pull', title: '⬇️ Pull Day', description: 'Back, biceps' },
          { id: 'cardio', title: '🏃 Cardio', description: 'Heart-pumping session' }
        ]
      }
    ]
  );
}

// ================= WEEKLY SCHEDULE GENERATOR =================
function generateWeeklySchedule(data) {
  const schedules = {
    muscle_gain: {
      beginner: ['full_body', 'rest', 'full_body', 'rest', 'full_body', 'cardio', 'rest'],
      intermediate: ['push', 'pull', 'legs', 'rest', 'upper_body', 'lower_body', 'rest'],
      advanced: ['chest', 'back', 'shoulders', 'legs', 'arms', 'full_body', 'rest']
    },
    fat_loss: {
      beginner: ['cardio', 'full_body', 'rest', 'cardio', 'full_body', 'cardio', 'rest'],
      intermediate: ['full_body', 'cardio', 'full_body', 'cardio', 'full_body', 'cardio', 'rest'],
      advanced: ['push', 'cardio', 'pull', 'cardio', 'legs', 'cardio', 'rest']
    },
    maintenance: {
      beginner: ['full_body', 'cardio', 'rest', 'full_body', 'cardio', 'rest', 'rest'],
      intermediate: ['upper_body', 'cardio', 'lower_body', 'rest', 'full_body', 'cardio', 'rest'],
      advanced: ['push', 'pull', 'cardio', 'legs', 'full_body', 'cardio', 'rest']
    }
  };
  
  const goalSchedule = schedules[data.goal] || schedules.maintenance;
  return goalSchedule[data.level] || goalSchedule.beginner;
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
    
    msg += `${isToday ? '👉 ' : ''}${emoji} *${dayName}${isToday ? ' (Today)' : ''}:* ${label}\n`;
  }
  
  msg += `\n_Tap a day to see the full plan_`;
  
  await sendText(phone, msg);
  
  return sendButtons(phone, 'View detailed plan:', [
    { id: 'day_0', title: "📅 Today" },
    { id: 'day_1', title: '📆 Tomorrow' },
    { id: 'day_2', title: DAYS[(today + 2) % 7] }
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
  
  await sendText(phone, `📅 *Plan for ${dateStr}*\n\n⏳ Generating your personalized plan...`);
  
  // Track for progress
  if (dayOffset === 0) {
    users[phone].history.push({ date: new Date().toISOString().split('T')[0], type: 'full_plan' });
  }
  
  if (workoutType === 'rest') {
    await sendRestDayPlan(phone, data, dayName);
  } else {
    await generateWorkoutPlan(phone, data, workoutType, dayName);
    await delay(1500);
    await generateMealPlan(phone, data, dayName, workoutType !== 'rest');
  }
  
  await delay(1000);
  await generateDailyTips(phone, data);
  
  await delay(500);
  return sendButtons(phone, '📱 *Quick Actions*', [
    { id: 'tomorrow', title: "📆 Tomorrow" },
    { id: 'menu', title: '📋 Main Menu' }
  ]);
}

async function sendRestDayPlan(phone, data, dayName) {
  const msg = `😴 *REST DAY - ${dayName}*

Your muscles grow during rest! Today focus on:

🧘 *Active Recovery:*
- 10-15 min light stretching
- 20-30 min walk
- Foam rolling if available

💆 *Self Care:*
- Get 7-9 hours sleep tonight
- Stay hydrated (${Math.round(data.weight * 0.033)}L water)
- Light mobility work

_Rest is part of the process!_`;

  await sendText(phone, msg);
  
  // Still send diet for rest day
  await delay(1000);
  await generateMealPlan(phone, data, dayName, false);
}

async function generateWorkoutPlan(phone, data, workoutType, dayName) {
  const prompt = `Create a ${workoutType.replace('_', ' ')} workout plan.

USER: ${data.name}, ${data.age}yo ${data.gender}, ${data.weight}kg
GOAL: ${data.goal.replace('_', ' ')}
LOCATION: ${data.place}
LEVEL: ${data.level}

RULES:
- Plain text only, NO markdown (no *, #, _, ~)
- Use emojis for visual separation
- Keep lines short (mobile-friendly)
- Use "-" for bullets
- Be specific with reps, sets, rest times
- Match exercises to their location (${data.place})
- Match intensity to level (${data.level})

FORMAT:
🏋️ ${workoutType.replace('_', ' ').toUpperCase()} WORKOUT - ${dayName}

⏱️ Duration: [X] minutes

🔥 WARM-UP (5 min)
[2-3 dynamic exercises]

💪 MAIN WORKOUT
[5-7 exercises with sets x reps, rest time]
[Progressive difficulty]

🧘 COOL-DOWN (5 min)
[2-3 stretches]

📊 TARGET
- Calories burn: ~[X] kcal
- Focus: [main muscles]

End with one motivating line for ${data.name}.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const workout = completion.choices[0].message.content;
    
    // Send workout image first
    await sendWorkoutImage(phone, data, workoutType);
    await delay(500);
    
    // Then send workout plan
    await sendText(phone, workout);

  } catch (err) {
    console.error('Workout generation error:', err.message);
    await sendText(phone, `💪 *${workoutType.replace('_', ' ').toUpperCase()} WORKOUT*\n\n❌ Couldn't generate workout. Try again with "workout_only"`);
  }
}

async function generateMealPlan(phone, data, dayName, isWorkoutDay) {
  const stats = calculateStats(data);
  const calories = isWorkoutDay ? stats.calories + 200 : stats.calories - 100;
  
  const prompt = `Create a ${data.diet} meal plan.

USER: ${data.name}, ${data.age}yo ${data.gender}, ${data.weight}kg, ${data.height}cm
GOAL: ${data.goal.replace('_', ' ')}
DIET: ${data.diet} ONLY (strict - no exceptions)
DAILY CALORIES: ${calories} kcal
PROTEIN TARGET: ${stats.protein}g
WORKOUT DAY: ${isWorkoutDay ? 'Yes - include pre/post workout nutrition' : 'No - rest day'}

RULES:
- Plain text only, NO markdown (no *, #, _, ~)
- Use emojis for meals
- Specific portions (cups, grams, pieces)
- Include protein content per meal
- ${data.diet === 'vegetarian' ? 'NO meat, fish, eggs OK' : ''}
- ${data.diet === 'vegan' ? 'NO animal products at all' : ''}
- ${data.diet === 'keto' ? 'Very low carb, high fat' : ''}
- Realistic, easy to prepare meals

FORMAT:
🍽️ MEAL PLAN - ${dayName}
📊 Target: ${calories} kcal | ${stats.protein}g protein

☀️ BREAKFAST (7-8 AM)
[Meal with portions] - [X] kcal, [X]g protein

${isWorkoutDay ? '🍌 PRE-WORKOUT (30 min before)\n[Light snack] - [X] kcal\n\n' : ''}🍱 LUNCH (12-1 PM)
[Meal with portions] - [X] kcal, [X]g protein

🍎 SNACK (4 PM)
[Snack] - [X] kcal, [X]g protein

${isWorkoutDay ? '🥤 POST-WORKOUT (within 30 min)\n[Recovery nutrition] - [X] kcal, [X]g protein\n\n' : ''}🌙 DINNER (7-8 PM)
[Meal with portions] - [X] kcal, [X]g protein

💧 HYDRATION: ${Math.round(data.weight * 0.033)}L water throughout the day

📊 TOTAL: ~${calories} kcal | ~${stats.protein}g protein`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const mealPlan = completion.choices[0].message.content;
    
    // Send diet image first
    await sendDietImage(phone, data);
    await delay(500);
    
    // Then send meal plan
    await sendText(phone, mealPlan);

  } catch (err) {
    console.error('Meal plan error:', err.message);
    await sendText(phone, `🍽️ *MEAL PLAN*\n\n❌ Couldn't generate meals. Try again with "diet_only"`);
  }
}

async function generateWorkoutOnly(phone, data) {
  const dayIndex = new Date().getDay();
  const workoutType = data.weekPlan[dayIndex];
  const dayName = DAYS[dayIndex];
  
  if (workoutType === 'rest') {
    await sendText(phone, `😴 Today is a rest day!\n\nWant a workout anyway?`);
    return sendButtons(phone, 'Choose workout:', [
      { id: 'full_body', title: '🏋️ Full Body' },
      { id: 'cardio', title: '🏃 Cardio' },
      { id: 'menu', title: '📋 Menu' }
    ]);
  }
  
  users[phone].history.push({ date: new Date().toISOString().split('T')[0], type: 'workout' });
  
  await sendText(phone, '💪 Generating your workout...');
  await generateWorkoutPlan(phone, data, workoutType, dayName);
  
  return sendButtons(phone, 'What next?', [
    { id: 'diet_only', title: '🥗 Get Diet Plan' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateDietOnly(phone, data) {
  const dayIndex = new Date().getDay();
  const workoutType = data.weekPlan[dayIndex];
  const dayName = DAYS[dayIndex];
  const isWorkoutDay = workoutType !== 'rest';
  
  users[phone].history.push({ date: new Date().toISOString().split('T')[0], type: 'diet' });
  
  await sendText(phone, '🥗 Preparing your meal plan...');
  await generateMealPlan(phone, data, dayName, isWorkoutDay);
  
  return sendButtons(phone, 'What next?', [
    { id: 'workout_only', title: '💪 Get Workout' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateQuickWorkout(phone, data) {
  const prompt = `Create a quick 15-minute high-intensity workout.

USER: ${data.name}, ${data.level} level
LOCATION: ${data.place}
GOAL: ${data.goal.replace('_', ' ')}

RULES:
- Plain text only, NO markdown
- Exactly 15 minutes total
- No equipment needed (or minimal for ${data.place})
- High intensity, minimal rest
- Full body engagement

FORMAT:
⚡ QUICK 15-MIN BLAST

🔥 THE WORKOUT
[6-8 exercises]
[Each: 40 sec work / 20 sec rest]
[2 rounds total]

💪 Let's go ${data.name}! No excuses, just 15 minutes!`;

  try {
    await sendText(phone, '⚡ Creating your quick workout...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.8,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    await sendText(phone, completion.choices[0].message.content);
    
  } catch (err) {
    console.error('Quick workout error:', err.message);
    await sendText(phone, '❌ Could not generate quick workout. Try "workout_only" instead.');
  }
  
  return sendButtons(phone, 'Done?', [
    { id: 'quick_workout', title: '⚡ Another Quick One' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateMuscleGroupWorkout(phone, data, muscleGroup) {
  users[phone].history.push({ date: new Date().toISOString().split('T')[0], type: muscleGroup });
  
  await sendText(phone, `🎯 Creating your ${muscleGroup.replace('_', ' ')} workout...`);
  await generateWorkoutPlan(phone, data, muscleGroup, 'Today');
  
  return sendButtons(phone, 'What next?', [
    { id: 'muscle_group', title: '🎯 Another Muscle' },
    { id: 'diet_only', title: '🥗 Diet Plan' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function generateDailyTips(phone, data) {
  const tips = {
    muscle_gain: [
      "💡 Eat protein within 30 min after workout for max gains",
      "💡 Progressive overload: Add weight or reps each week",
      "💡 Sleep 7-9 hours - muscles grow during rest",
      "💡 Aim for 1.6-2.2g protein per kg bodyweight"
    ],
    fat_loss: [
      "💡 Stay in a 300-500 calorie deficit for sustainable loss",
      "💡 Drink water before meals to reduce hunger",
      "💡 HIIT burns more fat in less time than steady cardio",
      "💡 Don't skip meals - it slows metabolism"
    ],
    maintenance: [
      "💡 Consistency beats intensity - show up every day",
      "💡 Mix cardio and strength for overall fitness",
      "💡 Listen to your body - rest when needed",
      "💡 Keep workouts fun to stay motivated long-term"
    ]
  };
  
  const goalTips = tips[data.goal] || tips.maintenance;
  const randomTip = goalTips[Math.floor(Math.random() * goalTips.length)];
  
  return sendText(phone, `\n${randomTip}\n\n_Type "tips" for more advice!_`);
}

async function sendProgressSummary(phone, user) {
  const history = user.history || [];
  const thisWeek = history.filter(h => {
    const d = new Date(h.date);
    const now = new Date();
    const weekAgo = new Date(now.setDate(now.getDate() - 7));
    return d >= weekAgo;
  });
  
  const stats = calculateStats(user.data);
  
  const msg = `📊 *Your Progress*

👤 *Profile*
- Current: ${user.data.weight}kg
- BMI: ${stats.bmi} (${stats.bmiCategory})
- Daily Target: ${stats.calories} kcal

📈 *This Week*
- Plans Generated: ${thisWeek.length}
- Workouts: ${thisWeek.filter(h => h.type !== 'diet').length}
- Diet Plans: ${thisWeek.filter(h => h.type === 'diet' || h.type === 'full_plan').length}

🎯 *Goal: ${GOAL_LABELS[user.data.goal]}*

💪 Keep going, ${user.data.name}! Consistency is key!`;

  await sendText(phone, msg);
  
  return sendButtons(phone, 'Update your stats?', [
    { id: 'update_profile', title: '📊 Update Weight' },
    { id: 'update_goal', title: '🎯 Change Goal' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

async function sendMotivationalContent(phone, data) {
  const quotes = [
    "The only bad workout is the one that didn't happen.",
    "Your body can stand almost anything. It's your mind you have to convince.",
    "The pain you feel today will be the strength you feel tomorrow.",
    "Don't wish for it. Work for it.",
    "Strive for progress, not perfection.",
    "The hard days are what make you stronger.",
    "Your only limit is you."
  ];
  
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  
  await sendMotivationalImage(phone, data);
  await delay(500);
  await sendText(phone, `🔥 *Daily Motivation*\n\n"${quote}"\n\n💪 You've got this, ${data.name}!`);
  
  return sendButtons(phone, 'Ready to crush it?', [
    { id: 'today', title: "📅 Today's Plan" },
    { id: 'quick_workout', title: '⚡ Quick Workout' },
    { id: 'menu', title: '📋 Menu' }
  ]);
}

// ================= IMAGE GENERATION =================
async function sendWorkoutImage(phone, data, workoutType) {
  try {
    const workoutDescriptions = {
      chest: 'chest press bench workout',
      back: 'back lat pulldown rowing',
      shoulders: 'shoulder press deltoid workout',
      arms: 'bicep curl tricep workout',
      legs: 'squat leg press workout',
      core: 'abs plank core workout',
      full_body: 'full body functional training',
      upper_body: 'upper body strength training',
      lower_body: 'leg day squats lunges',
      push: 'push day chest shoulders triceps',
      pull: 'pull day back biceps rowing',
      cardio: 'cardio running hiit training'
    };
    
    const workoutDesc = workoutDescriptions[workoutType] || 'fitness workout training';
    const location = data.place === 'home' ? 'home workout' : data.place === 'gym' ? 'modern gym' : 'outdoor exercise';
    
    const prompt = encodeURIComponent(
      `Professional fitness photography, ${data.gender} athlete doing ${workoutDesc}, ${location}, ` +
      `athletic motivation, high energy, dynamic pose, professional lighting, 4k quality, fitness magazine style`
    );
    
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true&seed=${Date.now()}`;
    
    await sendImage(phone, imageUrl, `💪 ${workoutType.replace('_', ' ').toUpperCase()} WORKOUT`);
  } catch (err) {
    console.error('Workout image error:', err.message);
  }
}

async function sendDietImage(phone, data) {
  try {
    const dietDescriptions = {
      vegetarian: 'vegetarian healthy meal colorful vegetables legumes',
      'non-vegetarian': 'healthy protein meal grilled chicken fish vegetables',
      vegan: 'vegan plant based meal colorful vegetables fruits grains',
      keto: 'keto low carb meal avocado eggs healthy fats'
    };
    
    const dietDesc = dietDescriptions[data.diet] || 'healthy balanced meal';
    
    const prompt = encodeURIComponent(
      `Professional food photography, ${dietDesc}, meal prep, healthy eating, ` +
      `fresh ingredients, beautiful plating, natural lighting, 4k quality, food magazine style`
    );
    
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true&seed=${Date.now()}`;
    
    await sendImage(phone, imageUrl, `🥗 YOUR ${data.diet.toUpperCase()} MEAL PLAN`);
  } catch (err) {
    console.error('Diet image error:', err.message);
  }
}

async function sendMotivationalImage(phone, data) {
  try {
    const prompt = encodeURIComponent(
      `Motivational fitness poster, ${data.goal.replace('_', ' ')}, inspirational, ` +
      `${data.gender} athlete, determination, success, epic lighting, cinematic, 4k`
    );
    
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true&seed=${Date.now()}`;
    
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

async function sendList(to, bodyText, buttonText, sections) {
  return whatsappRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.substring(0, 20),
        sections: sections.map(s => ({
          title: s.title.substring(0, 24),
          rows: s.rows.map(r => ({
            id: r.id,
            title: r.title.substring(0, 24),
            description: r.description?.substring(0, 72)
          }))
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
      }
    });
    return res;
  } catch (err) {
    console.error('WhatsApp API error:', err.response?.data || err.message);
    throw err;
  }
}

// ================= UTILITIES =================
function parseProfile(text) {
  const nums = text.match(/\d+\.?\d*/g);
  if (!nums || nums.length < 3) return null;
  
  const [age, height, weight] = nums.map(Number);
  
  if (age < 13 || age > 100) return null;
  if (height < 100 || height > 250) return null;
  if (weight < 30 || weight > 300) return null;
  
  return { age: Math.round(age), height: Math.round(height), weight: Math.round(weight * 10) / 10 };
}

function calculateStats(data) {
  const bmi = (data.weight / Math.pow(data.height / 100, 2)).toFixed(1);
  
  let bmiCategory;
  if (bmi < 18.5) bmiCategory = 'Underweight';
  else if (bmi < 25) bmiCategory = 'Normal';
  else if (bmi < 30) bmiCategory = 'Overweight';
  else bmiCategory = 'Obese';
  
  // Mifflin-St Jeor equation
  let bmr;
  if (data.gender === 'male') {
    bmr = 10 * data.weight + 6.25 * data.height - 5 * data.age + 5;
  } else {
    bmr = 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  }
  
  // Activity multiplier based on level
  const multipliers = { beginner: 1.4, intermediate: 1.6, advanced: 1.8 };
  const tdee = Math.round(bmr * (multipliers[data.level] || 1.5));
  
  // Adjust for goal
  let calories;
  if (data.goal === 'fat_loss') calories = tdee - 400;
  else if (data.goal === 'muscle_gain') calories = tdee + 300;
  else calories = tdee;
  
  // Protein based on goal
  let proteinMultiplier;
  if (data.goal === 'muscle_gain') proteinMultiplier = 2.0;
  else if (data.goal === 'fat_loss') proteinMultiplier = 1.8;
  else proteinMultiplier = 1.4;
  
  const protein = Math.round(data.weight * proteinMultiplier);
  
  return { bmi, bmiCategory, bmr: Math.round(bmr), calories, protein };
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================= SESSION CLEANUP =================
setInterval(() => {
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const phone in users) {
    if (now - users[phone].createdAt > twoDays) {
      delete users[phone];
    }
  }
}, 60 * 60 * 1000);

// ================= START =================
app.listen(PORT, () => {
  console.log(`🏋️ FitCoach AI running on port ${PORT}`);
  console.log(`📱 WhatsApp webhook ready`);
  console.log(`❤️ Health check: /health`);
});
