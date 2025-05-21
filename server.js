// Basic Experts in Anything backend (Node.js + Express + MongoDB)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Filter = require('bad-words');
require('dotenv').config();

const fs = require('fs');
const path = require('path');



const app = express();
const port = process.env.PORT || 3000;

const filter = new Filter();
filter.replaceWord = (word) => '#'.repeat(word.length);
filter.addWords('testfilter');

// Middleware
app.use(cors());
app.use(express.json());

const natural = require('natural');
const wordnet = new natural.WordNet();

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
  isAdmin: { type: Boolean, default: false } // 👈 Add this
});

const questionSchema = new mongoose.Schema({
  topic: String,
  question: String,
  askedBy: String,
  assignedTo: String,
});

const chatSessionSchema = new mongoose.Schema({
  chatId: String,
  ended: { type: Boolean, default: false }
});

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);


const chatSchema = new mongoose.Schema({
  chatId: String,
  from: String,
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
  const { from, text } = req.body;
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
        from: process.env.ADMIN_EMAIL,
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


// Signup
app.post('/api/signup', async (req, res) => {
  const { name, email, password, expertise } = req.body;
  const user = new User({ name, email, password, expertise });
  await user.save();
  res.json({ success: true, user });
});

// Ask a question
app.post('/api/ask', async (req, res) => {
  const { topic, question, askedBy } = req.body;

  const synonyms = await getSynonyms(topic);
  synonyms.push(topic); // include the original topic too

  const expert = await User.findOne({ expertise: { $in: synonyms } });



  const newQuestion = new Question({
    topic,
    question,
    askedBy,
    assignedTo: expert ? expert.email : null,
  });

  await newQuestion.save();

  res.json({ success: true, question: newQuestion });
});

// Signin route (keep this OUTSIDE the ask route!)
app.post('/api/signin', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email, password });
    if (user) {
      res.json({ success: true, isAdmin: user.isAdmin });
      console.log('Received signin:', email, password, 'Success');
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
      console.log('Received signin:', email, password, 'Invalid credentials');
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


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
