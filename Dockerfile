FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (not just production)
RUN npm ci

# Copy source files and build
COPY . .
RUN npm run build

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "server.js"] 