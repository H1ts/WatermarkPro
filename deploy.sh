#!/bin/bash
# =============================================================
# WatermarkPro — скрипт деплоя на Beget VPS (Ubuntu/Debian)
# Запускайте от root:  bash deploy.sh
# =============================================================

set -euo pipefail

# ---------- Настройки (измените под себя) ----------
DOMAIN="${DOMAIN:-your-server-ip}"          # IP или домен вашего VPS
REPO="https://github.com/H1ts/WatermarkPro.git"
INSTALL_DIR="/opt/watermarkpro"
# ---------------------------------------------------

echo "=== 1/5  Обновляю систему ==="
apt-get update && apt-get upgrade -y

echo "=== 2/5  Устанавливаю Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    echo "Docker установлен"
else
    echo "Docker уже установлен"
fi

# Docker Compose plugin (v2)
if ! docker compose version &>/dev/null; then
    apt-get install -y docker-compose-plugin
fi

echo "=== 3/5  Клонирую репозиторий ==="
if [ -d "$INSTALL_DIR" ]; then
    echo "Директория уже существует, обновляю..."
    cd "$INSTALL_DIR"
    git pull origin main || git pull origin master || true
else
    git clone "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo "=== 4/5  Настраиваю переменные окружения ==="
# Создаём .env файл
cat > .env <<EOF
BASE_URL=http://${DOMAIN}
EOF

echo "BASE_URL=http://${DOMAIN}"

echo "=== 5/5  Запускаю сервисы ==="
docker compose down --remove-orphans 2>/dev/null || true
docker compose up --build -d

echo ""
echo "========================================="
echo "  WatermarkPro запущен!"
echo "  Откройте: http://${DOMAIN}"
echo "========================================="
echo ""
echo "Полезные команды:"
echo "  docker compose logs -f        — логи"
echo "  docker compose restart        — перезапуск"
echo "  docker compose down           — остановка"
