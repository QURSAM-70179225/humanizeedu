#!/usr/bin/env bash
# One-command deploy for a Google Cloud (Compute Engine) Ubuntu VM.
# Usage (inside the unzipped project folder on the VM):   sudo bash deploy/setup-vm.sh
# Safe to run again later to update the site — your database is kept.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash deploy/setup-vm.sh"; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/humanizeedu
DATA_DIR=/var/lib/humanizeedu
ENV_FILE="$APP_DIR/.env"

echo "=== HumanizeEdu AI — server setup ==="

# ---- 1. Questions -------------------------------------------------------
OLD_KEY=""; OLD_DOMAIN=""
if [ -f "$ENV_FILE" ]; then
  OLD_KEY=$(grep -E '^GROQ_API_KEY=' "$ENV_FILE" | cut -d= -f2- || true)
  OLD_DOMAIN=$(grep -E '^SITE_URL=' "$ENV_FILE" | cut -d= -f2- | sed 's#https://##' || true)
fi
read -rsp "Paste your Groq API key (typing is hidden; press Enter to keep the current one): " GROQ_KEY; echo
GROQ_KEY="${GROQ_KEY:-$OLD_KEY}"
if [ -z "$GROQ_KEY" ]; then echo "No Groq key given — the site will use the offline rule engine."; fi

IP=$(curl -fs -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)
[ -z "$IP" ] && IP=$(curl -fs https://api.ipify.org || true)
FREE_DOMAIN="${IP//./-}.sslip.io"
read -rp "Your domain name (press Enter to use the free address ${OLD_DOMAIN:-$FREE_DOMAIN}): " DOMAIN
DOMAIN="${DOMAIN:-${OLD_DOMAIN:-$FREE_DOMAIN}}"

# ---- 2. Install Node.js 22 and Caddy (HTTPS web server) -----------------
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  echo "Installing Caddy…"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# ---- 3. Copy the app ----------------------------------------------------
id humanizeedu >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin humanizeedu
mkdir -p "$APP_DIR" "$DATA_DIR"
cp -r "$SRC/server.js" "$SRC/package.json" "$SRC/lib" "$SRC/public" "$APP_DIR/"

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8080
GROQ_API_KEY=$GROQ_KEY
GROQ_MODEL=llama-3.3-70b-versatile
SITE_URL=https://$DOMAIN
EOF
chmod 600 "$ENV_FILE"
chown -R humanizeedu:humanizeedu "$APP_DIR" "$DATA_DIR"

# ---- 4. Run it as a service (auto-starts on reboot, restarts on crash) --
cat > /etc/systemd/system/humanizeedu.service <<EOF
[Unit]
Description=HumanizeEdu AI
After=network.target

[Service]
User=humanizeedu
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --no-warnings --env-file=$ENV_FILE server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable humanizeedu >/dev/null
systemctl restart humanizeedu

# ---- 5. HTTPS with a free certificate -----------------------------------
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:8080
}
EOF
systemctl restart caddy

sleep 3
if curl -fs http://localhost:8080/healthz >/dev/null; then
  echo ""
  echo "✅ HumanizeEdu AI is live:  https://$DOMAIN"
  echo "   (the HTTPS certificate can take up to a minute the first time)"
  echo "   Logs:      sudo journalctl -u humanizeedu -f"
else
  echo "❌ The app didn't start. See: sudo journalctl -u humanizeedu -n 50"
  exit 1
fi
