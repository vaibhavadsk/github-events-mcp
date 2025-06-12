#!/bin/bash

# Exit on error
set -e

# Configuration
REGION="us-east-1"
INSTANCE_TYPE="t3.micro"
KEY_NAME="mcp-server-key"
SECURITY_GROUP="mcp-server-sg"
AMI_ID="ami-0c02fb55956c7d316"  # Amazon Linux 2023

echo "🚀 Deploying MCP Server to AWS EC2..."

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
  echo "❌ AWS CLI not configured. Please run 'aws configure' first."
  exit 1
fi

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN environment variable is not set."
  echo "Please set it before deploying:"
  echo "export GITHUB_TOKEN=your_github_personal_access_token"
  exit 1
fi

# Create key pair if it doesn't exist
if ! aws ec2 describe-key-pairs --key-names $KEY_NAME --region $REGION > /dev/null 2>&1; then
  echo "📋 Creating EC2 key pair..."
  aws ec2 create-key-pair --key-name $KEY_NAME --region $REGION --query 'KeyMaterial' --output text > ${KEY_NAME}.pem
  chmod 400 ${KEY_NAME}.pem
  echo "✅ Key pair created and saved to ${KEY_NAME}.pem"
else
  echo "✅ Key pair $KEY_NAME already exists"
fi

# Create security group if it doesn't exist
if ! aws ec2 describe-security-groups --group-names $SECURITY_GROUP --region $REGION > /dev/null 2>&1; then
  echo "📋 Creating security group..."
  SECURITY_GROUP_ID=$(aws ec2 create-security-group \
    --group-name $SECURITY_GROUP \
    --description "Security group for MCP Server" \
    --region $REGION \
    --query 'GroupId' --output text)
  
  # Allow SSH access
  aws ec2 authorize-security-group-ingress \
    --group-id $SECURITY_GROUP_ID \
    --protocol tcp \
    --port 22 \
    --cidr 0.0.0.0/0 \
    --region $REGION
  
  # Allow HTTP access on port 3000
  aws ec2 authorize-security-group-ingress \
    --group-id $SECURITY_GROUP_ID \
    --protocol tcp \
    --port 3000 \
    --cidr 0.0.0.0/0 \
    --region $REGION
  
  echo "✅ Security group created with ID: $SECURITY_GROUP_ID"
else
  SECURITY_GROUP_ID=$(aws ec2 describe-security-groups \
    --group-names $SECURITY_GROUP \
    --region $REGION \
    --query 'SecurityGroups[0].GroupId' --output text)
  echo "✅ Security group $SECURITY_GROUP already exists with ID: $SECURITY_GROUP_ID"
fi

# Create user data script
cat > user-data.sh << 'EOF'
#!/bin/bash
yum update -y
yum install -y git

# Install Node.js 18
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# Clone and setup the application
cd /home/ec2-user
git clone https://github.com/your-username/your-repo.git mcp-server || echo "Using local files"
cd mcp-server

# Copy environment variables
echo "GITHUB_TOKEN=${GITHUB_TOKEN}" > .env
echo "PORT=3000" >> .env
echo "NODE_ENV=production" >> .env

# Install dependencies and build
npm install
npm run build

# Create systemd service
cat > /etc/systemd/system/mcp-server.service << 'SERVICE_EOF'
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

# Start the service
systemctl daemon-reload
systemctl enable mcp-server
systemctl start mcp-server

EOF

# Launch EC2 instance
echo "📋 Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type $INSTANCE_TYPE \
  --key-name $KEY_NAME \
  --security-groups $SECURITY_GROUP \
  --user-data file://user-data.sh \
  --region $REGION \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=MCP-Server}]' \
  --query 'Instances[0].InstanceId' --output text)

echo "✅ Instance launched with ID: $INSTANCE_ID"

# Wait for instance to be running
echo "⏳ Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --region $REGION \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "🎉 Deployment complete!"
echo "📍 Instance ID: $INSTANCE_ID"
echo "🌐 Public IP: $PUBLIC_IP"
echo "🔗 Server URL: http://$PUBLIC_IP:3000"
echo "🏥 Health Check: http://$PUBLIC_IP:3000/health"
echo ""
echo "📝 To connect via SSH:"
echo "ssh -i ${KEY_NAME}.pem ec2-user@$PUBLIC_IP"
echo ""
echo "📊 To check server logs:"
echo "ssh -i ${KEY_NAME}.pem ec2-user@$PUBLIC_IP 'sudo journalctl -u mcp-server -f'"

# Clean up
rm -f user-data.sh 