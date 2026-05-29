#!/bin/bash
# TokTik C2 Deploy Script
# Run this on your VPS: bash deploy.sh

set -e

echo "=== TokTik C2 Deploy ==="

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

# Clone or pull repo
if [ -d "/opt/c2" ]; then
  echo "Updating existing install..."
  cd /opt/c2
  git pull
else
  echo "Cloning repo..."
  sudo git clone https://github.com/bcatacb/C2.git /opt/c2
  cd /opt/c2
fi

# Install server deps
echo "Installing server dependencies..."
cd /opt/c2/server
npm install
npx playwright install chromium
npx playwright install-deps chromium

# Install frontend deps and build
echo "Building frontend..."
cd /opt/c2/frontend
npm install
npx vite build

# Create .env if not exists
if [ ! -f /opt/c2/server/.env ]; then
  echo "Creating .env from example..."
  cp /opt/c2/server/.env.example /opt/c2/server/.env
  echo ""
  echo "⚠️  EDIT /opt/c2/server/.env with your Supabase credentials!"
  echo ""
fi

# Install nginx config
echo "Setting up nginx..."
sudo cp /opt/c2/nginx.conf /etc/nginx/sites-available/c2
sudo ln -sf /etc/nginx/sites-available/c2 /etc/nginx/sites-enabled/c2
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Create systemd service
echo "Setting up systemd service..."
sudo cp /opt/c2/c2.service /etc/systemd/system/c2.service
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
echo "1. Edit /opt/c2/server/.env with Supabase creds"
echo "2. Point DNS A record for c2.effortlessmetaphor.org → 192.175.22.236"
echo "3. Run migrations in Supabase SQL editor"
