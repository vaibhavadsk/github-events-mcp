# Enhanced Segment Analytics MCP Server

A Node.js server for analyzing and improving Segment analytics events using the Model Context Protocol (MCP).

## Prerequisites

- Node.js 18+
- Docker (for containerized deployment)
- AWS CLI (for deployment)
- GitHub Personal Access Token

## Environment Variables

Before running or deploying, set up the following environment variables:

- `GITHUB_TOKEN`: Your GitHub personal access token with appropriate permissions
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the root directory:

```
GITHUB_TOKEN=your_github_personal_access_token
PORT=3000
NODE_ENV=development
```

3. Build the TypeScript code:

```bash
npm run build
```

## Local Development

### Option 1: Run directly with Node.js

```bash
# Start the server
npm start

# Or run in development mode with auto-restart
npm run dev
```

### Option 2: Run with Docker

```bash
# Build and run with Docker
npm run docker:build
npm run docker:run

# Or use docker-compose
npm run docker:compose
```

The server will be available at:

- Main endpoint: http://localhost:3000
- Health check: http://localhost:3000/health
- Tools endpoint: http://localhost:3000/tools

## AWS Deployment Options

### Option 1: ECS with Fargate (Recommended - Easiest)

This is the simplest deployment method using AWS ECS with Fargate:

```bash
# Set your environment variables
export GITHUB_TOKEN=your_github_personal_access_token

# Deploy to ECS
npm run deploy:ecs
# or
./deploy-ecs.sh
```

This will:

- Build and push a Docker image to ECR
- Create an ECS cluster with Fargate
- Deploy the container as a service
- Set up networking and security groups automatically
- Provide you with a public URL

Benefits of ECS:

- No server management required
- Automatic scaling capabilities
- Built-in load balancing
- Easy updates with zero downtime
- Integrated with CloudWatch for logging

### Option 2: EC2 Instance Deployment

For traditional server deployment:

```bash
# Deploy to existing EC2 instance
npm run deploy:ec2 <ec2-public-ip> <path-to-pem-file>
# or
./deploy-simple.sh 54.123.45.67 ./my-key.pem
```

### Option 3: Create New EC2 Instance

To create and deploy to a new EC2 instance:

```bash
./deploy-aws.sh
```

## Testing the Deployment

After deployment, test the endpoints:

```bash
# Health check
curl http://your-server-url:3000/health

# Main endpoint
curl http://your-server-url:3000

# Tools endpoint
curl -X POST http://your-server-url:3000/tools
```

## Managing ECS Deployment

View logs:

```bash
aws logs tail /ecs/mcp-server --follow --region us-east-1
```

Check service status:

```bash
aws ecs describe-services --cluster mcp-cluster --services mcp-server --region us-east-1
```

Update deployment (after code changes):

```bash
npm run deploy:ecs
```

Scale the service:

```bash
aws ecs update-service --cluster mcp-cluster --service mcp-server --desired-count 2 --region us-east-1
```

## Cleanup

### ECS Resources

```bash
# Stop the service
aws ecs update-service --cluster mcp-cluster --service mcp-server --desired-count 0 --region us-east-1

# Delete the service
aws ecs delete-service --cluster mcp-cluster --service mcp-server --region us-east-1

# Delete the cluster
aws ecs delete-cluster --cluster mcp-cluster --region us-east-1

# Delete ECR repository
aws ecr delete-repository --repository-name mcp-server --force --region us-east-1
```

### EC2 Resources

```bash
# Terminate instance
aws ec2 terminate-instances --instance-ids <instance-id>

# Delete security group
aws ec2 delete-security-group --group-name mcp-server-sg
```

## Troubleshooting

1. **Docker build fails**: Ensure you've run `npm run build` first
2. **ECS deployment fails**: Check AWS CLI is configured with proper permissions
3. **Cannot access the server**: Verify security group allows traffic on port 3000
4. **Environment variables not working**: Ensure GITHUB_TOKEN is exported before deployment
