# WatermarkPro

Платформа для нанесения водяных знаков на видео и безопасного HLS-стриминга. Предназначена для кинопроизводства — позволяет загружать видео, накладывать персонализированные водяные знаки с именем клиента и таймкодом, а затем безопасно просматривать через браузер.

## Возможности

- **Загрузка видео** — drag-and-drop или выбор файла, поддержка любых видеоформатов
- **Водяной знак** — имя клиента по центру кадра (полупрозрачный текст)
- **Таймкод** — вшитый таймкод внизу кадра (формат 25fps)
- **HLS-стриминг** — сегментированное воспроизведение в браузере без возможности скачать
- **Прогресс в реальном времени** — отслеживание статуса обработки с процентами
- **Ссылка для просмотра** — уникальный URL для каждого обработанного видео

## Технологии

| Компонент | Стек |
|-----------|------|
| Frontend | React 18, Vanilla CSS |
| Backend | FastAPI, Python 3.12, Pydantic |
| Обработка видео | FFmpeg, FFprobe |
| Очередь/кэш | Redis 7 |
| Прокси | Nginx |
| Инфраструктура | Docker, Docker Compose |
| Плеер | HLS.js |

## Быстрый старт

```bash
git clone https://github.com/H1ts/WatermarkPro.git
cd WatermarkPro
docker compose up --build -d
```

Откройте http://localhost в браузере.

## Деплой на VPS

```bash
# На сервере (Ubuntu/Debian), от root:
DOMAIN=your-server-ip bash deploy.sh
```

Или вручную:

```bash
echo "BASE_URL=http://your-server-ip" > .env
docker compose up --build -d
```

## Архитектура

```
Browser (React SPA)
  → Nginx (reverse proxy, port 80)
    → /          → Frontend (React)
    → /api/*     → FastAPI (upload, process, status)
    → /watch/*   → FastAPI (встроенный HLS-плеер)
    → /hls/*     → Статические HLS-сегменты
      ↓
    FastAPI → FFmpeg (watermark + timecode → MP4 → HLS)
           → Redis (статусы задач, метаданные)
```

## Сервисы

| Сервис | Порт | Описание |
|--------|------|----------|
| nginx | 80 | Реверс-прокси, раздача HLS-сегментов |
| api | 8000 | FastAPI бэкенд, обработка видео |
| frontend | — | React SPA (раздаётся через nginx) |
| redis | 6379 | Хранение статусов задач и метаданных |

## API

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/upload` | Загрузка видеофайла (multipart) |
| POST | `/process` | Запуск обработки `{ file_id, client_name }` |
| GET | `/status/{job_id}` | Статус и прогресс задачи (0–100%) |
| GET | `/watch/{job_id}` | Страница HLS-плеера |
| GET | `/health` | Проверка здоровья сервиса |

## Пайплайн обработки (FFmpeg)

1. **Водяной знак** — текст с именем клиента, по центру, 48px, прозрачность 30%
2. **Таймкод** — внизу по центру, 24px, прозрачность 70%, формат 25fps
3. **Кодирование** — H.264 (libx264, ultrafast) + AAC 128k → MP4
4. **HLS-сегментация** — codec copy, сегменты по 6 сек → .m3u8 + .ts

## Структура проекта

```
WatermarkPro/
├── frontend/          # React SPA
│   ├── src/
│   │   ├── App.js     # Основной компонент
│   │   └── App.css    # Стили (тёмная тема)
│   └── Dockerfile
├── backend/           # FastAPI сервер
│   └── app/
│       ├── main.py          # Эндпоинты API
│       ├── ffmpeg_worker.py # Обработка видео
│       ├── models.py        # Pydantic-модели
│       └── config.py        # Конфигурация
├── nginx/
│   └── nginx.conf     # Конфигурация прокси
├── docker-compose.yml
├── deploy.sh          # Скрипт деплоя на VPS
└── .env               # BASE_URL (создаётся при деплое)
```

## Полезные команды

```bash
# Логи всех сервисов
docker compose logs -f

# Логи конкретного сервиса
docker compose logs -f api

# Перезапуск
docker compose restart

# Остановка
docker compose down

# Пересборка после изменений
docker compose up --build -d --force-recreate
```
