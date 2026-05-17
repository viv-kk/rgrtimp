# Event Security MVP

Минимальная учебная система для РГР:
- сотрудники (`admin`, `cashier`);
- `admin`: управление мероприятиями и аудит системы;
- `admin`: управление площадками, мероприятиями и аудит системы;
- вкладки админа: отдельные разделы "Управление площадками" и "Управление мероприятиями";
- `cashier`: продажа билетов и контроль входа;
- создание мероприятий;
- создание площадок;
- редактирование и удаление площадок;
- выбор площадки при создании мероприятия;
- редактирование и удаление мероприятий;
- продажа билета;
- покупка нескольких билетов за одну операцию;
- карта/схема мест с выбором мест;
- генерация PNG QR-кода билета;
- скачивание QR-кода билета в PNG;
- отправка оформленного PDF-билета на email (SMTP);
- аналитика мероприятия (продано/прошло/не пришло/отказы/повторные QR);
- короткий 8-значный код билета для ручного ввода на входе;
- access-token + refresh-token авторизация с автообновлением сессии;
- ограничение попыток логина (lockout после серии ошибок);
- контроль входа со сканированием QR через камеру;
- контроль входа по загруженному изображению QR (PNG/JPG);
- вход по одноразовому QR token;
- блокировка повторного прохода.

## 1) Запуск PostgreSQL

```bash
sudo docker compose up -d
```

## 2) Запуск backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API: `http://127.0.0.1:8000`  
Swagger: `http://127.0.0.1:8000/docs`

Админ создается из переменных окружения:
- `ADMIN_USERNAME` (по умолчанию `admin`)
- `ADMIN_PASSWORD` (по умолчанию `ChangeMe_Admin_Password_123!`, обязательно поменяй)

Кассиры не создаются автоматически: они отправляют заявку на странице регистрации, а админ подтверждает ее во вкладке `Заявки кассиров`.

### Настройка Gmail SMTP (опционально)

В `backend/.env` укажи:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=v1ta.1i20o60@gmail.com
SMTP_PASSWORD=google_app_password
SMTP_FROM=v1ta.1i20o60@gmail.com
SMTP_USE_TLS=true
REFRESH_TOKEN_EXPIRE_DAYS=14
MAX_FAILED_LOGIN_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_admin_password
```

`SMTP_PASSWORD` — это пароль приложения Google (App Password), не обычный пароль от аккаунта.

## 3) Запуск frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

Для frontend можно создать `frontend/.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

## Базовый сценарий проверки

1. Войти как `admin`.
2. Создать мероприятие.
3. Продать билет (получить `QR Token`).
4. Вставить этот token в блок "Контроль входа" и проверить:
   - первый раз: `Проход разрешен`;
   - второй раз: `Этот QR уже был использован`.

## Деплой: Vercel + Render

Подготовка в репозитории уже сделана:
- `render.yaml` в корне (blueprint для backend + PostgreSQL на Render);
- `frontend/vercel.json` (rewrites для SPA на Vercel);
- `frontend/.env.example` с `VITE_API_URL`.

### Вариант 1 (рекомендуемый): frontend на Vercel, backend+DB на Render

1) **Render (backend + DB)**
- В Render открой `New +` -> `Blueprint`.
- Подключи репозиторий и выбери ветку проекта.
- Render подхватит `render.yaml` и создаст:
  - PostgreSQL `event-security-db`,
  - Web Service `event-security-backend`.
- В процессе создания задай обязательно:
  - `ADMIN_PASSWORD` (сильный),
  - SMTP переменные (если нужна отправка билетов на почту).
- После деплоя получишь URL backend вида `https://<service>.onrender.com`.

2) **Vercel (frontend)**
- В Vercel: `Add New Project` -> импортируй этот репозиторий.
- Root Directory выбери: `frontend`.
- Framework: Vite (подхватится автоматически).
- Environment Variable:
  - `VITE_API_URL=https://<your-render-backend>.onrender.com`
- Deploy.

### Вариант 2: всё на Render
- Backend и PostgreSQL как в варианте выше.
- Frontend как `Static Site` на Render:
  - Build Command: `npm install && npm run build`
  - Publish Directory: `dist`
  - Env: `VITE_API_URL=https://<your-render-backend>.onrender.com`

## Безопасность перед публикацией
- Обязательно задай свои `ADMIN_PASSWORD` и `JWT_SECRET` в проде.
- Не храни реальные пароли в репозитории, только в env-переменных платформы.
- Включи HTTPS (на Vercel/Render он есть по умолчанию).
- После публикации в FastAPI CORS лучше ограничить только доменом frontend (а не `*`).
