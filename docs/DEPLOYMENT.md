# Deployment Guide

This guide covers deploying Secretly using Docker Compose for local development and Helm for Kubernetes production deployments.

## Quick Start

### Docker Compose (Development)

1. **Clone and setup environment**:
```bash
git clone https://github.com/colibrisec/secretly.git
cd secretly
cp .env.example .env
```

2. **Configure your `.env` file**:
```bash
# Required Slack configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Generate a secure encryption key (32+ characters)
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

3. **Start the stack**:
```bash
docker-compose up -d
```

4. **Verify deployment**:
```bash
docker-compose ps
docker-compose logs -f app
```

### Kubernetes with Helm

1. **Add the Helm repository**:
```bash
helm repo add secretly oci://ghcr.io/colibrisec/charts
helm repo update
```

2. **Create secrets**:
```bash
kubectl create secret generic secretly-secrets \
  --from-literal=slack-bot-token="xoxb-your-token" \
  --from-literal=slack-app-token="xapp-your-token" \
  --from-literal=slack-signing-secret="your-secret" \
  --from-literal=encryption-key="$(openssl rand -base64 32)"
```

3. **Install the chart**:
```bash
helm install secretly secretly/secretly \
  --set slack.botToken="xoxb-your-token" \
  --set slack.appToken="xapp-your-token" \
  --set slack.signingSecret="your-secret" \
  --set security.encryptionKey="your-32-char-key"
```

## Docker Deployment

### Production Docker Compose

For production deployments, use the production compose file:

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Development with Hot Reload

For development with hot reload:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Slack bot token (required) | - |
| `SLACK_APP_TOKEN` | Slack app token (required) | - |
| `SLACK_SIGNING_SECRET` | Slack signing secret (required) | - |
| `ENCRYPTION_KEY` | 32+ character encryption key | - |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Redis connection string | `redis://...` |
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Environment | `production` |

### Health Checks

The application provides health check endpoints:
- `GET /health` - Basic health check
- `GET /ready` - Readiness check

### Docker Images

Images are automatically built and published to:
- `ghcr.io/colibrisec/secretly:latest` - Latest main branch
- `ghcr.io/colibrisec/secretly:stable` - Latest release
- `ghcr.io/colibrisec/secretly:v1.0.0` - Specific version

## Kubernetes Deployment

### Prerequisites

- Kubernetes 1.20+
- Helm 3.8+
- PostgreSQL 13+ (or managed database)
- Redis 6+ (or managed cache)

### Helm Chart Installation

#### 1. Add Repository

```bash
# Add OCI repository
helm repo add secretly oci://ghcr.io/colibrisec/charts

# Or use GitHub releases
helm repo add secretly https://colibrisec.github.io/secretly
helm repo update
```

#### 2. Create Namespace

```bash
kubectl create namespace secretly
```

#### 3. Create Secrets

```bash
# Slack credentials
kubectl create secret generic secretly-slack \
  --namespace=secretly \
  --from-literal=bot-token="xoxb-your-bot-token" \
  --from-literal=app-token="xapp-your-app-token" \
  --from-literal=signing-secret="your-signing-secret"

# Encryption key
kubectl create secret generic secretly-encryption \
  --namespace=secretly \
  --from-literal=encryption-key="$(openssl rand -base64 32)"
```

#### 4. Install Chart

**Basic Installation:**
```bash
helm install secretly secretly/secretly \
  --namespace=secretly \
  --set security.existingSecret=secretly-encryption \
  --set slack.botToken="$(kubectl get secret secretly-slack -o jsonpath='{.data.bot-token}' | base64 -d)" \
  --set slack.appToken="$(kubectl get secret secretly-slack -o jsonpath='{.data.app-token}' | base64 -d)" \
  --set slack.signingSecret="$(kubectl get secret secretly-slack -o jsonpath='{.data.signing-secret}' | base64 -d)"
```

**Production Installation:**
```bash
helm install secretly secretly/secretly \
  --namespace=secretly \
  --values=values-production.yaml \
  --set security.existingSecret=secretly-encryption \
  --set externalDatabase.host=your-postgres-host \
  --set externalDatabase.existingSecret=postgres-secret \
  --set externalRedis.host=your-redis-host \
  --set externalRedis.existingSecret=redis-secret
```

### Environment-Specific Deployments

#### Development
```bash
helm install secretly-dev secretly/secretly \
  --namespace=secretly-dev \
  --values=helm/secretly/values-dev.yaml
```

#### Staging
```bash
helm install secretly-staging secretly/secretly \
  --namespace=secretly-staging \
  --values=helm/secretly/values-staging.yaml
```

#### Production
```bash
helm install secretly-prod secretly/secretly \
  --namespace=secretly-prod \
  --values=helm/secretly/values-production.yaml
```

### Configuration Options

#### Database Configuration

**Embedded PostgreSQL (development):**
```yaml
postgresql:
  enabled: true
  auth:
    password: "secure-password"
```

**External Database (production):**
```yaml
postgresql:
  enabled: false
externalDatabase:
  enabled: true
  host: "postgres.example.com"
  existingSecret: "postgres-credentials"
```

#### Redis Configuration

**Embedded Redis (development):**
```yaml
redis:
  enabled: true
  auth:
    password: "secure-password"
```

**External Redis (production):**
```yaml
redis:
  enabled: false
externalRedis:
  enabled: true
  host: "redis.example.com"
  existingSecret: "redis-credentials"
```

#### Ingress Configuration

```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: secretly.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: secretly-tls
      hosts:
        - secretly.example.com
```

#### Autoscaling

```yaml
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
```

#### Monitoring

```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    labels:
      prometheus: kube-prometheus
```

### Upgrading

#### Helm Upgrade
```bash
helm upgrade secretly secretly/secretly \
  --namespace=secretly \
  --values=your-values.yaml
```

#### Rolling Updates
The chart supports zero-downtime rolling updates:
- Pod disruption budgets prevent excessive downtime
- Readiness probes ensure pods are ready before receiving traffic
- Pre-stop hooks allow graceful shutdown

### Troubleshooting

#### Check Pod Status
```bash
kubectl get pods -n secretly
kubectl describe pod secretly-xxx -n secretly
```

#### View Logs
```bash
kubectl logs -f deployment/secretly -n secretly
```

#### Debug Configuration
```bash
helm get values secretly -n secretly
kubectl get configmap secretly -o yaml -n secretly
```

#### Health Checks
```bash
kubectl port-forward svc/secretly 8080:3000 -n secretly
curl http://localhost:8080/health
```

### Security Considerations

#### Network Policies
```yaml
networkPolicy:
  enabled: true
  policyTypes:
    - Ingress
    - Egress
```

#### Pod Security Standards
```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1001
  fsGroup: 1001

securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: true
```

#### Resource Limits
```yaml
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi
```

### Backup and Recovery

#### Database Backup
```bash
kubectl exec -it secretly-postgresql-0 -- pg_dump -U secretly_user secretly > backup.sql
```

#### Configuration Backup
```bash
helm get values secretly -n secretly > secretly-values-backup.yaml
kubectl get secrets -n secretly -o yaml > secretly-secrets-backup.yaml
```

### Performance Tuning

#### Database Optimization
- Use connection pooling
- Configure appropriate PostgreSQL settings
- Monitor query performance

#### Redis Optimization
- Configure appropriate memory policies
- Use Redis clustering for high availability
- Monitor memory usage

#### Application Tuning
- Adjust rate limits based on usage
- Configure appropriate resource requests/limits
- Use horizontal pod autoscaling

## Monitoring and Observability

### Metrics
The application exposes Prometheus metrics at `/metrics`:
- Request duration and count
- Database connection metrics
- Redis operation metrics
- Business metrics (obfuscations, detections)

### Logging
Structured JSON logging with configurable levels:
- `error` - Errors only
- `warn` - Warnings and errors
- `info` - Informational messages
- `debug` - Debug information

### Alerting
Recommended alerts:
- High error rate
- Database connection failures
- High memory/CPU usage
- Failed obfuscation operations

### Tracing
Integration with OpenTelemetry for distributed tracing (optional).

## Maintenance

### Regular Tasks
- Monitor resource usage
- Review audit logs
- Update dependencies
- Backup configurations
- Test disaster recovery

### Updates
- Follow semantic versioning
- Test in staging first
- Use rolling updates
- Monitor during deployments