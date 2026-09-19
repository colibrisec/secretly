# Secretly - Slack Security Bot

[![ci](https://github.com/colibrisec/secretly/actions/workflows/ci.yml/badge.svg)](https://github.com/colibrisec/secretly/actions/workflows/ci.yml)
[![ojo](https://github.com/colibrisec/secretly/actions/workflows/ojo.yml/badge.svg)](https://github.com/colibrisec/secretly/actions/workflows/ojo.yml)
[![Coverage](https://github.com/colibrisec/secretly/wiki/coverage.svg)](https://github.com/colibrisec/secretly/actions/workflows/ci.yml)

A proactive Slack bot that detects and obfuscates sensitive information in real-time to prevent data leaks.

## Features

- **Real-time Detection**: Monitors messages for sensitive data patterns
- **Automatic Obfuscation**: Masks detected sensitive information immediately
- **Permission-based Dismissal**: Authorized users can restore original content
- **Configurable Sensitivity**: Adjust detection levels per channel
- **Comprehensive Audit Trail**: Track all security actions
- **Rate Limiting**: Prevent abuse and ensure performance

## Detected Data Types

- Credit card numbers (with Luhn validation)
- Social Security Numbers (SSN)
- API keys and tokens (AWS, GitHub, Slack, etc.)
- Passwords in plain text
- Database connection strings
- Private keys
- Email addresses
- Phone numbers
- IP addresses
- High-entropy strings (potential secrets)

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Redis server
- Slack workspace with admin access

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/secretly.git
cd secretly
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your credentials

## Slack App Setup

1. Create a new Slack app at https://api.slack.com/apps

2. Configure OAuth & Permissions:
   - Add Bot Token Scopes:
     - `channels:history`
     - `channels:read`
     - `chat:write`
     - `chat:write.public`
     - `commands`
     - `groups:history`
     - `groups:read`
     - `im:history`
     - `im:read`
     - `mpim:history`
     - `mpim:read`
     - `users:read`

3. Enable Event Subscriptions:
   - Subscribe to bot events:
     - `message.channels`
     - `message.groups`
     - `message.im`
     - `message.mpim`

4. Enable Socket Mode for development

5. Install the app to your workspace

## Database Setup

Run the following to set up PostgreSQL:

```sql
CREATE DATABASE secretly;
```

The application will automatically create required tables on first run.

## Running the Bot

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Docker Development
```bash
docker-compose up
```

### Docker Production
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Kubernetes Deployment
```bash
# Add Helm repository
helm repo add secretly oci://ghcr.io/colibrisec/charts
helm repo update

# Install with your configuration
helm install secretly secretly/secretly \
  --set slack.botToken="xoxb-your-token" \
  --set slack.appToken="xapp-your-token" \
  --set slack.signingSecret="your-secret" \
  --set security.encryptionKey="your-32-char-key"
```

## Usage

### Basic Commands

- `/secretly-config` - Configure channel settings (admin only)
- Dismissal button appears in ephemeral messages when sensitive data is detected

### Channel Configuration

Administrators can configure:
- Sensitivity level (low/medium/high/critical)
- Enabled detection types
- User exemptions
- Entropy threshold for secret detection

### Permission Levels

- **Low Severity**: Email addresses, phone numbers
- **Medium Severity**: IP addresses, potential secrets
- **High Severity**: API keys, JWT tokens
- **Critical Severity**: Credit cards, SSNs, passwords

## Security Best Practices

1. **Environment Variables**: Never commit `.env` files
2. **Encryption Key**: Use a strong 32+ character key
3. **Database Security**: Use SSL connections in production
4. **Regular Updates**: Keep dependencies updated
5. **Audit Logs**: Regularly review security events
6. **Data Retention**: Configure appropriate TTLs

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

### Type Checking
```bash
npm run typecheck
```

## Deployment

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Environment Variables for Production

```bash
NODE_ENV=production
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token
SLACK_SIGNING_SECRET=your-secret
DATABASE_URL=postgresql://user:pass@host:5432/secretly
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_SSL_CA_FILE=/etc/secretly/db-ca.pem
REDIS_URL=redis://user:pass@host:6379
ENCRYPTION_KEY=your-32-character-minimum-key
```

In production, TLS verification for the database connection is on by default and ssl parameters in `DATABASE_URL` are ignored; configure TLS with the `DATABASE_SSL_*` variables as described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Releases

Releases are cut by the `release` workflow. It runs automatically on the 1st of each month and bumps the minor version, skipping the month when nothing has changed since the last release. To release sooner, run it manually from the Actions tab on `main` and choose a `patch` (default), `minor` or `major` bump. The first release is `v1.0.0`.

Each release publishes:

- the container image to `ghcr.io/colibrisec/secretly` tagged `X.Y.Z`, `X.Y`, `X` and `stable`, with an ojo scan attached as an attestation when the scan succeeds
- the Helm chart to `oci://ghcr.io/colibrisec/charts` with the same version
- a GitHub release with generated notes and the chart attached

The `latest` image tag follows the head of `main` and is published by the Docker build workflow, not by releases. The chart at `oci://ghcr.io/colibrisec/charts` is also published by the Helm chart workflow when `helm/` changes on `main`, using the version in `Chart.yaml`, so a chart version published by a release can be overwritten by a later change to `helm/` until that workflow stops publishing versioned charts.

If a release run fails partway, use **Re-run failed jobs**; **Re-run all jobs** computes a new version instead of retrying.

## Monitoring

The bot provides:
- Comprehensive logging via Winston
- Rate limit monitoring
- Database health checks
- Audit trail for all actions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full guidelines.

## License

GPLv3

## Support

For issues or questions, please open a GitHub issue.
