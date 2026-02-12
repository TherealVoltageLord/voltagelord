import express from 'express';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

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
  country TEXT,
  city TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS page_views(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT,
  views INTEGER DEFAULT 0,
  date DATE DEFAULT CURRENT_DATE
)`);

const quotes = [
  "First, solve the problem. Then, write the code.",
  "Code is like humor. When you have to explain it, it's bad.",
  "Programming isn't about what you know; it's about what you can figure out.",
  "The only way to learn a new programming language is by writing programs in it.",
  "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
  "Simplicity is the soul of efficiency.",
  "Make it work, make it right, make it fast.",
  "Programming is the art of telling another human what one wants the computer to do.",
  "The function of good software is to make the complex appear simple.",
  "Good code is its own best documentation."
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cache = {
  followers: null,
  repos: null,
  activity: null,
  lastUpdated: 0
};

const CACHE_DURATION = 300000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/visitors', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown';
    const visitPath = req.query.path || '/';
    
    let country = 'Unknown';
    let city = 'Unknown';
    
    try {
      if (ip !== '::1' && ip !== '127.0.0.1') {
        const geoRes = await axios.get(`http://ip-api.com/json/${ip}`);
        if (geoRes.data && geoRes.data.status === 'success') {
          country = geoRes.data.country;
          city = geoRes.data.city;
        }
      }
    } catch (geoErr) {
      console.log('GeoIP error:', geoErr.message);
    }
    
    db.run('INSERT INTO visitors(ip, user_agent, path, country, city) VALUES(?, ?, ?, ?, ?)', 
      [ip, userAgent, visitPath, country, city], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      
      Promise.all([
        new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as totalViews FROM visitors', (err, row) => {
            if (err) reject(err);
            else resolve(row.totalViews);
          });
        }),
        new Promise((resolve, reject) => {
          db.get('SELECT COUNT(DISTINCT ip) as uniqueVisitors FROM visitors', (err, row) => {
            if (err) reject(err);
            else resolve(row.uniqueVisitors);
          });
        }),
        new Promise((resolve, reject) => {
          db.all('SELECT country, COUNT(*) as count FROM visitors WHERE country != "Unknown" GROUP BY country ORDER BY count DESC LIMIT 10', 
            (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        })
      ]).then(([totalViews, uniqueVisitors, countries]) => {
        res.json({
          totalViews,
          uniqueVisitors,
          countries,
          recentVisit: {
            country,
            city,
            time: new Date().toISOString()
          }
        });
      }).catch(err => {
        res.status(500).json({ error: 'Database error' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/visitors/stats', (req, res) => {
  db.all(`SELECT 
    DATE(timestamp) as date,
    COUNT(*) as visits,
    COUNT(DISTINCT ip) as uniqueVisitors
    FROM visitors 
    GROUP BY DATE(timestamp) 
    ORDER BY date DESC 
    LIMIT 30`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/github/stats', async (req, res) => {
  try {
    if (cache.followers && Date.now() - cache.lastUpdated < CACHE_DURATION) {
      return res.json({ ...cache.followers, cached: true });
    }
    
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    
    const [userRes, reposRes] = await Promise.all([
      axios.get(`https://api.github.com/users/${GITHUB_USER}`, { headers }),
      axios.get(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100`, { headers })
    ]);
    
    const totalStars = reposRes.data.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    const totalForks = reposRes.data.reduce((sum, repo) => sum + repo.forks_count, 0);
    
    const languages = {};
    reposRes.data.forEach(repo => {
      if (repo.language) {
        languages[repo.language] = (languages[repo.language] || 0) + 1;
      }
    });
    
    const data = {
      followers: userRes.data.followers,
      following: userRes.data.following,
      publicRepos: userRes.data.public_repos,
      totalStars,
      totalForks,
      languages: Object.entries(languages)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count })),
      cached: false
    };
    
    cache.followers = data;
    cache.lastUpdated = Date.now();
    res.json(data);
    
  } catch (err) {
    if (cache.followers) {
      return res.json({ ...cache.followers, cached: true, error: 'Using cached data' });
    }
    res.status(500).json({ error: 'GitHub API error' });
  }
});

app.get('/api/github/repos', async (req, res) => {
  try {
    if (cache.repos && Date.now() - cache.lastUpdated < CACHE_DURATION) {
      return res.json({ repos: cache.repos, cached: true });
    }
    
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    const reposRes = await axios.get(
      `https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=10`,
      { headers }
    );
    
    const repos = reposRes.data.map(r => ({
      id: r.id,
      name: r.name,
      html_url: r.html_url,
      description: r.description || 'No description provided',
      language: r.language,
      stargazers_count: r.stargazers_count,
      forks_count: r.forks_count,
      watchers_count: r.watchers_count,
      size: r.size,
      created_at: r.created_at,
      updated_at: r.updated_at,
      homepage: r.homepage,
      topics: r.topics || []
    }));
    
    cache.repos = repos;
    cache.lastUpdated = Date.now();
    res.json({ repos, cached: false });
    
  } catch (err) {
    if (cache.repos) {
      return res.json({ repos: cache.repos, cached: true });
    }
    res.json({ repos: [], cached: false });
  }
});

app.get('/api/github/activity', async (req, res) => {
  try {
    if (cache.activity && Date.now() - cache.lastUpdated < CACHE_DURATION) {
      return res.json({ activity: cache.activity, cached: true });
    }
    
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    const commitsRes = await axios.get(
      `https://api.github.com/users/${GITHUB_USER}/events?per_page=100`,
      { headers }
    );
    
    const activity = commitsRes.data
      .filter(event => event.type === 'PushEvent')
      .map(event => ({
        date: event.created_at.split('T')[0],
        count: event.payload.commits.length,
        repo: event.repo.name
      }));
    
    cache.activity = activity;
    cache.lastUpdated = Date.now();
    res.json({ activity, cached: false });
    
  } catch (err) {
    res.json({ activity: [], cached: false });
  }
});

app.get('/api/quotes', (req, res) => {
  const count = parseInt(req.query.count) || 1;
  const shuffled = [...quotes].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(count, 5));
  res.json(selected);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🐙 GitHub User: ${GITHUB_USER}`);
  console.log(`🌍 API Endpoints:`);
  console.log(`   GET /api/health`);
  console.log(`   GET /api/visitors`);
  console.log(`   GET /api/visitors/stats`);
  console.log(`   GET /api/github/stats`);
  console.log(`   GET /api/github/repos`);
  console.log(`   GET /api/github/activity`);
  console.log(`   GET /api/quotes`);
});
