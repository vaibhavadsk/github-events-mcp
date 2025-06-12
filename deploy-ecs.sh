#!/bin/bash

# Exit on error
set -e

# Configuration
REGION="us-east-1"
CLUSTER_NAME="mcp-cluster"
SERVICE_NAME="mcp-server"
TASK_FAMILY="mcp-server-task"
ECR_REPO_NAME="mcp-server"
CONTAINER_NAME="mcp-server"

echo "🚀 Deploying MCP Server to AWS ECS with Fargate..."

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

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO_NAME}"

# Build the project
echo "📦 Building TypeScript project..."
npm run build

# Create ECR repository if it doesn't exist
echo "📋 Creating ECR repository..."
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $REGION > /dev/null 2>&1 || \
  aws ecr create-repository --repository-name $ECR_REPO_NAME --region $REGION

# Login to ECR
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t $ECR_REPO_NAME .

# Tag and push image
echo "📤 Pushing image to ECR..."
docker tag $ECR_REPO_NAME:latest $ECR_URI:latest
docker push $ECR_URI:latest

# Create ECS cluster if it doesn't exist
echo "📋 Creating ECS cluster..."
aws ecs describe-clusters --clusters $CLUSTER_NAME --region $REGION > /dev/null 2>&1 || \
  aws ecs create-cluster --cluster-name $CLUSTER_NAME --region $REGION

# Create task execution role if it doesn't exist
EXECUTION_ROLE_NAME="ecsTaskExecutionRole"
if ! aws iam get-role --role-name $EXECUTION_ROLE_NAME > /dev/null 2>&1; then
  echo "📋 Creating task execution role..."
  aws iam create-role \
    --role-name $EXECUTION_ROLE_NAME \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "ecs-tasks.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }'
  
  aws iam attach-role-policy \
    --role-name $EXECUTION_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
fi

# Create task definition
echo "📋 Creating task definition..."
cat > task-definition.json << EOF
{
  "family": "$TASK_FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${EXECUTION_ROLE_NAME}",
  "containerDefinitions": [
    {
      "name": "$CONTAINER_NAME",
      "image": "$ECR_URI:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "GITHUB_TOKEN",
          "value": "$GITHUB_TOKEN"
        },
        {
          "name": "PORT",
          "value": "3000"
        },
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/$SERVICE_NAME",
          "awslogs-region": "$REGION",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF

# Create CloudWatch log group
echo "📋 Creating CloudWatch log group..."
aws logs create-log-group --log-group-name /ecs/$SERVICE_NAME --region $REGION 2>/dev/null || true

# Register task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json --region $REGION

# Get default VPC and subnets
DEFAULT_VPC=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $REGION)
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$DEFAULT_VPC" --query "Subnets[*].SubnetId" --output text --region $REGION)
SUBNET_1=$(echo $SUBNETS | cut -d' ' -f1)
SUBNET_2=$(echo $SUBNETS | cut -d' ' -f2)

# Create security group if it doesn't exist
SECURITY_GROUP_NAME="mcp-server-sg"
SECURITY_GROUP_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SECURITY_GROUP_NAME" "Name=vpc-id,Values=$DEFAULT_VPC" \
  --query "SecurityGroups[0].GroupId" --output text --region $REGION 2>/dev/null || echo "None")

if [ "$SECURITY_GROUP_ID" = "None" ]; then
  echo "📋 Creating security group..."
  SECURITY_GROUP_ID=$(aws ec2 create-security-group \
    --group-name $SECURITY_GROUP_NAME \
    --description "Security group for MCP Server" \
    --vpc-id $DEFAULT_VPC \
    --region $REGION \
    --query 'GroupId' --output text)
  
  # Allow inbound traffic on port 3000
  aws ec2 authorize-security-group-ingress \
    --group-id $SECURITY_GROUP_ID \
    --protocol tcp \
    --port 3000 \
    --cidr 0.0.0.0/0 \
    --region $REGION
fi

# Create or update service
if aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION | grep -q "ACTIVE"; then
  echo "📋 Updating ECS service..."
  aws ecs update-service \
    --cluster $CLUSTER_NAME \
    --service $SERVICE_NAME \
    --task-definition $TASK_FAMILY \
    --force-new-deployment \
    --region $REGION
else
  echo "📋 Creating ECS service..."
  aws ecs create-service \
    --cluster $CLUSTER_NAME \
    --service-name $SERVICE_NAME \
    --task-definition $TASK_FAMILY \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$SECURITY_GROUP_ID],assignPublicIp=ENABLED}" \
    --region $REGION
fi

# Wait for service to stabilize
echo "⏳ Waiting for service to stabilize..."
aws ecs wait services-stable --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION

# Get task ARN and public IP
TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --region $REGION --query 'taskArns[0]' --output text)
ENI_ID=$(aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $TASK_ARN --region $REGION --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text)
PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID --region $REGION --query 'NetworkInterfaces[0].Association.PublicIp' --output text)

# Clean up
rm -f task-definition.json

echo ""
echo "🎉 Deployment complete!"
echo "📍 Cluster: $CLUSTER_NAME"
echo "📍 Service: $SERVICE_NAME"
echo "🌐 Public IP: $PUBLIC_IP"
echo "🔗 Server URL: http://$PUBLIC_IP:3000"
echo "🏥 Health Check: http://$PUBLIC_IP:3000/health"
echo ""
echo "📊 To view logs:"
echo "aws logs tail /ecs/$SERVICE_NAME --follow --region $REGION"
echo ""
echo "📊 To check service status:"
echo "aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION" 