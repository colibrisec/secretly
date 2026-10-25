# Multi-stage build for optimized image size
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder

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
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# hadolint ignore=DL3017,DL3018
RUN apk add --no-cache dumb-init && \
    apk upgrade --no-cache libcrypto3 libssl3 zlib && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx && \
    addgroup -g 10001 -S nodejs && \
    adduser -S nodejs -u 10001 -G nodejs && \
    mkdir -p /app/logs && \
    chown nodejs:nodejs /app/logs

WORKDIR /app

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Copy pruned production node_modules from builder (native modules already compiled)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy configuration files
COPY --chown=nodejs:nodejs .env.example ./.env.example

# Switch to non-root user (numeric so Kubernetes runAsNonRoot can verify it)
USER 10001:10001

# Expose port
EXPOSE 3000

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||3000}/health`,{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
