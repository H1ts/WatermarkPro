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
- Frontend: React 18, vanilla CSS, тёмная тема
- Backend: FastAPI, Python 3.12, FFmpeg
- Очередь/кэш: Redis 7
- Прокси: Nginx
- Инфраструктура: Docker Compose (4 сервиса: nginx, api, frontend, redis)
- Плеер: HLS.js

## Текущий этап: MVP (частично готов)

### Готово
- [x] Drag & drop загрузка видео (базовая, без tus)
- [x] Текстовый watermark (ФИО клиента, центр кадра, 30% прозрачность)
- [x] Burn-in таймкод (низ кадра, 25fps)
- [x] MP4 FAST рендер (H.264 ultrafast + AAC)
- [x] HLS стриминг (базовый, без ABR)
- [x] HLS-плеер с защитой от правого клика
- [x] Прогресс обработки (polling каждую секунду)
- [x] Docker Compose деплой
- [x] Скрипт деплоя на VPS (deploy.sh)
- [x] BASE_URL через .env
- [x] README на русском
- [x] CLAUDE.md для сохранения контекста

### Не готово — MVP P0 (критичные для запуска)
- [ ] Signed URLs + TTL + лимит просмотров — защита ссылок от скачивания
- [x] Настройки watermark — позиция (6 вариантов), прозрачность (20-80%), размер шрифта (16-120px)
- [ ] ABR HLS — адаптивный битрейт 360p/720p/1080p (сейчас только одно качество)
- [ ] PostgreSQL — для метаданных вместо Redis (users, projects, files, outputs, links, view_logs)
- [ ] Авторизация / magic link — аккаунты для загрузки (просмотр остаётся без регистрации)
- [ ] tus protocol — резюмируемая загрузка для больших файлов (до 50 GB)

### Не готово — MVP P1 (важные, но не блокируют запуск)
- [x] Лого watermark — overlay PNG/JPG/WebP поверх видео (до 5 МБ, масштаб 15% ширины)
- [ ] MP4 HQ рендер (slow preset, CRF 18)
- [ ] WebSocket прогресс вместо polling
- [ ] Пакетная загрузка нескольких файлов
- [ ] Проекты — группировка файлов
- [ ] Аналитика просмотров
- [ ] Оплата ЮКасса/Stripe

### Будущее — v2.0
- [ ] Review & Comments (таймкодовые комментарии)
- [ ] Approval workflow
- [ ] API для интеграций (Resolve / Premiere)
- [ ] White-label для рентал-хаусов
- [ ] Telegram-бот (уведомления о рендере)
- [ ] NVENC / GPU ускорение

## Деплой — VPS
- IP: 85.198.84.222 (Beget)
- Путь на сервере: /opt/watermarkpro
- .env: BASE_URL=http://85.198.84.222
- Статус: деплой начат, нужно дописать .env и запустить docker compose

## Ключевые файлы
- `backend/app/main.py` — API эндпоинты (upload, process, status, watch, health)
- `backend/app/ffmpeg_worker.py` — обработка видео (watermark → MP4 → HLS)
- `backend/app/models.py` — Pydantic модели (ProcessRequest, JobStatus, JobInfo)
- `backend/app/config.py` — конфигурация (dirs, redis, base_url)
- `frontend/src/App.js` — основной React компонент (upload, progress, result)
- `frontend/src/App.css` — стили (тёмная тема, gradient purple)
- `nginx/nginx.conf` — маршруты: / → frontend, /api → backend, /hls → статика
- `docker-compose.yml` — оркестрация 4 сервисов
- `deploy.sh` — автоматический деплой на Ubuntu/Debian VPS

## Правила для Claude
- Ветка для работы: создавать `claude/*` от main
- После каждой итерации обновлять этот файл CLAUDE.md
- PRD лежит в `WatermarkPro_PRD.docx` — сверяться с ним при реализации фич
- Язык интерфейса и документации: русский
