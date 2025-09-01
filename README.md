# Secretly - Slack Security Bot

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
DATABASE_URL=postgresql://user:pass@host:5432/secretly?ssl=true
REDIS_URL=redis://user:pass@host:6379
ENCRYPTION_KEY=your-32-character-minimum-key
```

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

## License

MIT

## Support

For issues or questions, please open a GitHub issue.