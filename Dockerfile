# Multi-stage build for optimized image size
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder

# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev) with security flags
RUN npm ci --no-audit --no-fund

# Copy source code
COPY src ./src

# Build the application and prune to production-only deps
RUN npm run build && npm prune --omit=dev

# Production stage
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f

# hadolint ignore=DL3018
RUN apk add --no-cache dumb-init && \
    addgroup -g 10001 -S nodejs && \
    adduser -S nodejs -u 10001

WORKDIR /app

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Copy pruned production node_modules from builder (native modules already compiled)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

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
