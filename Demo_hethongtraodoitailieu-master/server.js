/**
 * CampusShelf — Hệ thống trao đổi tài liệu học tập sinh viên (Nhóm 26)
 * Node.js + Express + SQLite (better-sqlite3).
 * Đã bổ sung: đăng ký/đăng nhập thật, hồ sơ, AI (OCR ảnh bìa + gợi ý theo đề cương),
 * lọc theo landmark/GPS, hủy yêu cầu, chat realtime (SSE), hẹn gặp, đánh giá, lịch sử,
 * thông báo, quản trị (khóa tài khoản, kiểm duyệt tin, xử lý báo cáo).
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const dataDir = path.join(ROOT, "data");
const uploadDir = path.join(ROOT, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

// ---------- Cấu hình ----------
const DEMO_MODE = process.env.DEMO_MODE ? process.env.DEMO_MODE !== "false" : process.env.NODE_ENV !== "production";
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "sis.hust.edu.vn,hust.edu.vn").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const DEMO_PASSWORD = "demo1234";
const SESSION_DAYS = 7;

const MODES = ["Bán", "Trao đổi", "Tặng", "Cho mượn"];
const CATEGORIES = ["Giáo trình", "Sách tham khảo", "Bài giảng in", "Đề thi cũ", "Tài liệu khác"];
const CONDITIONS = ["Rất tốt", "Tốt", "Khá", "Cũ, vẫn dùng tốt"];
// Tọa độ ước lượng khu vực ĐH Bách khoa Hà Nội — hãy hiệu chỉnh lại bằng bản đồ thật nếu cần.
const LANDMARKS = {
  "Thư viện Tạ Quang Bửu": [21.0049, 105.8459],
  "Cổng Parabol": [21.0034, 105.8431],
  "KTX Bách khoa": [21.0010, 105.8465],
  "Nhà D3": [21.0053, 105.8434],
  "Địa điểm khác trong trường": [21.0045, 105.8445]
};
const LOCATIONS = Object.keys(LANDMARKS);
const ACTIVE = "Đang tìm chủ mới";

// ---------- Database ----------
const db = new Database(path.join(dataDir, "campus_exchange.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  faculty TEXT DEFAULT 'Trường Điện - Điện tử',
  rating REAL DEFAULT 5,
  review_count INTEGER DEFAULT 0,
  role TEXT DEFAULT 'student',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  course TEXT DEFAULT '',
  category TEXT DEFAULT 'Giáo trình',
  condition TEXT DEFAULT 'Tốt',
  mode TEXT NOT NULL DEFAULT 'Bán',
  price INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  location TEXT DEFAULT 'Thư viện Tạ Quang Bửu',
  distance REAL DEFAULT 1.2,
  status TEXT DEFAULT 'Đang tìm chủ mới',
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT DEFAULT '',
  note TEXT DEFAULT '',
  mode TEXT DEFAULT 'Mua',
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'Đang tìm',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_key TEXT NOT NULL,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(sender_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'Chờ phản hồi',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(listing_id) REFERENCES listings(id),
  FOREIGN KEY(requester_id) REFERENCES users(id),
  FOREIGN KEY(owner_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(listing_id) REFERENCES listings(id),
  FOREIGN KEY(reviewer_id) REFERENCES users(id),
  FOREIGN KEY(target_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'Chờ xử lý',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(listing_id) REFERENCES listings(id),
  FOREIGN KEY(reporter_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT DEFAULT 'info',
  text TEXT NOT NULL,
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_key TEXT NOT NULL UNIQUE,
  listing_id INTEGER,
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_a) REFERENCES users(id),
  FOREIGN KEY(user_b) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  meeting_time TEXT NOT NULL,
  location_name TEXT NOT NULL,
  status TEXT DEFAULT 'Chờ xác nhận',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(exchange_id) REFERENCES exchanges(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
`);

function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Nâng cấp CSDL cũ (tạo từ phiên bản demo trước) mà không mất dữ liệu.
addColumn("users", "password_hash", "TEXT");
addColumn("users", "phone", "TEXT DEFAULT ''");
addColumn("users", "phone_hidden", "INTEGER DEFAULT 1");
addColumn("users", "student_code", "TEXT DEFAULT ''");
addColumn("users", "status", "TEXT DEFAULT 'active'");
addColumn("users", "email_verified", "INTEGER DEFAULT 0");
addColumn("users", "verify_hash", "TEXT");
addColumn("users", "verify_expires", "TEXT");
addColumn("reviews", "exchange_id", "INTEGER");
addColumn("messages", "is_read", "INTEGER DEFAULT 0");
addColumn("exchanges", "completed_at", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_exchanges_users ON exchanges(requester_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_key);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);`);

// ---------- Mật khẩu / phiên ----------
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ---------- Dữ liệu mẫu ----------
if (!db.prepare("SELECT COUNT(*) AS n FROM users").get().n) {
  const insertUser = db.prepare("INSERT INTO users(name,email,faculty,rating,review_count,role) VALUES(?,?,?,?,?,?)");
  insertUser.run("Quý", "quy.demo@sis.hust.edu.vn", "Trường Điện - Điện tử", 4.9, 12, "admin");
  insertUser.run("Duy", "duy.demo@sis.hust.edu.vn", "Trường Điện - Điện tử", 4.8, 8, "admin");
  insertUser.run("Sơn", "son.demo@sis.hust.edu.vn", "Trường Điện - Điện tử", 4.7, 6, "admin");
  insertUser.run("Tài khoản mẫu", "mau.demo@sis.hust.edu.vn", "Sinh viên", 5, 0, "student");
  const insertListing = db.prepare(`INSERT INTO listings(title,author,course,category,condition,mode,price,description,image,location,distance,status,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  [
    ["Giáo trình Xử lý tín hiệu số", "John G. Proakis", "Xử lý tín hiệu số", "Giáo trình", "Tốt", "Bán", 65000, "Sách còn tốt, có ghi chú nhẹ ở một vài chương. Phù hợp sinh viên học DSP.", "book-dsp", "Thư viện Tạ Quang Bửu", 0.8, ACTIVE, 1],
    ["Lý thuyết mạch điện", "Nguyễn Bình Thành", "Lý thuyết mạch", "Giáo trình", "Rất tốt", "Trao đổi", 0, "Muốn đổi lấy sách Điện tử tương tự hoặc tài liệu cùng khối ngành.", "book-circuit", "KTX Bách khoa", 1.1, ACTIVE, 2],
    ["Điện từ học – Sadiku", "Matthew N. O. Sadiku", "Trường điện từ", "Sách tham khảo", "Tốt", "Bán", 90000, "Bản tiếng Anh, bìa hơi cũ nhưng nội dung đầy đủ.", "book-em", "Cổng Parabol", 1.5, ACTIVE, 3],
    ["Xác suất thống kê", "Nguyễn Đình Huy", "Xác suất thống kê", "Giáo trình", "Khá", "Tặng", 0, "Tặng lại cho bạn nào cần, ưu tiên sinh viên năm nhất.", "book-stat", "Nhà D3", 0.6, ACTIVE, 1],
    ["Điện tử tương tự", "Sedra / Smith", "Điện tử tương tự", "Giáo trình", "Tốt", "Cho mượn", 0, "Cho mượn trong một học kỳ, hẹn bàn giao tại trường.", "book-analog", "Thư viện Tạ Quang Bửu", 0.9, ACTIVE, 2],
    ["Giải tích 3", "Bộ môn Toán", "Giải tích 3", "Bài giảng in", "Tốt", "Bán", 30000, "Bản in đóng gáy, có kèm một số bài tập tự ghi.", "book-calculus", "KTX Bách khoa", 1.3, ACTIVE, 3]
  ].forEach(x => insertListing.run(...x));
  const insertReq = db.prepare("INSERT INTO requests(title,course,note,mode,user_id,status) VALUES(?,?,?,?,?,?)");
  insertReq.run("Tìm giáo trình Thông tin số", "Thông tin số", "Ưu tiên bản còn tốt, có thể mua hoặc đổi sách.", "Mua / Trao đổi", 2, "Đang tìm");
  insertReq.run("Cần tài liệu Điện tử số", "Điện tử số", "Mình cần trước tuần sau, nhận ở thư viện.", "Mua / Mượn", 1, "Đang tìm");
  const insertMsg = db.prepare("INSERT INTO messages(conversation_key,sender_id,content) VALUES(?,?,?)");
  insertMsg.run("demo-1", 2, "Chào bạn, sách Lý thuyết mạch còn không ạ?");
  insertMsg.run("demo-1", 1, "Chào bạn, sách vẫn còn nhé. Bạn muốn trao đổi hay nhận sách?");
  insertMsg.run("demo-1", 2, "Mình muốn đổi lấy tài liệu Điện tử tương tự, hẹn ở thư viện được không?");
}
// Giữ nguyên cơ chế cập nhật tài khoản demo cho CSDL tạo từ phiên bản trước.
db.prepare("UPDATE users SET name=?, email=?, role='admin', faculty=? WHERE id=1").run("Quý", "quy.demo@sis.hust.edu.vn", "Trường Điện - Điện tử");
db.prepare("UPDATE users SET name=?, email=?, role='admin', faculty=? WHERE id=2").run("Duy", "duy.demo@sis.hust.edu.vn", "Trường Điện - Điện tử");
db.prepare("UPDATE users SET name=?, email=?, role='admin', faculty=? WHERE id=3").run("Sơn", "son.demo@sis.hust.edu.vn", "Trường Điện - Điện tử");
db.prepare("UPDATE users SET name=?, email=?, role='student', faculty=? WHERE id=4").run("Tài khoản mẫu", "mau.demo@sis.hust.edu.vn", "Sinh viên");
const addDemoStudent = db.prepare("INSERT OR IGNORE INTO users(name,email,faculty,rating,review_count,role) VALUES(?,?,?,?,?,'student')");
addDemoStudent.run("Minh Anh", "minhanh.demo@sis.hust.edu.vn", "Trường Điện - Điện tử", 5, 0);
addDemoStudent.run("Hoàng Nam", "hoangnam.demo@sis.hust.edu.vn", "Trường Điện - Điện tử", 5, 0);
{
  const needPw = db.prepare("SELECT id FROM users WHERE password_hash IS NULL").all();
  const setPw = db.prepare("UPDATE users SET password_hash=?, email_verified=1 WHERE id=?");
  if (needPw.length) { const h = hashPassword(DEMO_PASSWORD); needPw.forEach(u => setPw.run(h, u.id)); }
  db.prepare("UPDATE users SET status='active' WHERE status IS NULL").run();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  const u1 = db.prepare("SELECT id FROM users WHERE id=1").get(), u2 = db.prepare("SELECT id FROM users WHERE id=2").get();
  if (u1 && u2) db.prepare("INSERT OR IGNORE INTO conversations(conv_key,listing_id,user_a,user_b) VALUES('demo-1',2,1,2)").run();
}

// ---------- Tiện ích ----------
const USER_SELECT = "SELECT id,name,email,faculty,rating,review_count,role,phone,phone_hidden,student_code,status,email_verified,created_at FROM users";
const str = (v, max = 255) => String(v ?? "").trim().slice(0, max);
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const STOP = new Set(["giao", "trinh", "tai", "lieu", "sach", "bai", "giang", "cua", "va", "cho", "mon", "hoc", "can", "tim", "the", "la", "co", "khong", "mot", "cac", "nhung", "trong", "voi", "de", "ve", "tu", "den", "ban", "nhu", "khi", "se", "duoc", "phan", "chuong", "tap", "on", "thi", "cu", "muc", "tieu", "noi", "dung", "ky", "and", "the", "for", "of", "to", "in"]);
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOP.has(t));
function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  return inter / Math.min(A.size, B.size);
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const attempts = new Map();
function limited(key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); attempts.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (!v.some(t => now - t < 15 * 60 * 1000)) attempts.delete(k); }, 10 * 60 * 1000).unref();

// ---------- SSE (chat/thông báo realtime) ----------
const clients = new Map();
function push(userId, event, data) {
  for (const res of clients.get(userId) || []) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client đã đóng */ } }
}
function notify(userId, type, text, link = "") {
  const info = db.prepare("INSERT INTO notifications(user_id,type,text,link) VALUES(?,?,?,?)").run(userId, type, text, link);
  push(userId, "notification", { id: info.lastInsertRowid, type, text, link });
}

// ---------- Xác thực ----------
function tokenFrom(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; }
function userByToken(token) {
  if (!token) return null;
  const s = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash=?").get(sha(token));
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  const u = db.prepare(USER_SELECT + " WHERE id=?").get(s.user_id);
  return u && u.status === "active" ? u : null;
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(sha(token), userId, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  return token;
}
const optionalAuth = (req, _res, next) => { req.user = userByToken(tokenFrom(req)); next(); };
const requireAuth = (req, res, next) => {
  req.user = userByToken(tokenFrom(req));
  if (!req.user) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
  next();
};
const requireAdmin = (req, res, next) => requireAuth(req, res, () => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Chỉ tài khoản quản trị mới truy cập được." });
  next();
});
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, faculty: u.faculty, rating: u.rating, review_count: u.review_count, role: u.role, phone: u.phone || "", phone_hidden: Number(u.phone_hidden) !== 0, student_code: u.student_code || "" });

// ---------- Middleware & upload ----------
app.use(express.json({ limit: "2mb" }));
app.use((_, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(ROOT, "public")));

const imageFilter = (_, file, cb) => {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new Error("Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF."));
  cb(null, true);
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"))
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter
});
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });
const removeFile = f => { if (f && f.path) fs.unlink(f.path, () => {}); };
const removeImage = img => { if (img && img.startsWith("/uploads/")) fs.unlink(path.join(uploadDir, path.basename(img)), () => {}); };

// ---------- Meta / health ----------
app.get("/api/health", (_, res) => res.json({ ok: true, database: "SQLite", mode: DEMO_MODE ? "demo" : "production", ai: Boolean(ANTHROPIC_API_KEY) }));
app.get("/api/meta", (_, res) => res.json({
  modes: MODES, categories: CATEGORIES, conditions: CONDITIONS, locations: LOCATIONS,
  ai: Boolean(ANTHROPIC_API_KEY), demo: DEMO_MODE, emailDomains: ALLOWED_EMAIL_DOMAINS
}));
app.get("/api/auth/demo-accounts", (_, res) => {
  if (!DEMO_MODE) return res.json({ password: "", accounts: [] });
  const rows = db.prepare("SELECT name,email,role FROM users WHERE email LIKE '%.demo@%' ORDER BY id").all();
  res.json({ password: DEMO_PASSWORD, accounts: rows });
});

// ---------- Auth ----------
function emailAllowed(email) {
  if (ALLOWED_EMAIL_DOMAINS.includes("*")) return true;
  const domain = email.split("@")[1] || "";
  return ALLOWED_EMAIL_DOMAINS.some(d => domain === d || domain.endsWith("." + d));
}
function issueVerifyCode(userId, email) {
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare("UPDATE users SET verify_hash=?, verify_expires=? WHERE id=?").run(sha(code), new Date(Date.now() + 15 * 60000).toISOString(), userId);
  console.log(`[Xác thực email] ${email} → mã ${code} (hết hạn sau 15 phút)`);
  return code;
}
app.post("/api/auth/register", (req, res) => {
  const name = str(req.body.name, 100), email = str(req.body.email, 255).toLowerCase(), password = String(req.body.password || "");
  const studentCode = str(req.body.student_code, 20), faculty = str(req.body.faculty, 100) || "Sinh viên";
  if (limited("reg|" + req.ip, 20)) return res.status(429).json({ error: "Bạn thao tác quá nhiều lần, vui lòng thử lại sau." });
  if (name.length < 2) return res.status(400).json({ error: "Vui lòng nhập họ tên." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Email không hợp lệ." });
  if (!emailAllowed(email)) return res.status(400).json({ error: `Chỉ chấp nhận email sinh viên (${ALLOWED_EMAIL_DOMAINS.map(d => "@" + d).join(", ")}).` });
  if (password.length < 8) return res.status(400).json({ error: "Mật khẩu phải có ít nhất 8 ký tự." });
  if (studentCode && !/^[A-Za-z0-9]{6,20}$/.test(studentCode)) return res.status(400).json({ error: "Mã sinh viên không hợp lệ." });
  const existing = db.prepare("SELECT id,email_verified FROM users WHERE email=?").get(email);
  let userId;
  if (existing && existing.email_verified) return res.status(409).json({ error: "Email này đã được đăng ký." });
  if (existing) {
    db.prepare("UPDATE users SET name=?, password_hash=?, student_code=?, faculty=? WHERE id=?").run(name, hashPassword(password), studentCode, faculty, existing.id);
    userId = existing.id;
  } else {
    userId = db.prepare("INSERT INTO users(name,email,faculty,student_code,password_hash,rating,review_count,role,email_verified) VALUES(?,?,?,?,?,5,0,'student',0)")
      .run(name, email, faculty, studentCode, hashPassword(password)).lastInsertRowid;
  }
  const code = issueVerifyCode(userId, email);
  res.status(201).json({ ok: true, email, demo_code: DEMO_MODE ? code : undefined });
});
app.post("/api/auth/resend", (req, res) => {
  const email = str(req.body.email, 255).toLowerCase();
  if (limited("resend|" + req.ip + "|" + email, 5)) return res.status(429).json({ error: "Bạn yêu cầu gửi mã quá nhiều lần." });
  const u = db.prepare("SELECT id,email_verified FROM users WHERE email=?").get(email);
  if (!u || u.email_verified) return res.json({ ok: true });
  const code = issueVerifyCode(u.id, email);
  res.json({ ok: true, demo_code: DEMO_MODE ? code : undefined });
});
app.post("/api/auth/verify", (req, res) => {
  const email = str(req.body.email, 255).toLowerCase(), code = str(req.body.code, 10);
  if (limited("verify|" + req.ip + "|" + email, 10)) return res.status(429).json({ error: "Bạn nhập sai quá nhiều lần, vui lòng thử lại sau." });
  const u = db.prepare("SELECT id,verify_hash,verify_expires,status FROM users WHERE email=?").get(email);
  if (!u || !u.verify_hash || u.verify_hash !== sha(code) || Date.parse(u.verify_expires) < Date.now()) return res.status(400).json({ error: "Mã xác thực không đúng hoặc đã hết hạn." });
  if (u.status !== "active") return res.status(403).json({ error: "Tài khoản đã bị khóa." });
  db.prepare("UPDATE users SET email_verified=1, verify_hash=NULL, verify_expires=NULL WHERE id=?").run(u.id);
  res.json({ token: createSession(u.id), user: publicUser(db.prepare(USER_SELECT + " WHERE id=?").get(u.id)) });
});
app.post("/api/auth/login", (req, res) => {
  const email = str(req.body.email, 255).toLowerCase(), password = String(req.body.password || "");
  if (limited("login|" + req.ip + "|" + email, 10)) return res.status(429).json({ error: "Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút." });
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: "Email hoặc mật khẩu không đúng." });
  if (u.status !== "active") return res.status(403).json({ error: "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên." });
  if (!u.email_verified) return res.status(403).json({ error: "Email chưa được xác thực.", needs_verification: true, email });
  res.json({ token: createSession(u.id), user: publicUser(db.prepare(USER_SELECT + " WHERE id=?").get(u.id)) });
});
app.post("/api/auth/logout", (req, res) => {
  const t = tokenFrom(req);
  if (t) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(t));
  res.json({ ok: true });
});

// ---------- Hồ sơ ----------
app.get("/api/me", requireAuth, (req, res) => res.json(publicUser(req.user)));
app.patch("/api/me", requireAuth, (req, res) => {
  const b = req.body, cur = req.user;
  const name = b.name !== undefined ? str(b.name, 100) : cur.name;
  const faculty = b.faculty !== undefined ? str(b.faculty, 100) : cur.faculty;
  const phone = b.phone !== undefined ? str(b.phone, 20) : (cur.phone || "");
  const studentCode = b.student_code !== undefined ? str(b.student_code, 20) : (cur.student_code || "");
  const hidden = b.phone_hidden !== undefined ? (b.phone_hidden === true || b.phone_hidden === "true" || b.phone_hidden === 1 ? 1 : 0) : Number(cur.phone_hidden);
  if (name.length < 2) return res.status(400).json({ error: "Họ tên không được để trống." });
  if (phone && !/^[0-9+\s.-]{8,15}$/.test(phone)) return res.status(400).json({ error: "Số điện thoại không hợp lệ." });
  if (studentCode && !/^[A-Za-z0-9]{6,20}$/.test(studentCode)) return res.status(400).json({ error: "Mã sinh viên không hợp lệ." });
  db.prepare("UPDATE users SET name=?, faculty=?, phone=?, student_code=?, phone_hidden=? WHERE id=?").run(name, faculty, phone, studentCode, hidden, cur.id);
  res.json(publicUser(db.prepare(USER_SELECT + " WHERE id=?").get(cur.id)));
});
app.post("/api/me/password", requireAuth, (req, res) => {
  const full = db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.user.id);
  if (!verifyPassword(String(req.body.current || ""), full.password_hash)) return res.status(400).json({ error: "Mật khẩu hiện tại không đúng." });
  const next = String(req.body.next || "");
  if (next.length < 8) return res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 8 ký tự." });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(next), req.user.id);
  const keep = sha(tokenFrom(req));
  db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash != ?").run(req.user.id, keep);
  res.json({ ok: true });
});
app.get("/api/users/:id/reviews", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id,name,faculty,rating,review_count FROM users WHERE id=? AND status='active'").get(id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy người dùng." });
  const reviews = db.prepare(`SELECT r.stars,r.comment,r.created_at,u.name AS reviewer_name FROM reviews r JOIN users u ON u.id=r.reviewer_id
    WHERE r.target_user_id=? ORDER BY r.id DESC LIMIT 50`).all(id);
  res.json({ user, reviews });
});

// ---------- Tài liệu ----------
const listingSelect = `SELECT l.*, u.name AS owner_name, u.rating AS owner_rating, u.review_count AS owner_reviews, u.faculty AS owner_faculty
  FROM listings l JOIN users u ON u.id=l.user_id`;

function cleanListing(b, partial) {
  const out = {};
  const has = k => b[k] !== undefined;
  if (!partial || has("title")) { out.title = str(b.title, 200); if (!out.title) return { error: "Vui lòng nhập tên tài liệu." }; }
  if (!partial || has("author")) out.author = str(b.author, 150);
  if (!partial || has("course")) out.course = str(b.course, 150);
  if (!partial || has("description")) out.description = str(b.description, 2000);
  if (!partial || has("category")) { out.category = str(b.category, 50) || CATEGORIES[0]; if (!CATEGORIES.includes(out.category)) return { error: "Loại tài liệu không hợp lệ." }; }
  if (!partial || has("condition")) { out.condition = str(b.condition, 50) || "Tốt"; if (!CONDITIONS.includes(out.condition)) return { error: "Tình trạng không hợp lệ." }; }
  if (!partial || has("mode")) { out.mode = str(b.mode, 30) || "Bán"; if (!MODES.includes(out.mode)) return { error: "Hình thức không hợp lệ." }; }
  if (!partial || has("location")) { out.location = str(b.location, 100) || LOCATIONS[0]; if (!LOCATIONS.includes(out.location)) return { error: "Địa điểm hẹn không hợp lệ." }; }
  if (!partial || has("price")) {
    const price = Number(b.price || 0);
    if (!Number.isFinite(price) || price < 0 || price > 100000000) return { error: "Giá không hợp lệ." };
    out.price = Math.round(price);
  }
  if (out.mode !== undefined && out.mode !== "Bán") out.price = 0;
  return { data: out };
}
function applyDistance(rows, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return rows;
  return rows.map(r => { const p = LANDMARKS[r.location]; return p ? { ...r, distance: Number(haversine(lat, lng, p[0], p[1]).toFixed(1)) } : r; });
}

app.get("/api/listings", optionalAuth, (req, res) => {
  const { q = "", mode = "", course = "", condition = "", category = "", location = "", sort = "newest", mine = "" } = req.query;
  let sql = listingSelect, args = [];
  if (mine === "1") {
    if (!req.user) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
    sql += " WHERE l.user_id=? AND l.status != 'Đã xóa'"; args.push(req.user.id);
  } else sql += " WHERE l.status = ? AND u.status='active'", args.push(ACTIVE);
  if (String(q).trim()) {
    sql += " AND (l.title LIKE ? OR l.author LIKE ? OR l.course LIKE ? OR l.description LIKE ?)";
    const term = `%${String(q).trim()}%`; args.push(term, term, term, term);
  }
  if (mode && mode !== "Tất cả hình thức") { sql += " AND l.mode=?"; args.push(mode); }
  if (course) { sql += " AND l.course LIKE ?"; args.push(`%${course}%`); }
  if (condition) { sql += " AND l.condition=?"; args.push(condition); }
  if (category) { sql += " AND l.category=?"; args.push(category); }
  if (location) { sql += " AND l.location=?"; args.push(location); }
  const maxPrice = Number(req.query.max_price);
  if (req.query.max_price !== undefined && req.query.max_price !== "" && Number.isFinite(maxPrice)) { sql += " AND l.price<=?"; args.push(maxPrice); }
  sql += sort === "price_asc" ? " ORDER BY l.price ASC, l.id DESC" : " ORDER BY l.id DESC";
  let rows = applyDistance(db.prepare(sql).all(...args), parseFloat(req.query.lat), parseFloat(req.query.lng));
  if (sort === "near") rows = [...rows].sort((a, b) => a.distance - b.distance);
  res.json(rows);
});
app.get("/api/listings/:id", optionalAuth, (req, res) => {
  const item = db.prepare(listingSelect + " WHERE l.id=?").get(Number(req.params.id));
  const isOwner = item && req.user && (req.user.id === item.user_id || req.user.role === "admin");
  if (!item || item.status === "Đã xóa" || (["Đã ẩn", "Đã gỡ"].includes(item.status) && !isOwner)) return res.status(404).json({ error: "Tài liệu không còn tồn tại." });
  res.json(applyDistance([item], parseFloat(req.query.lat), parseFloat(req.query.lng))[0]);
});
app.post("/api/listings", requireAuth, upload.single("image"), (req, res) => {
  const v = cleanListing(req.body, false);
  if (v.error) { removeFile(req.file); return res.status(400).json({ error: v.error }); }
  const d = v.data, image = req.file ? "/uploads/" + req.file.filename : "";
  const info = db.prepare(`INSERT INTO listings(title,author,course,category,condition,mode,price,description,image,location,distance,status,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.title, d.author, d.course, d.category, d.condition, d.mode, d.price, d.description, image, d.location, 1.0, ACTIVE, req.user.id);
  const id = info.lastInsertRowid;
  // Thông báo cho người đang đăng nhu cầu phù hợp.
  db.prepare("SELECT * FROM requests WHERE status='Đang tìm' AND user_id != ?").all(req.user.id).forEach(r => {
    if (similarity(r.title + " " + r.course, d.title + " " + d.course) >= 0.6) notify(r.user_id, "match", `Có tài liệu phù hợp với nhu cầu “${r.title}”: ${d.title}`, "catalog");
  });
  res.status(201).json(db.prepare(listingSelect + " WHERE l.id=?").get(id));
});
app.patch("/api/listings/:id", requireAuth, upload.single("image"), (req, res) => {
  const item = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(req.params.id));
  const fail = (code, error) => { removeFile(req.file); return res.status(code).json({ error }); };
  if (!item || item.status === "Đã xóa") return fail(404, "Không tìm thấy tài liệu.");
  if (item.user_id !== req.user.id) return fail(403, "Bạn chỉ có thể cập nhật bài đăng của mình.");
  if (item.status === "Đã gỡ") return fail(403, "Bài đăng đã bị quản trị viên gỡ do vi phạm.");
  const v = cleanListing(req.body, true);
  if (v.error) return fail(400, v.error);
  const d = v.data;
  if (req.body.status !== undefined) {
    if (![ACTIVE, "Đã trao đổi", "Đã ẩn"].includes(req.body.status)) return fail(400, "Trạng thái không hợp lệ.");
    d.status = req.body.status;
  }
  if (req.file) d.image = "/uploads/" + req.file.filename;
  const keys = Object.keys(d);
  if (!keys.length) return fail(400, "Không có thông tin nào để cập nhật.");
  db.prepare(`UPDATE listings SET ${keys.map(k => k + "=?").join(",")} WHERE id=?`).run(...keys.map(k => d[k]), item.id);
  if (req.file) removeImage(item.image);
  res.json(db.prepare(listingSelect + " WHERE l.id=?").get(item.id));
});
app.delete("/api/listings/:id", requireAuth, (req, res) => {
  const item = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(req.params.id));
  if (!item || item.status === "Đã xóa") return res.status(404).json({ error: "Không tìm thấy tài liệu." });
  if (item.user_id !== req.user.id) return res.status(403).json({ error: "Bạn chỉ có thể xóa bài đăng của mình." });
  const used = db.prepare(`SELECT (SELECT COUNT(*) FROM exchanges WHERE listing_id=?) + (SELECT COUNT(*) FROM reviews WHERE listing_id=?) + (SELECT COUNT(*) FROM reports WHERE listing_id=?) AS n`).get(item.id, item.id, item.id).n;
  if (used) { db.prepare("UPDATE listings SET status='Đã xóa' WHERE id=?").run(item.id); return res.json({ ok: true, soft: true }); }
  db.prepare("DELETE FROM listings WHERE id=?").run(item.id);
  removeImage(item.image);
  res.json({ ok: true });
});

// ---------- Nhu cầu tìm tài liệu ----------
app.get("/api/requests", optionalAuth, (req, res) => {
  const mine = req.query.mine === "1" && req.user;
  const rows = db.prepare(`SELECT r.*,u.name AS user_name FROM requests r JOIN users u ON u.id=r.user_id ${mine ? "WHERE r.user_id=?" : "WHERE r.status='Đang tìm'"} ORDER BY r.id DESC`).all(...(mine ? [req.user.id] : []));
  res.json(rows);
});
app.post("/api/requests", requireAuth, (req, res) => {
  const title = str(req.body.title, 200);
  if (!title) return res.status(400).json({ error: "Vui lòng nhập tên tài liệu cần tìm." });
  const info = db.prepare("INSERT INTO requests(title,course,note,mode,user_id,status) VALUES(?,?,?,?,?,'Đang tìm')")
    .run(title, str(req.body.course, 150), str(req.body.note, 1000), str(req.body.mode, 50) || "Mua / Trao đổi", req.user.id);
  const created = db.prepare("SELECT r.*,u.name AS user_name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?").get(info.lastInsertRowid);
  // Có sẵn tài liệu phù hợp thì báo ngay.
  const hit = db.prepare(listingSelect + " WHERE l.status=? AND l.user_id != ? AND u.status='active'").all(ACTIVE, req.user.id)
    .filter(l => similarity(title + " " + created.course, l.title + " " + l.course) >= 0.6);
  if (hit.length) notify(req.user.id, "match", `Đã có ${hit.length} tài liệu phù hợp với “${title}”: ${hit[0].title}${hit.length > 1 ? "…" : ""}`, "catalog");
  res.status(201).json(created);
});
app.patch("/api/requests/:id", requireAuth, (req, res) => {
  const r = db.prepare("SELECT * FROM requests WHERE id=?").get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: "Không tìm thấy nhu cầu." });
  if (r.user_id !== req.user.id) return res.status(403).json({ error: "Bạn chỉ có thể cập nhật nhu cầu của mình." });
  const status = req.body.status;
  if (!["Đang tìm", "Đã đóng"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  db.prepare("UPDATE requests SET status=? WHERE id=?").run(status, r.id);
  res.json({ ok: true });
});

// ---------- Trao đổi ----------
function getOrCreateConversation(listingId, userX, userY) {
  const a = Math.min(userX, userY), b = Math.max(userX, userY);
  const key = `l${listingId}-u${a}-u${b}`;
  db.prepare("INSERT OR IGNORE INTO conversations(conv_key,listing_id,user_a,user_b) VALUES(?,?,?,?)").run(key, listingId, a, b);
  return key;
}
app.post("/api/exchanges", requireAuth, (req, res) => {
  const listing = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(req.body.listing_id));
  if (!listing || listing.status === "Đã xóa") return res.status(404).json({ error: "Tài liệu không tồn tại." });
  if (listing.status !== ACTIVE) return res.status(409).json({ error: "Tài liệu này không còn khả dụng." });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: "Bạn không thể gửi yêu cầu cho bài đăng của mình." });
  const dup = db.prepare("SELECT id FROM exchanges WHERE listing_id=? AND requester_id=? AND status IN ('Chờ phản hồi','Đã chấp nhận')").get(listing.id, req.user.id);
  if (dup) return res.status(409).json({ error: "Bạn đã gửi yêu cầu cho tài liệu này rồi." });
  const info = db.prepare("INSERT INTO exchanges(listing_id,requester_id,owner_id,message) VALUES(?,?,?,?)")
    .run(listing.id, req.user.id, listing.user_id, str(req.body.message, 500));
  getOrCreateConversation(listing.id, req.user.id, listing.user_id);
  notify(listing.user_id, "exchange", `${req.user.name} gửi yêu cầu cho “${listing.title}”.`, "exchanges");
  res.status(201).json({ id: info.lastInsertRowid, status: "Chờ phản hồi" });
});
app.get("/api/exchanges", requireAuth, (req, res) => {
  const me = req.user;
  const rows = db.prepare(`SELECT e.*, l.title AS listing_title, l.mode AS listing_mode, l.location AS listing_location,
      a.name AS requester_name, a.phone AS req_phone, a.phone_hidden AS req_hidden,
      b.name AS owner_name, b.phone AS own_phone, b.phone_hidden AS own_hidden,
      (SELECT COUNT(*) FROM reviews r WHERE r.exchange_id=e.id AND r.reviewer_id=?) AS reviewed
    FROM exchanges e JOIN listings l ON l.id=e.listing_id JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.owner_id
    WHERE e.requester_id=? OR e.owner_id=? ORDER BY e.id DESC`).all(me.id, me.id, me.id);
  const meetings = rows.length
    ? db.prepare(`SELECT * FROM meetings WHERE exchange_id IN (${rows.map(() => "?").join(",")}) AND status != 'Đã hủy' ORDER BY id DESC`).all(...rows.map(r => r.id))
    : [];
  res.json(rows.map(r => {
    const iAmOwner = r.owner_id === me.id;
    const phone = iAmOwner ? r.req_phone : r.own_phone, hidden = Number(iAmOwner ? r.req_hidden : r.own_hidden) !== 0;
    const shared = ["Đã chấp nhận", "Đã hoàn tất"].includes(r.status) && phone && !hidden;
    const { req_phone, req_hidden, own_phone, own_hidden, ...rest } = r;
    return { ...rest, reviewed: Number(r.reviewed) > 0, counterpart_id: iAmOwner ? r.requester_id : r.owner_id, counterpart_phone: shared ? phone : "", meeting: meetings.find(m => m.exchange_id === r.id) || null };
  }));
});
app.patch("/api/exchanges/:id", requireAuth, (req, res) => {
  const me = req.user;
  const ex = db.prepare("SELECT e.*, l.title AS listing_title, l.status AS listing_status FROM exchanges e JOIN listings l ON l.id=e.listing_id WHERE e.id=?").get(Number(req.params.id));
  if (!ex || (ex.owner_id !== me.id && ex.requester_id !== me.id)) return res.status(404).json({ error: "Không tìm thấy yêu cầu." });
  const status = req.body.status, isOwner = ex.owner_id === me.id;
  if (!["Đã chấp nhận", "Đã từ chối", "Đã hoàn tất", "Đã hủy"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  const needsPending = status !== "Đã hoàn tất";
  if (needsPending && ex.status !== "Chờ phản hồi") return res.status(409).json({ error: "Yêu cầu đã được xử lý, không thể thay đổi." });
  if (!needsPending && ex.status !== "Đã chấp nhận") return res.status(409).json({ error: "Chỉ có thể hoàn tất yêu cầu đã được chấp nhận." });
  if (status === "Đã hủy" ? isOwner : !isOwner) return res.status(403).json({ error: status === "Đã hủy" ? "Chỉ người gửi yêu cầu mới có thể hủy." : "Chỉ người đăng tài liệu mới có thể phản hồi yêu cầu." });
  const other = isOwner ? ex.requester_id : ex.owner_id;
  if (status === "Đã chấp nhận" && ex.listing_status !== ACTIVE) return res.status(409).json({ error: "Tài liệu không còn khả dụng." });
  db.transaction(() => {
    db.prepare("UPDATE exchanges SET status=?, completed_at=CASE WHEN ?='Đã hoàn tất' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?").run(status, status, ex.id);
    if (status === "Đã hoàn tất") {
      db.prepare("UPDATE listings SET status='Đã trao đổi' WHERE id=?").run(ex.listing_id);
      const others = db.prepare("SELECT id,requester_id FROM exchanges WHERE listing_id=? AND id != ? AND status IN ('Chờ phản hồi','Đã chấp nhận')").all(ex.listing_id, ex.id);
      others.forEach(o => {
        db.prepare("UPDATE exchanges SET status='Đã từ chối' WHERE id=?").run(o.id);
        notify(o.requester_id, "exchange", `“${ex.listing_title}” đã được trao cho người khác nên yêu cầu của bạn bị đóng.`, "exchanges");
      });
    }
  })();
  const text = {
    "Đã chấp nhận": `${me.name} đã chấp nhận yêu cầu cho “${ex.listing_title}”. Hãy nhắn tin để hẹn gặp.`,
    "Đã từ chối": `${me.name} đã từ chối yêu cầu cho “${ex.listing_title}”.`,
    "Đã hoàn tất": `Giao dịch “${ex.listing_title}” đã hoàn tất. Hãy đánh giá ${me.name}.`,
    "Đã hủy": `${me.name} đã hủy yêu cầu cho “${ex.listing_title}”.`
  }[status];
  notify(other, "exchange", text, "exchanges");
  res.json({ ok: true, status });
});

// ---------- Hẹn gặp ----------
function participantExchange(id, userId) {
  const ex = db.prepare("SELECT e.*, l.title AS listing_title FROM exchanges e JOIN listings l ON l.id=e.listing_id WHERE e.id=?").get(id);
  return ex && (ex.owner_id === userId || ex.requester_id === userId) ? ex : null;
}
app.post("/api/exchanges/:id/meetings", requireAuth, (req, res) => {
  const ex = participantExchange(Number(req.params.id), req.user.id);
  if (!ex) return res.status(404).json({ error: "Không tìm thấy yêu cầu." });
  if (ex.status !== "Đã chấp nhận") return res.status(409).json({ error: "Chỉ đặt lịch hẹn khi yêu cầu đã được chấp nhận." });
  const time = str(req.body.meeting_time, 40), place = str(req.body.location_name, 255);
  const ts = Date.parse(time);
  if (!time || Number.isNaN(ts)) return res.status(400).json({ error: "Thời gian hẹn không hợp lệ." });
  if (ts < Date.now() - 60000) return res.status(400).json({ error: "Thời gian hẹn phải ở tương lai." });
  if (place.length < 2) return res.status(400).json({ error: "Vui lòng nhập địa điểm hẹn." });
  db.prepare("UPDATE meetings SET status='Đã hủy' WHERE exchange_id=? AND status != 'Đã hủy'").run(ex.id);
  const info = db.prepare("INSERT INTO meetings(exchange_id,created_by,meeting_time,location_name) VALUES(?,?,?,?)").run(ex.id, req.user.id, time, place);
  notify(ex.owner_id === req.user.id ? ex.requester_id : ex.owner_id, "meeting", `${req.user.name} đề xuất hẹn gặp nhận “${ex.listing_title}” tại ${place}.`, "exchanges");
  res.status(201).json({ id: info.lastInsertRowid, status: "Chờ xác nhận" });
});
app.patch("/api/meetings/:id", requireAuth, (req, res) => {
  const m = db.prepare("SELECT * FROM meetings WHERE id=?").get(Number(req.params.id));
  const ex = m && participantExchange(m.exchange_id, req.user.id);
  if (!ex) return res.status(404).json({ error: "Không tìm thấy lịch hẹn." });
  const status = req.body.status;
  if (!["Đã xác nhận", "Đã hủy"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  if (m.status !== "Chờ xác nhận" && !(m.status === "Đã xác nhận" && status === "Đã hủy")) return res.status(409).json({ error: "Lịch hẹn đã được xử lý." });
  if (status === "Đã xác nhận" && m.created_by === req.user.id) return res.status(403).json({ error: "Người còn lại mới có thể xác nhận lịch hẹn." });
  db.prepare("UPDATE meetings SET status=? WHERE id=?").run(status, m.id);
  notify(m.created_by === req.user.id ? (ex.owner_id === req.user.id ? ex.requester_id : ex.owner_id) : m.created_by, "meeting",
    `${req.user.name} ${status === "Đã xác nhận" ? "đã xác nhận" : "đã hủy"} lịch hẹn nhận “${ex.listing_title}”.`, "exchanges");
  res.json({ ok: true });
});

// ---------- Chat ----------
function participantConv(key, userId) {
  const c = db.prepare("SELECT * FROM conversations WHERE conv_key=?").get(key);
  return c && (c.user_a === userId || c.user_b === userId) ? c : null;
}
app.post("/api/conversations", requireAuth, (req, res) => {
  const listing = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(req.body.listing_id));
  if (!listing || listing.status === "Đã xóa") return res.status(404).json({ error: "Tài liệu không tồn tại." });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: "Đây là bài đăng của bạn." });
  res.status(201).json({ key: getOrCreateConversation(listing.id, req.user.id, listing.user_id) });
});
app.get("/api/conversations", requireAuth, (req, res) => {
  const me = req.user.id;
  res.json(db.prepare(`SELECT c.conv_key AS key, c.listing_id, l.title AS listing_title,
      CASE WHEN c.user_a=? THEN ub.name ELSE ua.name END AS counterpart_name,
      (SELECT content FROM messages m WHERE m.conversation_key=c.conv_key ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages m WHERE m.conversation_key=c.conv_key ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_key=c.conv_key AND m.sender_id != ? AND m.is_read=0) AS unread,
      c.created_at
    FROM conversations c LEFT JOIN listings l ON l.id=c.listing_id JOIN users ua ON ua.id=c.user_a JOIN users ub ON ub.id=c.user_b
    WHERE c.user_a=? OR c.user_b=? ORDER BY COALESCE(last_at, c.created_at) DESC`).all(me, me, me, me));
});
app.get("/api/messages/:key", requireAuth, (req, res) => {
  if (!participantConv(req.params.key, req.user.id)) return res.status(404).json({ error: "Không tìm thấy cuộc trò chuyện." });
  db.prepare("UPDATE messages SET is_read=1 WHERE conversation_key=? AND sender_id != ?").run(req.params.key, req.user.id);
  res.json(db.prepare("SELECT m.*,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE conversation_key=? ORDER BY m.id").all(req.params.key));
});
app.post("/api/messages/:key", requireAuth, (req, res) => {
  const conv = participantConv(req.params.key, req.user.id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy cuộc trò chuyện." });
  const content = str(req.body.content, 2000);
  if (!content) return res.status(400).json({ error: "Tin nhắn không được để trống." });
  const info = db.prepare("INSERT INTO messages(conversation_key,sender_id,content) VALUES(?,?,?)").run(req.params.key, req.user.id, content);
  const msg = db.prepare("SELECT m.*,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?").get(info.lastInsertRowid);
  push(conv.user_a === req.user.id ? conv.user_b : conv.user_a, "message", { key: req.params.key, sender: req.user.name });
  res.status(201).json(msg);
});
app.get("/api/unread", requireAuth, (req, res) => {
  const me = req.user.id;
  res.json({
    messages: db.prepare(`SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.conv_key=m.conversation_key
      WHERE (c.user_a=? OR c.user_b=?) AND m.sender_id != ? AND m.is_read=0`).get(me, me, me).n,
    notifications: db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0").get(me).n
  });
});
app.get("/api/notifications", requireAuth, (req, res) => res.json(db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id)));
app.post("/api/notifications/read-all", requireAuth, (req, res) => { db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=?").run(req.user.id); res.json({ ok: true }); });
app.get("/api/stream", (req, res) => {
  const user = userByToken(String(req.query.token || ""));
  if (!user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ." });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  res.write(": connected\n\n");
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  clients.get(user.id).add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, 25000);
  req.on("close", () => { clearInterval(ping); const set = clients.get(user.id); if (set) { set.delete(res); if (!set.size) clients.delete(user.id); } });
});

// ---------- Đánh giá ----------
app.post("/api/reviews", requireAuth, (req, res) => {
  const ex = db.prepare("SELECT * FROM exchanges WHERE id=?").get(Number(req.body.exchange_id));
  const n = Number(req.body.stars);
  if (!ex || (ex.owner_id !== req.user.id && ex.requester_id !== req.user.id)) return res.status(404).json({ error: "Không tìm thấy giao dịch." });
  if (!Number.isInteger(n) || n < 1 || n > 5) return res.status(400).json({ error: "Số sao phải từ 1 đến 5." });
  if (ex.status !== "Đã hoàn tất") return res.status(409).json({ error: "Chỉ đánh giá được khi giao dịch đã hoàn tất." });
  if (db.prepare("SELECT id FROM reviews WHERE exchange_id=? AND reviewer_id=?").get(ex.id, req.user.id)) return res.status(409).json({ error: "Bạn đã đánh giá giao dịch này rồi." });
  const target = ex.owner_id === req.user.id ? ex.requester_id : ex.owner_id;
  db.prepare("INSERT INTO reviews(listing_id,exchange_id,reviewer_id,target_user_id,stars,comment) VALUES(?,?,?,?,?,?)").run(ex.listing_id, ex.id, req.user.id, target, n, str(req.body.comment, 500));
  const agg = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS count FROM reviews WHERE target_user_id=?").get(target);
  db.prepare("UPDATE users SET rating=?, review_count=? WHERE id=?").run(Number(agg.avg.toFixed(1)), agg.count, target);
  notify(target, "review", `${req.user.name} đã đánh giá bạn ${n}★ sau giao dịch.`, "profile");
  res.status(201).json({ ok: true, rating: Number(agg.avg.toFixed(1)), review_count: agg.count });
});

// ---------- Báo cáo ----------
app.post("/api/reports", requireAuth, (req, res) => {
  const reason = str(req.body.reason, 500);
  if (!reason) return res.status(400).json({ error: "Vui lòng nhập lý do báo cáo." });
  const listingId = req.body.listing_id ? Number(req.body.listing_id) : null;
  if (listingId && !db.prepare("SELECT id FROM listings WHERE id=?").get(listingId)) return res.status(404).json({ error: "Tài liệu không tồn tại." });
  if (listingId && db.prepare("SELECT id FROM reports WHERE listing_id=? AND reporter_id=? AND status='Chờ xử lý'").get(listingId, req.user.id)) return res.status(409).json({ error: "Bạn đã báo cáo bài đăng này, quản trị viên đang xử lý." });
  const info = db.prepare("INSERT INTO reports(listing_id,reporter_id,reason) VALUES(?,?,?)").run(listingId, req.user.id, reason);
  db.prepare("SELECT id FROM users WHERE role='admin' AND status='active' AND id != ?").all(req.user.id).forEach(a => notify(a.id, "report", "Có báo cáo vi phạm mới cần xử lý.", "admin"));
  res.status(201).json({ id: info.lastInsertRowid, ok: true });
});

// ---------- Quản trị ----------
app.get("/api/admin/summary", requireAdmin, (_req, res) => {
  const n = sql => db.prepare(sql).get().n;
  res.json({
    users: n("SELECT COUNT(*) n FROM users"), lockedUsers: n("SELECT COUNT(*) n FROM users WHERE status='locked'"),
    listings: n("SELECT COUNT(*) n FROM listings WHERE status = 'Đang tìm chủ mới'"),
    exchanges: n("SELECT COUNT(*) n FROM exchanges"), pendingReports: n("SELECT COUNT(*) n FROM reports WHERE status='Chờ xử lý'"),
    reports: db.prepare(`SELECT r.*,u.name AS reporter_name,l.title AS listing_title,l.status AS listing_status,l.user_id AS owner_id
      FROM reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN listings l ON l.id=r.listing_id ORDER BY (r.status='Chờ xử lý') DESC, r.id DESC`).all()
  });
});
app.patch("/api/admin/reports/:id", requireAdmin, (req, res) => {
  const r = db.prepare("SELECT r.*, l.title AS listing_title, l.user_id AS owner_id FROM reports r LEFT JOIN listings l ON l.id=r.listing_id WHERE r.id=?").get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: "Không tìm thấy báo cáo." });
  if (r.status !== "Chờ xử lý") return res.status(409).json({ error: "Báo cáo đã được xử lý." });
  const action = req.body.action;
  if (!["remove", "dismiss", "resolve"].includes(action)) return res.status(400).json({ error: "Thao tác không hợp lệ." });
  if (action === "remove" && !r.listing_id) return res.status(400).json({ error: "Báo cáo này không gắn với bài đăng nào." });
  db.transaction(() => {
    if (action === "remove") {
      db.prepare("UPDATE listings SET status='Đã gỡ' WHERE id=?").run(r.listing_id);
      notify(r.owner_id, "moderation", `Bài đăng “${r.listing_title}” đã bị gỡ do vi phạm.`, "profile");
    }
    db.prepare("UPDATE reports SET status=? WHERE id=?").run(action === "dismiss" ? "Bác bỏ" : "Đã xử lý", r.id);
  })();
  notify(r.reporter_id, "report", action === "dismiss" ? "Báo cáo của bạn đã được xem xét và không đủ cơ sở xử lý." : "Báo cáo của bạn đã được xử lý. Cảm ơn bạn!", "");
  res.json({ ok: true });
});
app.get("/api/admin/users", requireAdmin, (_req, res) => {
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.role,u.status,u.rating,u.review_count,u.created_at,u.email_verified,
    (SELECT COUNT(*) FROM listings l WHERE l.user_id=u.id AND l.status != 'Đã xóa') AS listing_count FROM users u ORDER BY u.id`).all());
});
app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id), status = req.body.status;
  if (!["active", "locked"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  if (id === req.user.id) return res.status(400).json({ error: "Bạn không thể tự khóa tài khoản của mình." });
  const u = db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "Không tìm thấy người dùng." });
  if (u.role === "admin") return res.status(403).json({ error: "Không thể khóa tài khoản quản trị viên khác." });
  db.prepare("UPDATE users SET status=? WHERE id=?").run(status, id);
  if (status === "locked") { db.prepare("DELETE FROM sessions WHERE user_id=?").run(id); for (const c of clients.get(id) || []) { try { c.end(); } catch { /* ignore */ } } }
  res.json({ ok: true });
});
app.get("/api/admin/listings", requireAdmin, (_req, res) => {
  res.json(db.prepare(listingSelect + " WHERE l.status != 'Đã xóa' ORDER BY l.id DESC").all());
});
app.patch("/api/admin/listings/:id", requireAdmin, (req, res) => {
  const item = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(req.params.id));
  if (!item || item.status === "Đã xóa") return res.status(404).json({ error: "Không tìm thấy tài liệu." });
  const status = req.body.status;
  if (![ACTIVE, "Đã ẩn", "Đã gỡ"].includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  db.prepare("UPDATE listings SET status=? WHERE id=?").run(status, item.id);
  if (status === "Đã gỡ") notify(item.user_id, "moderation", `Bài đăng “${item.title}” đã bị quản trị viên gỡ do vi phạm.`, "profile");
  res.json({ ok: true });
});

// ---------- Trợ lý AI ----------
async function callClaude(content, { system, maxTokens = 500 } = {}) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(25000)
  });
  if (!resp.ok) throw new Error(`Anthropic API trả về ${resp.status}`);
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
function extractJson(text, open, close) {
  const s = text.indexOf(open), e = text.lastIndexOf(close);
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
app.post("/api/ai/extract-cover", requireAuth, uploadMem.single("image"), async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: "Chưa cấu hình ANTHROPIC_API_KEY trên máy chủ nên chưa dùng được nhận diện ảnh bìa.", ai: false });
  if (!req.file) return res.status(400).json({ error: "Vui lòng chọn ảnh bìa tài liệu." });
  if (limited("ai|" + req.user.id, 30, 60 * 60 * 1000)) return res.status(429).json({ error: "Bạn đã dùng AI quá nhiều lần, vui lòng thử lại sau." });
  try {
    const text = await callClaude([
      { type: "image", source: { type: "base64", media_type: req.file.mimetype, data: req.file.buffer.toString("base64") } },
      { type: "text", text: `Đọc ảnh bìa sách/tài liệu này và trả về DUY NHẤT một JSON dạng {"title":"","author":"","course":"","category":""}. ` +
        `title: tên tài liệu; author: tác giả (nếu thấy); course: môn học liên quan (suy ra từ tên sách nếu hợp lý); ` +
        `category: một trong ${JSON.stringify(CATEGORIES)}. Trường nào không chắc chắn thì để chuỗi rỗng. Không giải thích thêm.` }
    ], { system: "Bạn là trợ lý nhập liệu cho hệ thống trao đổi giáo trình của sinh viên. Chỉ trả về JSON hợp lệ.", maxTokens: 400 });
    const j = extractJson(text, "{", "}");
    if (!j) return res.status(502).json({ error: "AI không đọc được thông tin từ ảnh này. Hãy thử ảnh rõ hơn hoặc nhập tay." });
    res.json({ title: str(j.title, 200), author: str(j.author, 150), course: str(j.course, 150), category: CATEGORIES.includes(j.category) ? j.category : "" });
  } catch (e) {
    console.error("[AI extract-cover]", e.message);
    res.status(502).json({ error: "Không gọi được dịch vụ AI lúc này, bạn có thể nhập thông tin thủ công." });
  }
});
app.post("/api/ai/recommend", optionalAuth, async (req, res) => {
  const text = str(req.body.text, 6000);
  if (text.length < 3) return res.status(400).json({ error: "Hãy nhập tên môn học hoặc dán nội dung đề cương." });
  let phrases = [], usedAI = false;
  if (ANTHROPIC_API_KEY && !limited("ai-rec|" + (req.user ? req.user.id : req.ip), 40, 60 * 60 * 1000)) {
    try {
      const out = await callClaude(`Đề cương/nhu cầu của sinh viên:\n"""${text}"""\n\nTrả về DUY NHẤT một mảng JSON gồm tối đa 8 cụm từ khóa (tên môn học, tên giáo trình, tác giả nổi tiếng) giúp tìm giáo trình phù hợp. Ví dụ: ["Xử lý tín hiệu số","Proakis"].`,
        { system: "Bạn là trợ lý gợi ý giáo trình. Chỉ trả về mảng JSON.", maxTokens: 300 });
      const arr = extractJson(out, "[", "]");
      if (Array.isArray(arr)) { phrases = arr.map(x => str(x, 100)).filter(Boolean).slice(0, 8); usedAI = phrases.length > 0; }
    } catch (e) { console.error("[AI recommend]", e.message); }
  }
  let keywords;
  if (usedAI) keywords = [...new Set(phrases.flatMap(tokens))];
  else {
    const freq = new Map(); tokens(text).forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
    keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(x => x[0]);
  }
  const rows = db.prepare(listingSelect + " WHERE l.status=? AND u.status='active'").all(ACTIVE);
  const phraseNorms = phrases.map(norm);
  const scored = rows.map(l => {
    const t1 = new Set(tokens(l.title + " " + l.course)), t2 = new Set(tokens(l.author + " " + l.description + " " + l.category));
    const matched = keywords.filter(k => t1.has(k) || t2.has(k));
    let score = keywords.reduce((s, k) => s + (t1.has(k) ? 2 : 0) + (t2.has(k) ? 1 : 0), 0);
    const hay = norm(l.title + " " + l.course);
    phraseNorms.forEach(p => { if (p && hay.includes(p)) score += 5; });
    return { ...l, score, matched };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  res.json({ ai: usedAI, keywords: usedAI ? phrases : keywords.slice(0, 8), results: scored });
});

// ---------- Fallback & lỗi ----------
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API không tồn tại." });
  res.sendFile(path.join(ROOT, "public", "index.html"));
});
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Ảnh vượt quá 5 MB." });
  console.error(err);
  res.status(400).json({ error: err.message || "Có lỗi xảy ra." });
});

app.listen(PORT, () => {
  console.log(`\n📚 Trao đổi tài liệu sinh viên đang chạy: http://localhost:${PORT}`);
  console.log(DEMO_MODE ? `Chế độ DEMO: tài khoản mẫu dùng mật khẩu "${DEMO_PASSWORD}"; mã xác thực email hiển thị ngay trên giao diện và ở console.` : "Chế độ production: mã xác thực email chỉ được ghi ở console (cần tích hợp dịch vụ gửi mail).");
  console.log(ANTHROPIC_API_KEY ? `AI: bật (model ${AI_MODEL})\n` : "AI: tắt — đặt ANTHROPIC_API_KEY để bật nhận diện ảnh bìa bằng AI (gợi ý theo đề cương vẫn chạy bằng so khớp từ khóa).\n");
});
