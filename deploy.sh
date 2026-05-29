#!/bin/bash
# TokTik C2 Deploy Script
# Run from inside the cloned repo directory: bash deploy.sh

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== TokTik C2 Deploy ==="
echo "App directory: $APP_DIR"

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Install system deps for Playwright
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Install server deps
echo "Installing server dependencies..."
cd "$APP_DIR/server"
npm install
npx playwright install chromium
npx playwright install-deps chromium

# Install frontend deps and build
echo "Building frontend..."
cd "$APP_DIR/frontend"
npm install
npx vite build

# Create .env if not exists
if [ ! -f "$APP_DIR/server/.env" ]; then
  echo "Creating .env from example..."
  cp "$APP_DIR/server/.env.example" "$APP_DIR/server/.env"
  echo ""
  echo "⚠️  EDIT $APP_DIR/server/.env with your Supabase credentials!"
  echo ""
fi

# Install nginx config (update paths in config first)
echo "Setting up nginx..."
sed "s|/opt/c2|$APP_DIR|g" "$APP_DIR/nginx.conf" | sudo tee /etc/nginx/sites-available/c2 > /dev/null
sudo ln -sf /etc/nginx/sites-available/c2 /etc/nginx/sites-enabled/c2
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Create systemd service (update paths)
echo "Setting up systemd service..."
sed "s|/opt/c2|$APP_DIR|g" "$APP_DIR/c2.service" | sudo tee /etc/systemd/system/c2.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable c2
sudo systemctl restart c2

# SSL cert
echo "Getting SSL certificate..."
sudo certbot --nginx -d c2.effortlessmetaphor.org --non-interactive --agree-tos --email admin@effortlessmetaphor.org || true

echo ""
echo "=== Deploy Complete ==="
echo "App: https://c2.effortlessmetaphor.org"
echo "Service: sudo systemctl status c2"
echo "Logs: sudo journalctl -u c2 -f"
echo ""
echo "Don't forget to:"
echo "1. Edit $APP_DIR/server/.env with Supabase creds"
echo "2. Point DNS A record for c2.effortlessmetaphor.org → 192.175.22.236"
echo "3. Run migrations in Supabase SQL editor"
