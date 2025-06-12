#!/bin/bash

# Exit on error
set -e

# Check if required parameters are provided
if [ $# -ne 2 ]; then
  echo "Usage: $0 <ec2-public-ip> <path-to-pem-file>"
  echo "Example: $0 54.123.45.67 ./mcp-server-key.pem"
  exit 1
fi

EC2_IP=$1
PEM_FILE=$2

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN environment variable is not set."
  echo "Please set it before deploying:"
  echo "export GITHUB_TOKEN=your_github_personal_access_token"
  exit 1
fi

echo "🚀 Deploying to EC2 instance at $EC2_IP..."

# Build the project
echo "📦 Building project..."
npm run build

# Create deployment package
echo "📋 Creating deployment package..."
rm -rf deploy-package
mkdir deploy-package

# Copy necessary files
cp -r dist deploy-package/
cp server.js deploy-package/
cp package.json deploy-package/
cp -r node_modules deploy-package/ 2>/dev/null || echo "⚠️  node_modules not found locally"

# Create .env file with environment variables
echo "GITHUB_TOKEN=$GITHUB_TOKEN" > deploy-package/.env
echo "PORT=3000" >> deploy-package/.env
echo "NODE_ENV=production" >> deploy-package/.env

# Create deployment script for the server
cat > deploy-package/deploy-on-server.sh << 'EOF'
#!/bin/bash
set -e

echo "📦 Installing dependencies..."
npm install --production

echo "🔧 Setting up systemd service..."
sudo tee /etc/systemd/system/mcp-server.service > /dev/null << 'SERVICE_EOF'
[Unit]
Description=MCP Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/mcp-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE_EOF

echo "🔄 Restarting service..."
sudo systemctl daemon-reload
sudo systemctl enable mcp-server
sudo systemctl restart mcp-server

echo "✅ Deployment complete!"
echo "📊 Service status:"
sudo systemctl status mcp-server --no-pager
EOF

chmod +x deploy-package/deploy-on-server.sh

# Upload to server
echo "📤 Uploading files to server..."
scp -i "$PEM_FILE" -r deploy-package ec2-user@$EC2_IP:/tmp/
ssh -i "$PEM_FILE" ec2-user@$EC2_IP "rm -rf ~/mcp-server && mv /tmp/deploy-package ~/mcp-server"

# Run deployment script on server
echo "🚀 Running deployment on server..."
ssh -i "$PEM_FILE" ec2-user@$EC2_IP "cd ~/mcp-server && ./deploy-on-server.sh"

# Clean up
rm -rf deploy-package

echo ""
echo "🎉 Deployment successful!"
echo "🔗 Server URL: http://$EC2_IP:3000"
echo "🏥 Health Check: http://$EC2_IP:3000/health"
echo ""
echo "📊 To check server logs:"
echo "ssh -i $PEM_FILE ec2-user@$EC2_IP 'sudo journalctl -u mcp-server -f'" 