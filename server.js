require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { stringify } = require('csv-stringify/sync');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || "MyAamAdmin2025";
const DB_PATH = path.join(__dirname, "aam_survey.db");

// Connect to SQLite
const db = new sqlite3.Database(DB_PATH);

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS patient_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid TEXT,
      name TEXT,
      visit_date TEXT,
      ratings_json TEXT,
      comments TEXT,
      submitted_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS community_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      area TEXT,
      visit_date TEXT,
      ratings_json TEXT,
      comments TEXT,
      submitted_at TEXT
    )
  `);
});

// Admin middleware
function requireAdmin(req, res, next) {
  const k = req.header("x-admin-key") || req.query.admin_key;
  if (k !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/ping", (req, res) => res.json({ ok: true }));

// Submit data
app.post("/api/submit", (req, res) => {
  const { survey, payload } = req.body;
  const now = new Date().toISOString();

  if (survey === "patient") {
    db.run(
      `
      INSERT INTO patient_responses (pid,name,visit_date,ratings_json,comments,submitted_at)
      VALUES (?,?,?,?,?,?)
      `,
      [
        payload.pid || "",
        payload.name || "",
        payload.visit_date || now.slice(0, 10),
        JSON.stringify(payload.ratings || {}),
        payload.comments || "",
        now,
      ],
      function () {
        res.json({ ok: true, id: this.lastID });
      }
    );
  } else if (survey === "community") {
    db.run(
      `
      INSERT INTO community_responses (name,area,visit_date,ratings_json,comments,submitted_at)
      VALUES (?,?,?,?,?,?)
      `,
      [
        payload.name || "",
        payload.area || "",
        payload.visit_date || now.slice(0, 10),
        JSON.stringify(payload.ratings || {}),
        payload.comments || "",
        now,
      ],
      function () {
        res.json({ ok: true, id: this.lastID });
      }
    );
  } else {
    res.status(400).json({ error: "Invalid survey" });
  }
});

// Fetch responses
app.get("/api/responses", requireAdmin, (req, res) => {
  const survey = req.query.survey;
  const month = req.query.month;

  const table =
    survey === "community" ? "community_responses" : "patient_responses";

  let query = `SELECT * FROM ${table}`;
  let params = [];

  if (month) {
    query += ` WHERE substr(visit_date,1,7)=?`;
    params.push(month);
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err });

    rows = rows.map((r) => ({
      ...r,
      ratings: JSON.parse(r.ratings_json || "{}"),
    }));

    res.json({ ok: true, rows });
  });
});

// Export CSV
app.get("/api/export", requireAdmin, (req, res) => {
  const survey = req.query.survey;
  const month = req.query.month;

  const table =
    survey === "community" ? "community_responses" : "patient_responses";

  let query = `SELECT * FROM ${table}`;
  let params = [];

  if (month) {
    query += ` WHERE substr(visit_date,1,7)=?`;
    params.push(month);
  }

  db.all(query, params, (err, rows) => {
    const parsed = rows.map((r) => ({
      ...r,
      ...JSON.parse(r.ratings_json || "{}"),
    }));

    const csv = stringify(parsed, { header: true });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${survey}_${month || "all"}.csv`
    );
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  });
});

app.listen(PORT, () => console.log("Server running on", PORT));
