#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────
# add-subdomain.sh — Scaffold a new subdomain
# Usage: bash scripts/add-subdomain.sh <name>
# Example: bash scripts/add-subdomain.sh staging
# ──────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
  echo "Usage: $0 <subdomain-name>"
  echo "Example: $0 staging"
  exit 1
fi

NAME="$1"
DOMAIN="${NAME}.leadsadv.com"
DB_NAME="ad_booking_${NAME}"

echo "==> Creating subdomain: ${DOMAIN}"

# 1. Create nginx config
NGINX_CONF="nginx/conf.d/${NAME}.conf"
if [ -f "$NGINX_CONF" ]; then
  echo "Nginx config already exists: $NGINX_CONF"
else
  sed "s/app\.leads\.com/${DOMAIN}/g; s/backend-app/backend-${NAME}/g; s/frontend-app/frontend-${NAME}/g" \
    nginx/conf.d/app.conf > "$NGINX_CONF"
  echo "Created $NGINX_CONF"
fi

# 2. Create env file
ENV_FILE=".env.${NAME}"
if [ -f "$ENV_FILE" ]; then
  echo "Env file already exists: $ENV_FILE"
else
  JWT_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
# Backend env for ${DOMAIN}
JWT_SECRET=${JWT_SECRET}
JWT_ALGORITHM=HS256
JWT_EXPIRATION_MINUTES=1440

CORS_ORIGINS=https://${DOMAIN}

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SES_REGION=eu-west-1
SES_SENDER_EMAIL=
ADMIN_EMAIL=
EOF
  echo "Created $ENV_FILE"
fi

# 3. Create database
echo "Creating database ${DB_NAME}..."
docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" \
  -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Print manual steps
echo ""
echo "==> Next steps (manual):"
echo ""
echo "1. Add these services to docker-compose.yml:"
echo ""
echo "  backend-${NAME}:"
echo "    build: ./backend"
echo "    restart: unless-stopped"
echo "    env_file:"
echo "      - .env.shared"
echo "      - .env.${NAME}"
echo "    environment:"
echo "      DATABASE_URL: mysql+pymysql://root:\${MYSQL_ROOT_PASSWORD}@mysql:3306/${DB_NAME}"
echo "    volumes:"
echo "      - uploads_${NAME}:/app/uploads"
echo "    depends_on:"
echo "      mysql:"
echo "        condition: service_healthy"
echo ""
echo "  frontend-${NAME}:"
echo "    build:"
echo "      context: ./frontend"
echo "      args:"
echo "        VITE_API_URL: https://${DOMAIN}/api"
echo "    restart: unless-stopped"
echo ""
echo "2. Add volume 'uploads_${NAME}:' to the volumes section"
echo ""
echo "3. Add 'frontend-${NAME}' and 'backend-${NAME}' to nginx depends_on"
echo ""
echo "4. Run migrations:"
echo "   docker compose run --rm -e DATABASE_URL=mysql+pymysql://root:\${MYSQL_ROOT_PASSWORD}@mysql:3306/${DB_NAME} backend-${NAME} alembic upgrade head"
echo ""
echo "5. Get SSL certificate:"
echo "   docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}"
echo ""
echo "6. Rebuild and restart:"
echo "   docker compose up -d --build"
