// db.js — подключение к PostgreSQL (Railway) и инициализация схемы
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Railway автоматически предоставляет DATABASE_URL при добавлении PostgreSQL.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('⚠  DATABASE_URL не задан. Добавьте PostgreSQL в проект Railway.');
}

const pool = new Pool({
  connectionString,
  // Railway требует SSL для внешних подключений; для внутренних не мешает.
  ssl: connectionString && connectionString.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false),
});

// Прогон schema.sql при старте (idempotent — безопасно запускать каждый раз)
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('✓ Схема БД готова');
}

module.exports = { pool, initSchema };
