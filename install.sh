#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  NovaStream — Installation automatique VPS (Ubuntu/Debian)
#  Usage :  bash install.sh
# ══════════════════════════════════════════════════════════════
set -e

echo "╔══════════════════════════════════════════╗"
echo "║   NovaStream — Installation VPS          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Dépendances système ──
echo "▶ [1/5] Installation de ffmpeg, Node.js et npm…"
apt-get update -qq
apt-get install -y -qq ffmpeg curl >/dev/null 2>&1

# Node 20 si la version est absente ou trop vieille
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
fi
echo "  ✔ Node $(node -v) | ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"

# ── 2. Dépendances du projet ──
echo "▶ [2/5] Installation des dépendances npm…"
npm ci --no-audit --no-fund 2>&1 | tail -1

# ── 3. Build ──
echo "▶ [3/5] Compilation de l'application…"
npm run build 2>&1 | tail -2

# ── 4. Service systemd (démarrage auto + redémarrage sur crash) ──
echo "▶ [4/5] Création du service novastream…"
cat > /etc/systemd/system/novastream.service << 'EOF'
[Unit]
Description=NovaStream
After=network.target

[Service]
WorkingDirectory=INSTALL_DIR
Environment=NODE_ENV=production PORT=3000
ExecStart=NODE_BIN dist/boot.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sed -i "s|INSTALL_DIR|$(pwd)|" /etc/systemd/system/novastream.service
sed -i "s|NODE_BIN|$(which node)|" /etc/systemd/system/novastream.service
systemctl daemon-reload
systemctl enable --now novastream 2>/dev/null
sleep 2
systemctl is-active --quiet novastream && echo "  ✔ Service actif"

# ── 5. IP publique ──
echo ""
echo "════════════════════════════════════════════"
IP=$(curl -s4 ifconfig.me 2>/dev/null || echo "VOTRE_IP")
echo "  ✅ INSTALLATION TERMINÉE"
echo ""
echo "  App    → http://${IP}:3000"
echo ""
echo "  HTTPS (obligatoire pour le transcodage) :"
echo "  ▶ cloudflared tunnel --url http://localhost:3000"
echo "════════════════════════════════════════════"
