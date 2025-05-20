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

  // Try to find an expert
  const expert = await User.findOne({ expertise: topic });

  const newQuestion = new Question({
    topic,
    question,
    askedBy,
    assignedTo: expert ? expert.email : null,
  });

  app.post('/api/signin', async (req, res) => {
  try {
    const email = req.body.email + ''; // force string
    const password = req.body.password + ''; // force string
    const user = await User.findOne({ email, password }).lean();

    if (user) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false, message: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('SIGNIN ERROR:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});




  await newQuestion.save();
  res.json({ success: true, question: newQuestion });
});

// Get questions for expert
app.get('/api/questions/:email', async (req, res) => {
  const questions = await Question.find({ assignedTo: req.params.email });
  res.json({ success: true, questions });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
