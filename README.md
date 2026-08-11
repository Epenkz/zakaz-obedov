# 🍱 Заказ обедов — Node.js + PostgreSQL (Railway)

Веб-приложение для заказа обедов среди коллег. Новый аппетитный дизайн.
Бэкенд на **Node.js (Express)**, данные в **PostgreSQL**. Всё хостится на **Railway**.

## Что внутри
```
zakaz_obedov_railway/
├── server.js          # Express: раздаёт сайт + REST API
├── db.js              # подключение к PostgreSQL + автосоздание таблиц
├── schema.sql         # нормализованные таблицы (dishes, orders, order_items, settings)
├── package.json       # зависимости: express, pg
├── public/
│   └── index.html     # сайт (новый дизайн) — обращается к своему /api
├── .env.example
├── .gitignore
└── README.md
```

## Как это работает
- **Меню** (`dishes`, поле `is_active`) — какие блюда доступны сегодня.
- **Справочник блюд** — все блюда; новые добавляются прямо из админки (кнопки «➕ Добавить»),
  сохраняются в базу и видны всем. Код менять больше не нужно.
- **Заказы** (`orders` + `order_items`) — кто и что заказал, с суммой.
- **Настройки** (`settings`) — например, «держать приём открытым».

Цены: основное блюдо 1000 ₸, выпечка 700 ₸. У блюда можно задать особую цену при добавлении.
Пин-код админки: **1982** (задаётся в `public/index.html`, переменная `ADMIN_PIN`).

---

## 🚀 Деплой на Railway (через GitHub) — по шагам

### Шаг 1. Залить проект в GitHub
1. Создайте новый репозиторий на GitHub (например `zakaz-obedov`).
2. Загрузите в него **всё содержимое** этой папки (`server.js`, `db.js`, `schema.sql`,
   `package.json`, папку `public/` и т.д.).
   - Через сайт GitHub: «Add file» → «Upload files» → перетащите все файлы.
   - Или через git:
     ```bash
     git init
     git add .
     git commit -m "Заказ обедов на Node.js + Postgres"
     git branch -M main
     git remote add origin https://github.com/Epenkz/zakaz-obedov.git
     git push -u origin main
     ```

### Шаг 2. Создать проект на Railway
1. Зайдите на **railway.app** → войдите через GitHub.
2. **New Project** → **Deploy from GitHub repo** → выберите репозиторий `zakaz-obedov`.
3. Railway сам увидит `package.json`, выполнит `npm install` и запустит `npm start`.

### Шаг 3. Добавить базу PostgreSQL
1. В проекте нажмите **New** → **Database** → **Add PostgreSQL**.
2. Railway автоматически создаст переменную **`DATABASE_URL`** и свяжет её с приложением.
   > Ничего вручную вписывать не нужно — код сам прочитает `DATABASE_URL` и создаст таблицы при старте.

### Шаг 4. Открыть сайт
1. Откройте сервис приложения → вкладка **Settings** → раздел **Networking** →
   **Generate Domain** (создастся адрес вида `zakaz-obedov-production.up.railway.app`).
2. Перейдите по этому адресу — сайт готов. Таблицы создаются автоматически при первом запуске.

### Шаг 5. Первое наполнение меню
1. Откройте сайт → нажмите «🔒 Администратор» → введите пин **1982**.
2. В блоке «Меню на сегодня» добавьте блюда кнопками «➕ Добавить блюдо / выпечку».
3. Отметьте галочками доступные сегодня → «Сохранить меню на сегодня».
4. Коллеги открывают сайт и заказывают. Сводка для повара — в админке.

---

## Локальный запуск (по желанию)
```bash
npm install
# создайте .env со строкой DATABASE_URL к локальному Postgres
npm start
# откройте http://localhost:3000
```

## REST API (кратко)
| Метод | Путь | Назначение |
|-------|------|-----------|
| GET   | `/api/menu` | активные блюда `{mains, bakes}` |
| PUT   | `/api/menu` | сохранить меню на сегодня |
| GET   | `/api/dishes/:kind` | справочник блюд (`main`/`bake`) |
| POST  | `/api/dishes/:kind` | добавить новое блюдо `{title, price}` |
| GET   | `/api/orders` | список заказов |
| POST  | `/api/orders` | добавить заказ |
| DELETE| `/api/orders` | удалить все заказы |
| GET/PUT | `/api/settings/:key` | настройки (напр. `forceOpen`) |

## Настройки, которые можно поменять
- **Пин-код админки** — `public/index.html`, `var ADMIN_PIN = '1982';`
- **Kaspi QR** — `public/index.html`, `var KASPI_URL = '...';` и картинка QR внутри страницы.
- **Время закрытия приёма** — функции `closeMin()` / `closeLabel()` (сейчас 11:30).
- **Базовые цены** — `MAIN_PRICE` / `BAKE_PRICE` в `public/index.html` и в `server.js`.
