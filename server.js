// server.js — Express backend для «Заказ обедов» (Railway + PostgreSQL)
const express = require('express');
const path = require('path');
const { pool, initSchema } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MAIN_PRICE = 1000, BAKE_PRICE = 700;

// ---------- helper: цена по умолчанию ----------
function defaultPrice(kind) { return kind === 'main' ? MAIN_PRICE : BAKE_PRICE; }

// ======================================================
//  МЕНЮ  (активные блюда на сегодня)  ->  {mains:[], bakes:[]}
// ======================================================
app.get('/api/menu', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT title, kind FROM dishes WHERE is_active = TRUE ORDER BY id`);
    const mains = rows.filter(r => r.kind === 'main').map(r => r.title);
    const bakes = rows.filter(r => r.kind === 'bake').map(r => r.title);
    res.json({ mains, bakes });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Сохранить «меню на сегодня»: список отмеченных названий по категориям
app.put('/api/menu', async (req, res) => {
  const body = req.body || {};
  const mains = Array.isArray(body.mains) ? body.mains : [];
  const bakes = Array.isArray(body.bakes) ? body.bakes : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // сбросить все, затем активировать выбранные
    await client.query(`UPDATE dishes SET is_active = FALSE`);
    if (mains.length)
      await client.query(
        `UPDATE dishes SET is_active = TRUE WHERE kind='main' AND title = ANY($1)`, [mains]);
    if (bakes.length)
      await client.query(
        `UPDATE dishes SET is_active = TRUE WHERE kind='bake' AND title = ANY($1)`, [bakes]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: String(e) });
  } finally { client.release(); }
});

// ======================================================
//  СПРАВОЧНИК БЛЮД (все возможные) + добавление новых
// ======================================================
// Все блюда категории: [{title, price}]  (для чекбоксов в админке)
app.get('/api/dishes/:kind', async (req, res) => {
  const kind = req.params.kind === 'bake' ? 'bake' : 'main';
  try {
    const { rows } = await pool.query(
      `SELECT title, price, is_active FROM dishes WHERE kind=$1 ORDER BY id`, [kind]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Добавить новое блюдо в справочник
app.post('/api/dishes/:kind', async (req, res) => {
  const kind = req.params.kind === 'bake' ? 'bake' : 'main';
  const title = (req.body && req.body.title || '').trim();
  let price = (req.body && req.body.price);
  price = (price === '' || price == null) ? null : Math.max(0, parseInt(price, 10) || 0);
  if (!title) return res.status(400).json({ error: 'Пустое название' });
  try {
    await pool.query(
      `INSERT INTO dishes(title, kind, price, is_active) VALUES ($1,$2,$3,FALSE)
       ON CONFLICT (title, kind) DO NOTHING`, [title, kind, price]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Удалить блюдо из справочника (по желанию — для чистки)
app.delete('/api/dishes/:kind/:title', async (req, res) => {
  const kind = req.params.kind === 'bake' ? 'bake' : 'main';
  try {
    await pool.query(`DELETE FROM dishes WHERE kind=$1 AND title=$2`,
      [kind, req.params.title]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Изменить цену блюда (NULL = цена по умолчанию)
app.put('/api/dishes/:kind/:title', async (req, res) => {
  const kind = req.params.kind === 'bake' ? 'bake' : 'main';
  let price = (req.body && req.body.price);
  price = (price === '' || price == null) ? null : Math.max(0, parseInt(price, 10) || 0);
  try {
    await pool.query(`UPDATE dishes SET price=$1 WHERE kind=$2 AND title=$3`,
      [price, kind, req.params.title]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// ======================================================
//  ЗАКАЗЫ  ->  [{name, items:[{title,cat,qty,price}], sum, paid, cid}]
// ======================================================
app.get('/api/orders', async (req, res) => {
  try {
    const { rows: ords } = await pool.query(
      `SELECT id, customer, client_id, total, paid, note FROM orders ORDER BY id`);
    const { rows: items } = await pool.query(
      `SELECT order_id, title, kind, qty, price FROM order_items`);
    const byOrder = {};
    items.forEach(it => {
      (byOrder[it.order_id] = byOrder[it.order_id] || []).push(
        { title: it.title, cat: it.kind, qty: it.qty, price: it.price });
    });
    res.json(ords.map(o => ({
      name: o.customer, cid: o.client_id, sum: o.total, paid: o.paid, note: o.note || '',
      items: byOrder[o.id] || []
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Добавить один заказ
app.post('/api/orders', async (req, res) => {
  const o = req.body || {};
  const items = Array.isArray(o.items) ? o.items : [];
  if (!o.name || !items.length) return res.status(400).json({ error: 'Некорректный заказ' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sum = items.reduce((s, it) => s + (it.qty * it.price), 0);
    const { rows } = await client.query(
      `INSERT INTO orders(customer, client_id, total, paid, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [String(o.name).trim(), o.cid || null, sum, o.paid !== false, (o.note || '').toString().slice(0, 300)]);
    const oid = rows[0].id;
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items(order_id, title, kind, qty, price) VALUES ($1,$2,$3,$4,$5)`,
        [oid, it.title, it.cat === 'bake' ? 'bake' : 'main', it.qty, it.price]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, id: oid });
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: String(e) });
  } finally { client.release(); }
});

// Удалить все заказы (кнопка «Очистить» в админке)
app.delete('/api/orders', async (req, res) => {
  try { await pool.query(`DELETE FROM orders`); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// ======================================================
//  НАСТРОЙКИ (forceOpen и т.п.)
// ======================================================
app.get('/api/settings/:key', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key=$1`, [req.params.key]);
    let v = rows.length ? rows[0].value : null;
    try { v = JSON.parse(v); } catch (_) {}
    res.json({ value: v });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const v = JSON.stringify(req.body && req.body.value);
    await pool.query(
      `INSERT INTO settings(key,value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [req.params.key, v]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// health-check
app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';   // обязательно для Railway — слушать на всех интерфейсах

// Сначала поднимаем сервер (чтобы Railway сразу получал ответ),
// затем в фоне инициализируем схему БД.
app.listen(PORT, HOST, () => {
  console.log('✓ Сервер запущен на ' + HOST + ':' + PORT);
  initSchema()
    .then(() => console.log('✓ Схема БД готова'))
    .catch(err => console.error('⚠ Ошибка инициализации БД (сервер работает, проверьте DATABASE_URL):', err));
});
