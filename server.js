const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite'); // built into Node.js, nothing extra to install
const path = require('path');

const app = express();
const db = new DatabaseSync(process.env.DB_PATH || 'skillxchange.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  bio TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('offer','want')),
  UNIQUE(user_id, name, kind)
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  give_skill TEXT NOT NULL,
  get_skill TEXT NOT NULL,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT, message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 20'); } catch {}
db.exec(`
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, skill TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, video_url TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
  body TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, request_id INTEGER, note TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const login = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Please log in first.' });

// ---------- Auth ----------
app.post('/api/signup', (req, res) => {
  const { name, email, password, bio } = req.body;
  if (!name || !emailOk(email) || !password || password.length < 8)
    return res.status(400).json({ error: 'Name, valid email and a password of 8+ characters are required.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
    return res.status(409).json({ error: 'This email is already registered.' });
  const info = db.prepare('INSERT INTO users (name,email,password_hash,bio) VALUES (?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), bcrypt.hashSync(password, 10), (bio || '').trim());
  req.session.userId = info.lastInsertRowid;
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).json({ error: 'Wrong email or password.' });
  req.session.userId = u.id;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', login, (req, res) =>
  res.json(db.prepare('SELECT id,name,email,bio,credits FROM users WHERE id=?').get(req.session.userId)));

// ---------- My skills ----------
app.get('/api/skills', login, (req, res) =>
  res.json(db.prepare('SELECT id,name,kind FROM skills WHERE user_id=? ORDER BY id DESC').all(req.session.userId)));

app.post('/api/skills', login, (req, res) => {
  const name = (req.body.name || '').trim();
  const kind = req.body.kind;
  if (!name || name.length > 40 || !['offer', 'want'].includes(kind))
    return res.status(400).json({ error: 'Enter a skill name (max 40 characters).' });
  try {
    db.prepare('INSERT INTO skills (user_id,name,kind) VALUES (?,?,?)').run(req.session.userId, name, kind);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'You already added this skill.' }); }
});

app.delete('/api/skills/:id', login, (req, res) => {
  db.prepare('DELETE FROM skills WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ---------- Explore & matching ----------
app.get('/api/explore', login, (req, res) => {
  const me = req.session.userId;
  const q = (req.query.q || '').toLowerCase().trim();
  const mine = db.prepare('SELECT name,kind FROM skills WHERE user_id=?').all(me);
  const myOffer = mine.filter(s => s.kind === 'offer').map(s => s.name.toLowerCase());
  const myWant = mine.filter(s => s.kind === 'want').map(s => s.name.toLowerCase());

  const out = db.prepare('SELECT id,name,bio FROM users WHERE id != ?').all(me).map(u => {
    const sk = db.prepare('SELECT name,kind FROM skills WHERE user_id=?').all(u.id);
    const offers = sk.filter(s => s.kind === 'offer').map(s => s.name);
    const wants = sk.filter(s => s.kind === 'want').map(s => s.name);
    const theyTeachMe = offers.filter(n => myWant.includes(n.toLowerCase()));
    const iTeachThem = wants.filter(n => myOffer.includes(n.toLowerCase()));
    return { ...u, offers, wants, theyTeachMe, iTeachThem, score: theyTeachMe.length + iTeachThem.length };
  }).filter(u => !q || u.name.toLowerCase().includes(q) ||
      [...u.offers, ...u.wants].some(n => n.toLowerCase().includes(q)));

  out.sort((a, b) => b.score - a.score);
  res.json(out);
});

// ---------- Exchange requests ----------
app.post('/api/requests', login, (req, res) => {
  const { to_id, give_skill, get_skill, message } = req.body;
  if (!to_id || !give_skill || !get_skill || to_id == req.session.userId)
    return res.status(400).json({ error: 'Choose both skills for the exchange.' });
  db.prepare('INSERT INTO requests (from_id,to_id,give_skill,get_skill,message) VALUES (?,?,?,?,?)')
    .run(req.session.userId, to_id, give_skill, get_skill, (message || '').slice(0, 500));
  res.json({ ok: true });
});

app.get('/api/requests', login, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT r.*, f.name AS from_name, f.email AS from_email, t.name AS to_name, t.email AS to_email
    FROM requests r JOIN users f ON f.id=r.from_id JOIN users t ON t.id=r.to_id
    WHERE r.from_id=? OR r.to_id=? ORDER BY r.id DESC`).all(me, me);
  rows.forEach(r => { r.paid = !!db.prepare('SELECT 1 FROM credit_transactions WHERE request_id=? AND from_id=?').get(r.id, me); });
  // share email only after acceptance
  rows.forEach(r => { if (r.status !== 'accepted') { delete r.from_email; delete r.to_email; } });
  res.json({
    incoming: rows.filter(r => r.to_id === me),
    outgoing: rows.filter(r => r.from_id === me)
  });
});

app.post('/api/requests/:id/respond', login, (req, res) => {
  const status = req.body.status;
  if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE requests SET status=? WHERE id=? AND to_id=?').run(status, req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ---------- Lessons ----------
app.get('/api/lessons', login, (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  res.json(db.prepare(`SELECT l.id,l.skill,l.title,l.user_id,u.name AS author,
    (SELECT 1 FROM lesson_progress g WHERE g.lesson_id=l.id AND g.user_id=?) AS done
    FROM lessons l JOIN users u ON u.id=l.user_id
    WHERE l.title LIKE ? OR l.skill LIKE ? OR u.name LIKE ? ORDER BY l.id DESC`).all(req.session.userId, q, q, q));
});
app.get('/api/lessons/:id', login, (req, res) => {
  const l = db.prepare(`SELECT l.*,u.name AS author,
    (SELECT 1 FROM lesson_progress g WHERE g.lesson_id=l.id AND g.user_id=?) AS done
    FROM lessons l JOIN users u ON u.id=l.user_id WHERE l.id=?`).get(req.session.userId, req.params.id);
  l ? res.json(l) : res.status(404).json({ error: 'Lesson not found.' });
});
app.post('/api/lessons', login, (req, res) => {
  const { skill, title, content, video_url } = req.body;
  const v = (video_url || '').trim();
  if (!skill || !title || !content || title.length > 100) return res.status(400).json({ error: 'Skill, title (max 100 chars) and content are required.' });
  if (v && !/^https?:\/\//i.test(v)) return res.status(400).json({ error: 'Video link must start with http:// or https://' });
  db.prepare('INSERT INTO lessons (user_id,skill,title,content,video_url) VALUES (?,?,?,?,?)')
    .run(req.session.userId, skill.trim(), title.trim(), content.trim(), v);
  res.json({ ok: true });
});
app.delete('/api/lessons/:id', login, (req, res) => {
  const r = db.prepare('DELETE FROM lessons WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  if (r.changes) db.prepare('DELETE FROM lesson_progress WHERE lesson_id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/lessons/:id/complete', login, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id,lesson_id) VALUES (?,?)').run(req.session.userId, req.params.id);
  res.json({ ok: true });
});

// ---------- Messaging (only for accepted exchanges) ----------
const myAccepted = (me, id) => db.prepare(
  "SELECT * FROM requests WHERE id=? AND status='accepted' AND (from_id=? OR to_id=?)").get(id, me, me);

app.get('/api/conversations', login, (req, res) => {
  const me = req.session.userId;
  res.json(db.prepare(`SELECT r.id, r.give_skill, r.get_skill,
    CASE WHEN r.from_id=? THEN t.name ELSE f.name END AS other,
    (SELECT body FROM messages m WHERE m.request_id=r.id ORDER BY m.id DESC LIMIT 1) AS last
    FROM requests r JOIN users f ON f.id=r.from_id JOIN users t ON t.id=r.to_id
    WHERE r.status='accepted' AND (r.from_id=? OR r.to_id=?) ORDER BY r.id DESC`).all(me, me, me));
});
app.get('/api/messages/:id', login, (req, res) => {
  if (!myAccepted(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Chat opens after an exchange is accepted.' });
  res.json(db.prepare(`SELECT m.id,m.sender_id,m.body,m.created_at,u.name FROM messages m
    JOIN users u ON u.id=m.sender_id WHERE m.request_id=? ORDER BY m.id`).all(req.params.id));
});
app.post('/api/messages/:id', login, (req, res) => {
  const body = (req.body.body || '').trim();
  if (!myAccepted(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Chat opens after an exchange is accepted.' });
  if (!body || body.length > 1000) return res.status(400).json({ error: 'Message must be 1-1000 characters.' });
  db.prepare('INSERT INTO messages (request_id,sender_id,body) VALUES (?,?,?)').run(req.params.id, req.session.userId, body);
  res.json({ ok: true });
});

// ---------- Credits / time-banking (1 hour = 10 credits) ----------
app.post('/api/requests/:id/confirm', login, (req, res) => {
  const me = req.session.userId;
  const r = myAccepted(me, req.params.id);
  if (!r) return res.status(400).json({ error: 'The exchange must be accepted first.' });
  const hours = Math.min(5, Math.max(1, parseInt(req.body.hours) || 1));
  const amount = hours * 10;
  const teacher = r.from_id === me ? r.to_id : r.from_id;
  const skill = r.from_id === me ? r.get_skill : r.give_skill;
  if (db.prepare('SELECT 1 FROM credit_transactions WHERE request_id=? AND from_id=?').get(r.id, me))
    return res.status(409).json({ error: 'You already confirmed learning for this exchange.' });
  const bal = db.prepare('SELECT credits FROM users WHERE id=?').get(me).credits;
  if (bal < amount) return res.status(400).json({ error: 'Not enough credits (you need ' + amount + ').' });
  try {
    db.exec('BEGIN');
    db.prepare('UPDATE users SET credits = credits - ? WHERE id=?').run(amount, me);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id=?').run(amount, teacher);
    db.prepare('INSERT INTO credit_transactions (from_id,to_id,amount,request_id,note) VALUES (?,?,?,?,?)')
      .run(me, teacher, amount, r.id, `${hours}h of ${skill}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: 'Could not transfer credits.' }); }
  res.json({ ok: true, credits: bal - amount });
});

app.get('/api/credits', login, (req, res) => {
  const me = req.session.userId;
  res.json({
    credits: db.prepare('SELECT credits FROM users WHERE id=?').get(me).credits,
    history: db.prepare(`SELECT t.id,t.amount,t.note,t.created_at,t.from_id,f.name AS from_name,u.name AS to_name
      FROM credit_transactions t JOIN users f ON f.id=t.from_id JOIN users u ON u.id=t.to_id
      WHERE t.from_id=? OR t.to_id=? ORDER BY t.id DESC`).all(me, me)
  });
});

// ---------- Contact ----------
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !emailOk(email) || !message) return res.status(400).json({ error: 'Please fill in all fields.' });
  db.prepare('INSERT INTO contacts (name,email,message) VALUES (?,?,?)').run(name, email, message);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Skill Exchange Hub running on port ' + PORT));
