# Multi-stage build for optimized image size  
FROM node:20-alpine AS builder

# Install build dependencies with pinned versions
RUN apk add --no-cache python3=3.12.11-r0 make=4.4.1-r3 g++=14.2.0-r6

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev) with security flags
RUN npm ci --no-audit --no-fund

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies with pinned versions
RUN apk add --no-cache dumb-init=1.2.5-r3 python3=3.12.11-r0 make=4.4.1-r3 g++=14.2.0-r6

# Create non-root user with high UID for security
RUN addgroup -g 10001 -S nodejs && \
    adduser -S nodejs -u 10001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only with security flags
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Remove build tools after installation to reduce image size
RUN apk del python3 make g++

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy configuration files
COPY --chown=nodejs:nodejs .env.example ./.env.example

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check with proper timeout and simplified command
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]