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

// ======================================================
//  АРХИВ и АВТООЧИСТКА заказов
// ======================================================
// Перенести все текущие заказы в архив и очистить orders.
async function archiveAndClean(orderDate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: ords } = await client.query(
      `SELECT id, customer, client_id, total, paid, note, created_at FROM orders`);
    for (const o of ords) {
      const { rows: a } = await client.query(
        `INSERT INTO orders_archive(orig_id, customer, client_id, total, paid, note, order_date, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [o.id, o.customer, o.client_id, o.total, o.paid, o.note, orderDate, o.created_at]);
      const aid = a[0].id;
      const { rows: items } = await client.query(
        `SELECT title, kind, qty, price FROM order_items WHERE order_id=$1`, [o.id]);
      for (const it of items) {
        await client.query(
          `INSERT INTO order_items_archive(archive_id, title, kind, qty, price) VALUES ($1,$2,$3,$4,$5)`,
          [aid, it.title, it.kind, it.qty, it.price]);
      }
    }
    await client.query(`DELETE FROM orders`);
    await client.query('COMMIT');
    return ords.length;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}

// Проверка: не пора ли автоочистить (наступил новый день и прошёл час autoCleanHour)
async function maybeAutoClean() {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('autoCleanHour','lastClean')`);
    const map = {}; rows.forEach(r => map[r.key] = r.value);
    const hour = parseInt(map.autoCleanHour, 10);
    const lastClean = map.lastClean || '';
    const today = todayISO();
    const now = new Date();
    // чистим, если сегодня ещё не чистили И текущее время >= час автоочистки
    if (lastClean !== today && now.getHours() >= (isNaN(hour) ? 4 : hour)) {
      // архивируем заказы под ВЧЕРАШНЕЙ датой (это заказы прошлого дня)
      const y = new Date(now.getTime() - 24*3600*1000);
      const yISO = y.getFullYear() + '-' + ('0'+(y.getMonth()+1)).slice(-2) + '-' + ('0'+y.getDate()).slice(-2);
      const n = await archiveAndClean(yISO);
      await pool.query(
        `INSERT INTO settings(key,value) VALUES ('lastClean',$1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [today]);
      if (n > 0) console.log('✓ Автоочистка: заархивировано и очищено заказов: ' + n);
    }
  } catch (e) { console.error('⚠ Автоочистка:', e); }
}

// Список дней в архиве
app.get('/api/archive/days', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT order_date, COUNT(*)::int AS orders, COALESCE(SUM(total),0)::int AS sum
       FROM orders_archive GROUP BY order_date ORDER BY order_date DESC LIMIT 60`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Заказы за конкретный день из архива
app.get('/api/archive/:date', async (req, res) => {
  try {
    const { rows: ords } = await pool.query(
      `SELECT id, customer, client_id, total, paid, note FROM orders_archive WHERE order_date=$1 ORDER BY id`,
      [req.params.date]);
    const { rows: items } = await pool.query(
      `SELECT oia.archive_id, oia.title, oia.kind, oia.qty, oia.price
       FROM order_items_archive oia JOIN orders_archive oa ON oa.id=oia.archive_id
       WHERE oa.order_date=$1`, [req.params.date]);
    const byId = {};
    items.forEach(it => { (byId[it.archive_id] = byId[it.archive_id] || []).push(
      { title: it.title, cat: it.kind, qty: it.qty, price: it.price }); });
    res.json(ords.map(o => ({ name: o.customer, cid: o.client_id, sum: o.total, paid: o.paid,
      note: o.note || '', items: byId[o.id] || [] })));
  } catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
});

// Ручной запуск архивации+очистки (кнопка в админке «Архивировать и очистить»)
app.post('/api/archive-now', async (req, res) => {
  try { const n = await archiveAndClean(todayISO()); res.json({ ok: true, archived: n }); }
  catch (e) { console.error(e); res.status(500).json({ error: String(e) }); }
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
    .then(() => {
      console.log('✓ Схема БД готова');
      maybeAutoClean();                        // проверка при старте
      setInterval(maybeAutoClean, 30*60*1000); // и каждые 30 минут
    })
    .catch(err => console.error('⚠ Ошибка инициализации БД (сервер работает, проверьте DATABASE_URL):', err));
});
