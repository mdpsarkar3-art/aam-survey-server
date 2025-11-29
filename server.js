require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { stringify } = require('csv-stringify/sync');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'YourStrongAdminKey123';
const DB_FILE = path.join(__dirname, 'aam_survey.db');

// Init DB
const db = new Database(DB_FILE);
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patient_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid TEXT,
  name TEXT,
  visit_date TEXT,
  ratings_json TEXT,
  comments TEXT,
  submitted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  area TEXT,
  ratings_json TEXT,
  comments TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  visit_date TEXT
);
`);

// Helpers
function insert(table, obj){
  if(table === 'patient'){
    const stmt = db.prepare(`INSERT INTO patient_responses (pid,name,visit_date,ratings_json,comments,submitted_at)
      VALUES (@pid,@name,@visit_date,@ratings_json,@comments,@submitted_at)`);
    return stmt.run(obj);
  } else {
    const stmt = db.prepare(`INSERT INTO community_responses (name,area,ratings_json,comments,submitted_at,visit_date)
      VALUES (@name,@area,@ratings_json,@comments,@submitted_at,@visit_date)`);
    return stmt.run(obj);
  }
}

function queryResponses(table, month){
  const col = 'visit_date';
  const tbl = (table === 'patient') ? 'patient_responses' : 'community_responses';
  if(month){
    const stmt = db.prepare(`SELECT * FROM ${tbl} WHERE substr(${col},1,7)=? ORDER BY id DESC`);
    return stmt.all(month);
  } else {
    const stmt = db.prepare(`SELECT * FROM ${tbl} ORDER BY id DESC`);
    return stmt.all();
  }
}

// Middleware for admin
function requireAdmin(req, res, next){
  const key = req.header('x-admin-key') || req.query.admin_key;
  if(!key || key !== ADMIN_KEY) return res.status(401).json({error:'unauthorized'});
  next();
}

// Routes
app.get('/api/ping', (req,res) => res.json({ok:true}));

app.post('/api/submit', (req,res)=>{
  const { survey, payload } = req.body;
  if(!survey || !payload) return res.status(400).json({error:'missing data'});
  try{
    const now = new Date().toISOString();
    if(survey === 'patient'){
      const row = {
        pid: payload.pid || '',
        name: payload.name || '',
        visit_date: payload.visit_date || now.slice(0,10),
        ratings_json: JSON.stringify(payload.ratings || {}),
        comments: payload.comments || '',
        submitted_at: now
      };
      const r = insert('patient', row);
      return res.json({ok:true, id: r.lastInsertRowid});
    } else if(survey === 'community'){
      const row = {
        name: payload.name || '',
        area: payload.area || '',
        ratings_json: JSON.stringify(payload.ratings || {}),
        comments: payload.comments || '',
        submitted_at: now,
        visit_date: payload.visit_date || now.slice(0,10)
      };
      const r = insert('community', row);
      return res.json({ok:true, id: r.lastInsertRowid});
    } else {
      return res.status(400).json({error:'unknown survey'});
    }
  }catch(err){
    console.error(err);
    return res.status(500).json({error: 'server error'});
  }
});

// Admin APIs
app.get('/api/responses', requireAdmin, (req,res)=>{
  const survey = req.query.survey || 'patient';
  const month = req.query.month;
  if(!['patient','community'].includes(survey)) return res.status(400).json({error:'invalid survey'});
  const rows = queryResponses(survey, month);
  const mapped = rows.map(r => ({...r, ratings: JSON.parse(r.ratings_json || '{}')}));
  res.json({ok:true, count: mapped.length, rows: mapped});
});

// Export CSV
app.get('/api/export', requireAdmin, (req,res)=>{
  const survey = req.query.survey || 'patient';
  const month = req.query.month;
  const rows = queryResponses(survey, month);
  const parsed = rows.map(r => ({...r, ...JSON.parse(r.ratings_json||'{}')}));
  const csv = stringify(parsed, { header:true });
  res.setHeader('Content-disposition', `attachment; filename=${survey}_${month||'all'}.csv`);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

// Reset
app.post('/api/reset', requireAdmin, (req,res)=>{
  db.exec(`DELETE FROM patient_responses; DELETE FROM community_responses;`);
  res.json({ok:true});
});

app.listen(PORT, ()=> console.log(`Server running on ${PORT}`));
