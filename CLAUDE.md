# WatermarkPro — контекст для Claude

## Что это
Платформа для нанесения водяных знаков на видео и HLS-стриминга для кинопродакшена.
PRD: `WatermarkPro_PRD.docx` в корне репозитория.

## Текущий стек
- Frontend: React 18, vanilla CSS, тёмная тема
- Backend: FastAPI, Python 3.12, FFmpeg
- Очередь: Redis 7
- Прокси: Nginx
- Инфраструктура: Docker Compose
- Плеер: HLS.js

## Что уже реализовано (MVP частично)
- [x] Drag & drop загрузка видео (базовая, без tus)
- [x] Текстовый watermark (ФИО клиента, центр кадра, 30% прозрачность)
- [x] Burn-in таймкод (низ кадра, 25fps)
- [x] MP4 FAST рендер (H.264 ultrafast + AAC)
- [x] HLS стриминг (базовый, без ABR)
- [x] HLS-плеер с защитой от правого клика
- [x] Прогресс обработки (polling каждую секунду)
- [x] Docker Compose деплой (4 сервиса: nginx, api, frontend, redis)
- [x] Скрипт деплоя на VPS (deploy.sh)
- [x] BASE_URL через .env
- [x] README на русском

## Что НЕ реализовано (по PRD, в порядке приоритета)
- [ ] Signed URLs + TTL + лимит просмотров (P0)
- [ ] Настройки watermark — позиция, прозрачность, тип (P0)
- [ ] Лого watermark — overlay PNG (P1)
- [ ] ABR HLS — адаптивный битрейт 360p/720p/1080p (P0)
- [ ] PostgreSQL для метаданных (P0)
- [ ] Авторизация / magic link (P0)
- [ ] WebSocket прогресс вместо polling (P1)
- [ ] tus protocol — резюмируемая загрузка (P0)
- [ ] MP4 HQ рендер (slow preset) (P1)
- [ ] Пакетная загрузка (P1)
- [ ] Проекты (P1)
- [ ] Аналитика просмотров (P1)
- [ ] Оплата ЮКасса/Stripe (P1)

## VPS
- IP: 85.198.84.222 (Beget)
- Путь: /opt/watermarkpro
- .env: BASE_URL=http://85.198.84.222

## Ключевые файлы
- `backend/app/main.py` — API эндпоинты
- `backend/app/ffmpeg_worker.py` — обработка видео
- `backend/app/models.py` — Pydantic модели
- `backend/app/config.py` — конфигурация
- `frontend/src/App.js` — основной React компонент
- `frontend/src/App.css` — стили
- `nginx/nginx.conf` — конфигурация прокси
- `docker-compose.yml` — оркестрация сервисов
- `deploy.sh` — деплой на VPS

## Ветки
- `main` — основная ветка
- Для работы Claude создавать ветку `claude/*`
