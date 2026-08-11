// db.js — подключение к PostgreSQL (Railway) и инициализация схемы
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Railway автоматически предоставляет DATABASE_URL при добавлении PostgreSQL.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('⚠  DATABASE_URL не задан. Добавьте PostgreSQL в проект Railway.');
}

// SSL: для ВНУТРЕННЕГО подключения Railway (*.railway.internal) SSL НЕ нужен
// и может ломать соединение. Для внешних (proxy.rlwy.net и т.п.) — нужен.
function needSSL(cs) {
  if (!cs) return false;
  if (cs.includes('.railway.internal')) return false;   // внутренняя сеть — без SSL
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return true;
  // внешние хосты Railway (proxy.rlwy.net / containers-*.railway.app)
  if (cs.includes('rlwy.net') || cs.includes('railway')) return true;
  return false;
}

const pool = new Pool({
  connectionString,
  ssl: needSSL(connectionString) ? { rejectUnauthorized: false } : false,
});

// Прогон schema.sql при старте (idempotent — безопасно запускать каждый раз)
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
}

module.exports = { pool, initSchema };
