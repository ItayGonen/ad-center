#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────
# deploy.sh — EC2 deployment helper
# Usage: bash scripts/deploy.sh
# ──────────────────────────────────────────────────────

echo "==> Step 1: Install Docker & Docker Compose (if missing)"
if ! command -v docker &>/dev/null; then
  sudo yum update -y || sudo apt-get update -y
  sudo yum install -y docker || sudo apt-get install -y docker.io
  sudo systemctl enable docker && sudo systemctl start docker
  sudo usermod -aG docker "$USER"
  echo "Docker installed. You may need to log out and back in for group changes."
fi

if ! command -v docker compose &>/dev/null; then
  # Install Docker Compose plugin
  DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
  mkdir -p "$DOCKER_CONFIG/cli-plugins"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
  chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
  echo "Docker Compose installed."
fi

echo "==> Step 2: Build images"
docker compose build

echo "==> Step 3: Start MySQL and wait for it to be healthy"
docker compose up -d mysql
echo "Waiting for MySQL..."
until docker compose exec mysql mysqladmin ping -h localhost --silent; do
  sleep 2
done
echo "MySQL is ready."

echo "==> Step 4: Run Alembic migrations for each subdomain"
docker compose run --rm \
  -e DATABASE_URL="mysql+pymysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/ad_booking_app" \
  backend-app alembic upgrade head

docker compose run --rm \
  -e DATABASE_URL="mysql+pymysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/ad_booking_demo" \
  backend-demo alembic upgrade head

echo "==> Step 5: Obtain SSL certificates (first time only)"
for DOMAIN in app.leadsadv.com demo.leadsadv.com; do
  if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "Getting certificate for $DOMAIN..."
    docker compose run --rm certbot certonly \
      --webroot -w /var/www/certbot \
      --email admin@leadsadv.com --agree-tos --no-eff-email \
      -d "$DOMAIN"
  else
    echo "Certificate for $DOMAIN already exists, skipping."
  fi
done

echo "==> Step 6: Start all services"
docker compose up -d

echo "==> Done! Verifying..."
docker compose ps
echo ""
echo "Test with:"
echo "  curl https://app.leadsadv.com/api/health"
echo "  curl https://demo.leadsadv.com/api/health"
