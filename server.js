import express from 'express';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const GITHUB_USER = 'TherealVoltageLord';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const db = new sqlite3.Database('./visitors.db', (err) => {
  if (err) console.error('DB Error:', err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS visitors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT,
  user_agent TEXT,
  path TEXT DEFAULT '/',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const quotes = [
  "First, solve the problem. Then, write the code.",
  "Code is like humor. When you have to explain it, it's bad.",
  "Programming isn't about what you know; it's about what you can figure out.",
  "The only way to learn a new programming language is by writing programs in it.",
  "Any fool can write code that a computer can understand. Good programmers write code that humans can understand."
];

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

let statsCache = {
  followers: null,
  repos: null,
  timestamp: 0
};

app.get('/api/visitors', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  const visitPath = req.query.path || '/';
  
  db.run('INSERT INTO visitors(ip, user_agent, path) VALUES(?, ?, ?)', [ip, userAgent, visitPath], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    
    db.get('SELECT COUNT(*) as totalViews FROM visitors', (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ totalViews: row.totalViews });
    });
  });
});

app.get('/api/github/followers', async (req, res) => {
  try {
    if (statsCache.followers && Date.now() - statsCache.timestamp < 300000) {
      return res.json(statsCache.followers);
    }
    
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    const [userRes, reposRes] = await Promise.all([
      axios.get(`https://api.github.com/users/${GITHUB_USER}`, { headers }),
      axios.get(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=1`, { headers })
    ]);
    
    const data = {
      followers: userRes.data.followers,
      following: userRes.data.following,
      publicRepos: userRes.data.public_repos,
      cached: false
    };
    
    statsCache.followers = data;
    statsCache.timestamp = Date.now();
    res.json(data);
    
  } catch (err) {
    if (statsCache.followers) {
      return res.json({ ...statsCache.followers, cached: true, error: 'Using cached data' });
    }
    res.status(500).json({ error: 'GitHub API error' });
  }
});

app.get('/api/github/repos', async (req, res) => {
  try {
    if (statsCache.repos && Date.now() - statsCache.timestamp < 300000) {
      return res.json(statsCache.repos);
    }
    
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    const reposRes = await axios.get(
      `https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=6`,
      { headers }
    );
    
    const repos = reposRes.data.map(r => ({
      name: r.name,
      html_url: r.html_url,
      description: r.description || 'No description',
      language: r.language,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      updated_at: r.updated_at
    }));
    
    statsCache.repos = repos;
    statsCache.timestamp = Date.now();
    res.json(repos);
    
  } catch (err) {
    if (statsCache.repos) {
      return res.json(statsCache.repos);
    }
    res.json([]);
  }
});

app.get('/api/quotes', (req, res) => {
  const randomQuotes = [...quotes].sort(() => 0.5 - Math.random()).slice(0, 3);
  res.json(randomQuotes);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📁 Static files from: ${path.join(__dirname, 'public')}`);
  console.log(`🐙 GitHub User: ${GITHUB_USER}`);
  console.log(`🔐 GitHub Token: ${GITHUB_TOKEN ? 'Provided' : 'Not provided'}`);
});
