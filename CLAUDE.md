# WatermarkPro — контекст для Claude

## О проекте
WatermarkPro — веб-платформа для кинопродакшена. Позволяет загрузить видеофайл,
автоматически наложить персонализированный водяной знак (ФИО клиента + таймкод)
и выдать защищённую ссылку для просмотра через HLS-стриминг без возможности скачивания.

**Целевая аудитория:** операторы, постпродакшен, продакшен-компании, рентал-хаусы в РФ.
**Конкуренты:** Frame.io, Kollaborate (дорого, недоступны из РФ). Google/Яндекс.Диск (нет watermark).
**Бизнес-модель:** Free / Pro (990 руб/мес) / Studio (2990 руб/мес) / Enterprise.

PRD: `WatermarkPro_PRD.docx` в корне репозитория — полная спецификация продукта.

## Текущий стек
- Frontend: React 18, React Router 6, vanilla CSS, тёмная тема
- Backend: FastAPI, Python 3.12, FFmpeg
- Очередь/кэш: Redis 7
- Прокси: Nginx
- Инфраструктура: Docker Compose (4 сервиса: nginx, api, frontend, redis)
- Плеер: HLS.js

## Текущий этап: MVP (почти готов)

### Готово
- [x] Drag & drop загрузка видео (базовая, без tus)
- [x] Текстовый watermark (ФИО клиента, настраиваемая позиция/прозрачность/размер)
- [x] Настройки watermark — позиция (drag на превью), прозрачность (20-80%), размер шрифта (16-120px)
- [x] Лого watermark — overlay PNG/JPG/WebP поверх видео (до 5 МБ, масштаб 10-50%)
- [x] Burn-in таймкод (верх кадра, 36px, автоопределение FPS)
- [x] 3 пресета качества — low (ultrafast/CRF 28), medium (medium/CRF 23), high (slow/CRF 18)
- [x] MP4 + MOV форматы вывода
- [x] Скачивание готового файла (MP4/MOV)
- [x] HLS стриминг (базовый, без ABR)
- [x] HLS-плеер с защитой от правого клика
- [x] Прогресс обработки (polling каждую секунду)
- [x] Проекты — группировка файлов (Dashboard → Project → Upload)
- [x] Review & Comments — таймкодовые комментарии с аннотациями на видео
  - HLS-плеер с кастомным таймлайном и маркерами комментариев
  - Рисование поверх кадра (карандаш, стрелка, круг, прямоугольник)
  - 5 цветов аннотаций, undo
  - Resolve/Delete комментариев
  - Клавиатура: Space (play/pause), Escape (отмена)
- [x] Docker Compose деплой (4 сервиса: nginx, api, frontend, redis)
- [x] Скрипт деплоя на VPS (deploy.sh)
- [x] BASE_URL через .env
- [x] README на русском
- [x] CLAUDE.md для сохранения контекста

### Не готово — MVP P0 (критичные для запуска)
- [ ] Signed URLs + TTL + лимит просмотров — защита ссылок от скачивания
- [ ] ABR HLS — адаптивный битрейт 360p/720p/1080p (сейчас только одно качество)
- [ ] PostgreSQL — для метаданных вместо Redis (users, projects, files, outputs, links, view_logs)
- [ ] Авторизация / magic link — аккаунты для загрузки (просмотр остаётся без регистрации)
- [ ] tus protocol — резюмируемая загрузка для больших файлов (до 50 GB)

### Не готово — MVP P1 (важные, но не блокируют запуск)
- [ ] WebSocket прогресс вместо polling
- [ ] Пакетная загрузка нескольких файлов
- [ ] Аналитика просмотров
- [ ] Оплата ЮКасса/Stripe

### Будущее — v2.0
- [ ] Approval workflow (на базе готовой системы комментариев)
- [ ] API для интеграций (Resolve / Premiere)
- [ ] White-label для рентал-хаусов
- [ ] Telegram-бот (уведомления о рендере)
- [ ] NVENC / GPU ускорение

## Деплой — VPS
- IP: 85.198.84.222 (Beget)
- Путь на сервере: /opt/watermarkpro
- .env: BASE_URL=http://85.198.84.222
- Статус: задеплоен, все 4 контейнера Up, сайт доступен

## Последняя сессия — 2026-02-25

### Что сделано (сессия 3)
- **Review & Comments** — полная система рецензирования (аналог Frame.io)
  - ReviewPage: HLS-плеер + canvas overlay для аннотаций
  - Инструменты рисования: карандаш, стрелка, круг, прямоугольник + 5 цветов
  - Комментарии привязаны к таймкоду, маркеры на таймлайне
  - Backend: CRUD API для комментариев (POST/GET/PATCH/DELETE /comments)
  - Resolve/Delete, undo, клавиатурные сокращения
- **Лого watermark** — загрузка PNG/JPG/WebP, масштаб 10-50%, overlay через FFmpeg
- **3 пресета качества** — low/medium/high (ultrafast→slow, CRF 28→18)
- **MOV формат** — выбор между MP4 и MOV
- **Скачивание** — кнопка скачивания готового файла
- Обновлены README и CLAUDE.md
- Ветка: `claude/resume-work-i300F`

### Что сделано (сессия 2)
- **Проекты** — полная реализация структуры с проектами
  - Dashboard: список проектов + кнопка «Новый проект» + модалка создания
  - Внутри проекта: форма загрузки видео + настройки watermark + история файлов
  - Backend: CRUD API для проектов (POST/GET/DELETE /projects)
  - React Router 6 для навигации (/ → Dashboard, /projects/:id → ProjectPage)
  - SPA routing через nginx (try_files → index.html)
  - Интерфейс переведён на русский

### Что сделано (сессия 1) — 2026-02-24
- Таймкод перенесён с низа на верх кадра, размер увеличен с 24px до 36px
- В превью добавлен таймкод — теперь превью соответствует реальному рендеру

### Приоритеты на следующую сессию
1. **Signed URLs + TTL + лимит просмотров** — защита ссылок, ядро продукта
2. **ABR HLS (360p/720p/1080p)** — адаптивный битрейт для разных скоростей
3. **PostgreSQL** — миграция метаданных с Redis на нормальную БД

## Ключевые файлы
- `backend/app/main.py` — API эндпоинты (projects, upload, process, status, watch, comments, download)
- `backend/app/ffmpeg_worker.py` — обработка видео (watermark + logo → MP4/MOV → HLS)
- `backend/app/models.py` — Pydantic модели (ProcessRequest, JobInfo, ProjectInfo, ProjectDetail, CommentInfo и др.)
- `backend/app/config.py` — конфигурация (dirs, redis, base_url)
- `frontend/src/App.js` — роутер (Dashboard, ProjectPage, ReviewPage)
- `frontend/src/Dashboard.js` — список проектов, модалка создания
- `frontend/src/ProjectPage.js` — загрузка видео, настройки watermark/logo/quality/codec, история файлов
- `frontend/src/ReviewPage.js` — рецензирование: HLS-плеер, canvas-аннотации, комментарии, таймлайн
- `frontend/src/App.css` — стили (тёмная тема, gradient purple)
- `frontend/nginx.conf` — SPA routing (try_files → index.html)
- `nginx/nginx.conf` — маршруты: / → frontend, /api → backend, /hls → статика
- `docker-compose.yml` — оркестрация 4 сервисов
- `deploy.sh` — автоматический деплой на Ubuntu/Debian VPS

## Правила для Claude
- Ветка для работы: создавать `claude/*` от main
- После каждой итерации обновлять этот файл CLAUDE.md
- PRD лежит в `WatermarkPro_PRD.docx` — сверяться с ним при реализации фич
- Язык интерфейса и документации: русский
