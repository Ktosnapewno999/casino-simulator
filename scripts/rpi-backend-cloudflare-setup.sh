#!/usr/bin/env bash
set -euo pipefail

BACKEND_DOMAIN="${BACKEND_DOMAIN:-api.casino.fans-only.me}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-https://casino.fans-only.me}"
TUNNEL_NAME="${TUNNEL_NAME:-casino-backend}"
PORT="${PORT:-3000}"
APP_DIR="${APP_DIR:-$(pwd)}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
SERVICE_NAME="${SERVICE_NAME:-casino-backend}"
DATABASE_PATH="${DATABASE_PATH:-$APP_DIR/casino.sqlite}"

info() {
  printf "\n\033[1;36m==>\033[0m %s\n" "$1"
}

fail() {
  printf "\n\033[1;31mError:\033[0m %s\n" "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

if [ ! -f "$APP_DIR/package.json" ] || [ ! -f "$APP_DIR/server/server.js" ]; then
  fail "Run this script from the casino-simulator repo root, or set APP_DIR=/path/to/repo."
fi

if ! need_cmd sudo; then
  fail "sudo is required."
fi

info "Installing base packages"
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

NODE_MAJOR="0"
if need_cmd node; then
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
fi

if [ "$NODE_MAJOR" -lt 18 ]; then
  info "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  info "Node.js $(node -v) already installed"
fi

info "Installing backend dependencies"
cd "$APP_DIR"
npm install

if [ ! -f "$APP_DIR/.env" ]; then
  info "Creating .env for backend"
  read -r -p "Maileroo SMTP username: " SMTP_USER
  read -r -s -p "Maileroo SMTP password: " SMTP_PASS
  printf "\n"
  read -r -p "From address [Casino Simulator <no-reply@casino.fans-only.me>]: " SMTP_FROM
  SMTP_FROM="${SMTP_FROM:-Casino Simulator <no-reply@casino.fans-only.me>}"
  read -r -p "Admin username [admin]: " ADMIN_USERNAME
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  read -r -p "Admin email: " ADMIN_EMAIL
  read -r -s -p "Admin password: " ADMIN_PASSWORD
  printf "\n"

  cat > "$APP_DIR/.env" <<ENV
PORT=$PORT
DATABASE_PATH=$DATABASE_PATH
APP_ORIGIN=$FRONTEND_ORIGIN
SMTP_HOST=smtp.maileroo.com
SMTP_PORT=587
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM="$SMTP_FROM"
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
  chmod 600 "$APP_DIR/.env"
else
  info ".env already exists, leaving it unchanged"
fi

info "Creating systemd service for backend"
sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<SERVICE
[Unit]
Description=Casino Simulator test backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

info "Installing cloudflared"
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  arm64)
    CF_DEB="cloudflared-linux-arm64.deb"
    ;;
  armhf|armel)
    CF_DEB="cloudflared-linux-arm.deb"
    ;;
  amd64)
    CF_DEB="cloudflared-linux-amd64.deb"
    ;;
  *)
    fail "Unsupported architecture: $ARCH"
    ;;
esac

curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF_DEB"
sudo dpkg -i /tmp/cloudflared.deb

mkdir -p "$HOME/.cloudflared"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  info "Cloudflare login"
  printf "A login URL will appear. Open it in your browser, choose fans-only.me, then return to SSH.\n"
  cloudflared tunnel login
else
  info "Cloudflare login certificate already exists"
fi

info "Creating or reusing Cloudflare tunnel: $TUNNEL_NAME"
if cloudflared tunnel list | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  TUNNEL_ID="$(cloudflared tunnel list | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}')"
else
  CREATE_OUTPUT="$(cloudflared tunnel create "$TUNNEL_NAME")"
  printf "%s\n" "$CREATE_OUTPUT"
  TUNNEL_ID="$(printf "%s\n" "$CREATE_OUTPUT" | sed -nE 's/.*Created tunnel .* with id ([a-f0-9-]+).*/\1/p')"
fi

if [ -z "${TUNNEL_ID:-}" ]; then
  fail "Could not detect tunnel id. Run: cloudflared tunnel list"
fi

info "Writing cloudflared config"
cat > "$HOME/.cloudflared/config.yml" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $BACKEND_DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
YAML

info "Creating DNS route in Cloudflare"
cloudflared tunnel route dns "$TUNNEL_NAME" "$BACKEND_DOMAIN" || true

info "Copying cloudflared config for system service"
sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/$TUNNEL_ID.json" "/etc/cloudflared/$TUNNEL_ID.json"
sudo tee /etc/cloudflared/config.yml >/dev/null <<YAML
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $BACKEND_DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
YAML

info "Installing cloudflared as a system service"
sudo cloudflared service install || true
sudo systemctl enable --now cloudflared

info "Done"
printf "Backend service:   %s\n" "$SERVICE_NAME"
printf "Backend local:     http://localhost:%s/api/health\n" "$PORT"
printf "Backend public:    https://%s/api/health\n" "$BACKEND_DOMAIN"
printf "Frontend config:   window.CASINO_API_URL = \"https://%s\";\n" "$BACKEND_DOMAIN"
printf "\nUseful checks:\n"
printf "  sudo systemctl status %s\n" "$SERVICE_NAME"
printf "  sudo systemctl status cloudflared\n"
printf "  journalctl -u %s -f\n" "$SERVICE_NAME"
printf "  journalctl -u cloudflared -f\n"
