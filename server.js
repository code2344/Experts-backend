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

const User = mongoose.model('User', userSchema);
const Question = mongoose.model('Question', questionSchema);

// Routes
app.get('/', (req, res) => {
  res.send('Experts in Anything API');
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
