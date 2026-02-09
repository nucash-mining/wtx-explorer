#!/bin/bash
# WATTx Explorer Deployment Script for Oracle VPS
# Run this on the VPS: bash deploy.sh

set -e

echo "=== WATTx Explorer Deployment ==="

# 1. Check if WATTx node is running
echo "Checking WATTx node..."
if pgrep -f "wattx" > /dev/null; then
    echo "WATTx node is running"
else
    echo "WARNING: WATTx node is NOT running. Start it first."
fi

# 2. Install Node.js if needed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs || sudo yum install -y nodejs || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs)
fi
echo "Node.js: $(node --version)"

# 3. Install nginx if needed
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    sudo dnf install -y nginx || sudo yum install -y nginx || sudo apt install -y nginx
fi

# 4. Install pm2 if needed
if ! command -v pm2 &> /dev/null; then
    echo "Installing pm2..."
    sudo npm install -g pm2
fi

# 5. Clone or update repo
cd ~
if [ -d "wtx-explorer" ]; then
    echo "Updating existing repo..."
    cd wtx-explorer
    git pull
else
    echo "Cloning repo..."
    git clone https://github.com/nucash-mining/wtx-explorer.git
    cd wtx-explorer
fi

# 6. Setup backend
echo "Setting up backend..."
cd ~/wtx-explorer/backend
npm install
mkdir -p data

# Find WATTx config to get RPC credentials
WATTX_CONF=""
for f in ~/.wattx/wattx.conf ~/.wattx_main/wattx.conf /home/*/wattx.conf; do
    if [ -f "$f" ]; then
        WATTX_CONF="$f"
        break
    fi
done

if [ -n "$WATTX_CONF" ]; then
    echo "Found WATTx config: $WATTX_CONF"
    RPC_USER=$(grep "^rpcuser=" "$WATTX_CONF" | cut -d= -f2)
    RPC_PASS=$(grep "^rpcpassword=" "$WATTX_CONF" | cut -d= -f2)
    RPC_PORT=$(grep "^rpcport=" "$WATTX_CONF" | cut -d= -f2)
    RPC_PORT=${RPC_PORT:-3889}
else
    echo "WATTx config not found, using defaults"
    RPC_USER="wattxrpc"
    RPC_PASS="v4AZR3AmHHbrMkRfhXlkWH6MI1bFeHwV"
    RPC_PORT="3889"
fi

cat > .env << EOF
PORT=3001
RPC_URL=http://${RPC_USER}:${RPC_PASS}@127.0.0.1:${RPC_PORT}
DB_PATH=./data/explorer.db
NODE_ENV=production
EOF
echo "Backend .env created"

# 7. Build frontend
echo "Building frontend..."
cd ~/wtx-explorer/frontend
npm install

# Update API URL to use relative path (nginx will proxy)
sed -i "s|http://localhost:3001/api|/api|g" src/App.jsx 2>/dev/null || true
npm run build

# 8. Configure nginx
echo "Configuring nginx..."
sudo tee /etc/nginx/conf.d/wtx-explorer.conf > /dev/null << 'NGINX'
server {
    listen 80;
    server_name wtx-explorer.wattxchange.app;

    root /home/opc/wtx-explorer/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

# Fix the root path to match actual user home
ACTUAL_HOME=$(eval echo ~)
sudo sed -i "s|/home/opc|${ACTUAL_HOME}|g" /etc/nginx/conf.d/wtx-explorer.conf

sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx
echo "Nginx configured and running"

# 9. Open firewall ports
echo "Opening firewall ports..."
sudo firewall-cmd --permanent --add-service=http 2>/dev/null || true
sudo firewall-cmd --permanent --add-service=https 2>/dev/null || true
sudo firewall-cmd --reload 2>/dev/null || true
# Also try iptables in case firewalld isn't used
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true

# 10. Start backend with pm2
echo "Starting backend..."
cd ~/wtx-explorer/backend
pm2 delete wtx-explorer 2>/dev/null || true
pm2 start src/server.js --name wtx-explorer
pm2 save
sudo env PATH=$PATH:$(which node | xargs dirname) $(which pm2) startup systemd -u $(whoami) --hp $HOME 2>/dev/null || true

# 11. SSL with certbot (optional)
echo ""
echo "=== Setup Complete ==="
echo "Site should be live at: http://wtx-explorer.wattxchange.app"
echo ""
echo "To add HTTPS, install certbot and run:"
echo "  sudo dnf install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d wtx-explorer.wattxchange.app"
echo ""
echo "To check status:"
echo "  pm2 status"
echo "  pm2 logs wtx-explorer"
echo "  sudo systemctl status nginx"
