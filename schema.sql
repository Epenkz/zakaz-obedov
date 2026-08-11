-- ============================================================
--  Схема базы данных «Заказ обедов»  (PostgreSQL / Railway)
--  Нормализованные таблицы
-- ============================================================

-- Справочник блюд (базовые + добавленные из админки).
-- kind: 'main' (основное) | 'bake' (выпечка)
-- price: NULL => берётся цена по умолчанию (main=1000, bake=700)
CREATE TABLE IF NOT EXISTS dishes (
  id          SERIAL PRIMARY KEY,
  title       TEXT        NOT NULL,
  kind        TEXT        NOT NULL CHECK (kind IN ('main','bake')),
  price       INTEGER,                       -- особая цена, ₸ (NULL = по умолчанию)
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,   -- отмечено ли в «меню на сегодня»
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title, kind)
);

-- Заказы коллег
CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  customer    TEXT        NOT NULL,          -- имя заказавшего
  client_id   TEXT,                          -- анонимный id устройства (cid)
  total       INTEGER     NOT NULL DEFAULT 0, -- сумма заказа, ₸
  paid        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Позиции внутри заказа
CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  kind        TEXT        NOT NULL CHECK (kind IN ('main','bake')),
  qty         INTEGER     NOT NULL CHECK (qty > 0),
  price       INTEGER     NOT NULL           -- цена за единицу на момент заказа, ₸
);

-- Настройки (ключ-значение): например forceOpen
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at);

-- Комментарий к заказу (без лука, поострее и т.п.) — добавляется безопасно
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT;

-- Архив заказов (для истории по дням) — сюда переносятся заказы при автоочистке
CREATE TABLE IF NOT EXISTS orders_archive (
  id          SERIAL PRIMARY KEY,
  orig_id     INTEGER,
  customer    TEXT,
  client_id   TEXT,
  total       INTEGER     NOT NULL DEFAULT 0,
  paid        BOOLEAN     NOT NULL DEFAULT TRUE,
  note        TEXT,
  order_date  DATE,                          -- дата, за которую был заказ
  created_at  TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items_archive (
  id             SERIAL PRIMARY KEY,
  archive_id     INTEGER NOT NULL REFERENCES orders_archive(id) ON DELETE CASCADE,
  title          TEXT,
  kind           TEXT,
  qty            INTEGER,
  price          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_arch_date ON orders_archive(order_date);

-- Значение по умолчанию для приёма заказов после 11:30
INSERT INTO settings(key, value) VALUES ('forceOpen', 'false')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings(key, value) VALUES ('bakeClose', '630')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings(key, value) VALUES ('autoCleanHour', '4')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings(key, value) VALUES ('lastClean', '')
  ON CONFLICT (key) DO NOTHING;
