// Basic Experts in Anything backend (Node.js + Express + MongoDB)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Filter = require('bad-words');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // ✅ Used for generating unique chat IDs

const rateLimit = require('express-rate-limit');

const signinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many login attempts. Please try again later.'
});


const app = express();
const port = process.env.PORT || 10000;

const filter = new Filter();
filter.replaceWord = (word) => '#'.repeat(word.length);
filter.addWords('testfilter');


const axios = require("axios");

async function getSimilarTopics(topic) {
  const res = await axios.get("https://api.datamuse.com/words", {
    params: { ml: topic, max: 50 }
  });

  // Return a set of lowercase topic names for easy matching
  return new Set(res.data.map(entry => entry.word.toLowerCase()));
}

app.set('trust proxy', 1); // or true

// Middleware
app.use(cors());
app.use(express.json());

const natural = require('natural');
const wordnet = new natural.WordNet();

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] || 
    req.connection?.remoteAddress || 
    req.socket?.remoteAddress || 
    req.ip
  );
}


function getSynonyms(word) {
  return new Promise((resolve, reject) => {
    wordnet.lookup(word, (results) => {
      if (!results || results.length === 0) return resolve([]);

      const allSynonyms = new Set();
      results.forEach(entry => {
        entry.synonyms.forEach(syn => allSynonyms.add(syn));
      });
      resolve(Array.from(allSynonyms));
    });
  });
}

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error(err));

// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  created: { type: Date, default: Date.now },
  expertise: [String],
  isAdmin: { type: Boolean, default: false }, // 👈 Add this
  verified: { type: Boolean, default: false },
  verificationToken: String,
  banned: { type: Boolean, default: false },
  banReason: String
});

const ipBanSchema = new mongoose.Schema({
  ip: String,
  reason: String,
  bannedAt: { type: Date, default: Date.now }
});

const IPBan = mongoose.model('IPBan', ipBanSchema);


const questionSchema = new mongoose.Schema({
  topic: String,
  question: String,
  askedBy: String,
  assignedTo: String,
  chatId: String
});

const chatSessionSchema = new mongoose.Schema({
  chatId: String,
  ended: { type: Boolean, default: false }
});

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);


const chatSchema = new mongoose.Schema({
  chatId: String,
  from: String,
  fromUser: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  ended: { type: Boolean, default: false }
});

const Chat = mongoose.model('Chat', chatSchema);

const User = mongoose.model('User', userSchema);
const Question = mongoose.model('Question', questionSchema);

const moderationSchema = new mongoose.Schema({
  chatId: String,
  from: String,
  originalText: String,
  filteredText: String,
  offensiveWord: String,
  timestamp: { type: Date, default: Date.now },
  user1: {
    email: String,
    password: String,
    created: Date,
  },
  user2: {
    email: String,
    password: String,
    created: Date,
  },
  moderatedUser: Number, // 1 or 2
  question: String,
  topic: String
});

const Moderation = mongoose.model('Moderation', moderationSchema);


// Routes
app.get('/', (req, res) => {
  res.send('Experts in Anything API');
});
// Get chat messages
app.get('/api/chat/:chatId', async (req, res) => {
  const chatId = req.params.chatId;
  const messages = await Chat.find({ chatId }).sort('timestamp');
  const session = await ChatSession.findOne({ chatId });

  res.json({
    success: true,
    messages,
    ended: session?.ended || false
  });
});



app.post('/api/chat/:chatId', async (req, res) => {
  const { from, fromUser, text } = req.body;
  const chatId = req.params.chatId;

  let session = await ChatSession.findOne({ chatId });
  if (!session) {
    session = new ChatSession({ chatId });
    await session.save();
  }

  if (session.ended) {
    return res.status(403).json({ success: false, message: 'Chat has ended' });
  }

  // Moderation
  const originalText = text;
  const filteredText = filter.clean(text);

  // Check if the text was altered (meaning it contained a bad word)
  if (originalText !== filteredText) {
    const users = chatId.split('-');
    const user1 = await User.findOne({ email: users[0] });
    const user2 = await User.findOne({ email: users[1] });
    const questionEntry = await Question.findOne({
      $or: [
        { askedBy: users[0], assignedTo: users[1] },
        { askedBy: users[1], assignedTo: users[0] }
      ]
    });

    const moderatedUser = from === users[0] ? 1 : 2;
    const offensiveWord = originalText.split(' ').find(word => filter.isProfane(word));

    const moderationRecord = new Moderation({
      chatId,
      from,
      originalText,
      filteredText,
      offensiveWord,
      user1: {
        email: user1.email,
        password: user1.password,
        created: user1.created
      },
      user2: {
        email: user2.email,
        password: user2.password,
        created: user2.created
      },
      moderatedUser,
      question: questionEntry?.question || '',
      topic: questionEntry?.topic || ''
    });

    await moderationRecord.save();
    // Load and compile the email template
    const templatePath = path.join(__dirname, 'moderationemail.html');
    let emailTemplate = fs.readFileSync(templatePath, 'utf8');

    // Replace placeholders with actual data
    emailTemplate = emailTemplate
      .replace('{{from}}', from)
      .replace('{{originalText}}', originalText)
      .replace('{{filteredText}}', filteredText)
      .replace('{{offensiveWord}}', offensiveWord)
      .replace('{{chatId}}', chatId)
      .replace('{{user1Email}}', user1.email)
      .replace('{{user1Created}}', user1.created.toISOString())
      .replace('{{user2Email}}', user2.email)
      .replace('{{user2Created}}', user2.created.toISOString())
      .replace('{{question}}', questionEntry?.question || '')
      .replace('{{topic}}', questionEntry?.topic || '');


    // Send email using Resend
    try {
      await resend.emails.send({
        from: 'mod@scstudios.tech',
        to: process.env.ADMIN_EMAIL,
        subject: 'Moderation Alert',
        html: emailTemplate
      });
      console.log('Moderation alert email sent');
    } catch (error) {
      console.error('Failed to send moderation email:', error);
    }
  }

  // Save filtered message to chat
  const newMsg = new Chat({ chatId, from, text: filteredText });
  await newMsg.save();
  res.json({ success: true, message: newMsg });
});

//is chat ended
app.post('/api/chat/:chatId/end', async (req, res) => {
  const chatId = req.params.chatId;
  let session = await ChatSession.findOne({ chatId });

  if (!session) {
    session = new ChatSession({ chatId });
  }

  session.ended = true;
  await session.save();

  res.json({ success: true });
});


app.post('/api/signup', async (req, res) => {
  const { name, email, password, expertise } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) return res.json({ success: false, message: 'Email already exists' });

  const verificationToken = uuidv4();

  const user = new User({
    name,
    email,
    password,
    expertise,
    verificationToken
  });

  await user.save();

  const verifyLink = `https://code2344.github.io/Experts-frontend/verify.html?token=${verificationToken}`;

  const html = `
    <h1>Email Verification</h1>
    <p>Hi ${name},</p>
    <p>Click the link to verify your email:</p>
    <a href="${verifyLink}">${verifyLink}</a>
  `;

  await resend.emails.send({
    from: 'verify@scstudios.tech',
    to: email,
    subject: 'Verify Your Email',
    html
  });

  res.json({ success: true, message: 'User created. Please verify your email.' });
});


// Update your /api/ask route
app.post('/api/ask', async (req, res) => {
  const { topic, question, askedBy } = req.body;

  const similarTopics = await getSimilarTopics(topic);
  similarTopics.push(topic); // include the original topic too

  const expert = await User.findOne({ expertise: { $in: similarTopics } });

  const chatId = uuidv4(); // ✅ Generate a unique chatId for this question and chat session

  const newQuestion = new Question({
    topic,
    question,
    askedBy,
    assignedTo: expert ? expert.email : null,
    chatId // ✅ Store chatId in question
  });

  await newQuestion.save();

  // ✅ Also create a corresponding ChatSession using the same chatId
  const newSession = new ChatSession({ chatId });
  await newSession.save();

  res.json({ success: true, question: newQuestion });
});

// Signin route (keep this OUTSIDE the ask route!)
app.post('/api/signin', signinLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = getIp(req);
  
  try {
    const user = await User.findOne({ email, password });
    if (user && user.verified && !user.banned) {
      res.json({ success: true, isAdmin: user.isAdmin, name: user.name});
      console.log('Received signin:', ip, email, password, 'Success');
    } else if (user && !user.verified) {
      res.json({ success: false, message: 'Please verify your email first.' });
    } else if (user.banned) {
      res.json({ success: false, message: 'You have been banned.' });
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
      console.log('Received signin:', ip, email, password, 'Invalid credentials');
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//admin get chats
app.get('/api/admin/chats', async (req, res) => {
  try {
    const chats = await Chat.find().sort('-timestamp');
    const chatMap = {};

    chats.forEach(chat => {
      if (!chatMap[chat.chatId]) chatMap[chat.chatId] = [];
      chatMap[chat.chatId].push(chat);
    });

    res.json({ success: true, chats: chatMap });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//admin get users
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

//admin edit&update users
app.post('/api/admin/update-user', async (req, res) => {
  const { id, name, email, password, isAdmin } = req.body;

  try {
    const updated = await User.findByIdAndUpdate(
      id,
      { name, email, password, isAdmin },
      { new: true }
    );
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/verify', async (req, res) => {
  const { token } = req.query;
  const user = await User.findOne({ verificationToken: token });
  if (!user) return res.status(400).send('Invalid or expired verification token.');

  user.verified = true;
  user.verificationToken = undefined;
  await user.save();

  res.send('Your email has been successfully verified. You can now sign in.');
});


app.get('/api/questions', async (req, res) => {
  const email = req.query.email;
  const isAdmin = req.query.isAdmin === 'true';

  const user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not found" });

  let filter = {};
  if (isAdmin || user.isAdmin) {
    filter = {}; // Show all questions
  } else {
    filter = { $or: [{ askedBy: email }, { assignedTo: email }] };
  }

  const questions = await Question.find(filter);
  res.json({ success: true, questions });
});

// Admin ban user
app.post('/api/admin/ban-user', async (req, res) => {
  const { email, reason } = req.body;

  try {
    const user = await User.findOneAndUpdate(
      { email },
      { banned: true, banReason: reason },
      { new: true }
    );
    if (!user) return res.json({ success: false, message: 'User not found' });
    res.json({ success: true, message: `User ${email} banned.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use(async (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const banned = await IPBan.findOne({ ip });
  if (banned) {
    return res.status(403).json({ success: false, message: 'Your IP is banned.' });
  }
  next();
});

app.post('/api/admin/ban-ip', async (req, res) => {
  const { ip, reason } = req.body;

  try {
    const existing = await IPBan.findOne({ ip });
    if (existing) return res.json({ success: false, message: 'IP already banned.' });

    const ban = new IPBan({ ip, reason });
    await ban.save();
    res.json({ success: true, message: `IP ${ip} banned.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/chat/:chatId', async (req, res) => {
  const chatId = req.params.chatId;
  const db = client.db('test');

  try {
    await db.collection('chats').deleteMany({ chatId });
    await db.collection('questions').deleteOne({ chatId }); // optional, if you want to delete the associated question
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting chat:', err);
    res.status(500).json({ success: false, error: 'Failed to delete chat.' });
  }
});

app.get('/api/ping', async (req, res) => {
  res.json({ success: true });
  console.log("Recieved ping, API is up. ");
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
