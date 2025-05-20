// Basic Experts in Anything backend (Node.js + Express + MongoDB)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

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
  expertise: [String],
  isAdmin: { type: Boolean, default: false } // 👈 Add this
});

const questionSchema = new mongoose.Schema({
  topic: String,
  question: String,
  askedBy: String,
  assignedTo: String,
});

const chatSchema = new mongoose.Schema({
  chatId: String,
  from: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

const Chat = mongoose.model('Chat', chatSchema);

const User = mongoose.model('User', userSchema);
const Question = mongoose.model('Question', questionSchema);

// Routes
app.get('/', (req, res) => {
  res.send('Experts in Anything API');
});
// Get chat messages
app.get('/api/chat/:chatId', async (req, res) => {
  const messages = await Chat.find({ chatId: req.params.chatId }).sort('timestamp');
  res.json({ success: true, messages });
});

// Post a new message
app.post('/api/chat/:chatId', async (req, res) => {
  const { from, text } = req.body;
  const newMsg = new Chat({ chatId: req.params.chatId, from, text });
  await newMsg.save();
  res.json({ success: true, message: newMsg });
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
  console.log('Received signin:', email, password);

  try {
    const user = await User.findOne({ email, password });
    if (user) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
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


// Get questions for expert
app.get('/api/questions/:email', async (req, res) => {
  const questions = await Question.find({ assignedTo: req.params.email });
  res.json({ success: true, questions });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
