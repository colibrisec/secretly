# Secretly - Slack Security Bot Architecture

## Overview
A Slack bot that monitors channels for sensitive information and automatically obfuscates it to prevent data leaks.

## Core Components

### 1. Slack Integration Layer
- **Event API**: Receives real-time message events
- **Web API**: Updates messages, sends ephemeral replies
- **OAuth**: Manages app installation and permissions
- **Socket Mode**: For development and private deployments

### 2. Detection Engine
- **Pattern Matchers**: Regex-based detection for known patterns
  - Credit cards (Luhn validation)
  - SSNs
  - API keys (AWS, GitHub, etc.)
  - Passwords in plain text
  - Email/phone numbers
- **Entropy Analysis**: Detect high-entropy strings (potential secrets)
- **Context Analysis**: Consider surrounding text for false positive reduction

### 3. Obfuscation Service
- **Reversible Encryption**: Store original content encrypted
- **Visual Masking**: Replace sensitive data with asterisks
- **Metadata Storage**: Track what was obfuscated and why
- **Audit Trail**: Log all obfuscation actions

### 4. Permission System
- **Role-Based Access**: Map Slack roles to dismissal permissions
- **Channel Configuration**: Per-channel sensitivity settings
- **User Exemptions**: Whitelist certain users/bots

### 5. Storage Layer
- **PostgreSQL**: Metadata, configurations, audit logs
- **Redis**: Rate limiting, temporary data, caching
- **Encryption**: AES-256 for sensitive data at rest

## Security Principles

### Data Minimization
- Store only essential metadata
- Auto-expire old obfuscation records
- No permanent storage of unencrypted sensitive data

### Zero Trust
- Verify all incoming requests
- Validate Slack signatures
- Rate limit all operations
- Input sanitization

### Encryption
- TLS for all external communications
- Encrypted database connections
- Secrets in environment variables or secret management service

### Audit & Compliance
- Comprehensive logging
- Immutable audit trail
- GDPR/CCPA compliant data handling

## Message Flow

1. User posts message in monitored channel
2. Slack sends event to bot
3. Bot analyzes message for sensitive patterns
4. If detected:
   - Update original message (obfuscate)
   - Send ephemeral reply to user
   - Store metadata securely
5. User can dismiss if permitted
6. Audit log captures all actions

## Deployment Architecture

```
┌─────────────┐
│   Slack     │
│   Workspace │
└──────┬──────┘
       │ Events/API
       ▼
┌─────────────┐
│  Load       │
│  Balancer   │
└──────┬──────┘
       │
┌──────▼──────┐
│   App       │
│   Servers   │
│  (Node.js)  │
└──────┬──────┘
       │
┌──────▼──────┐     ┌──────────┐
│  PostgreSQL │◄───►│  Redis   │
│  (Metadata) │     │  (Cache) │
└─────────────┘     └──────────┘
```

## Configuration

### Environment Variables
- `SLACK_BOT_TOKEN`: Bot user OAuth token
- `SLACK_SIGNING_SECRET`: Request verification
- `DATABASE_URL`: PostgreSQL connection
- `REDIS_URL`: Redis connection
- `ENCRYPTION_KEY`: Master encryption key

### Channel Settings
- Sensitivity level (low/medium/high/critical)
- Detection patterns to enable/disable
- Exempted users
- Auto-dismiss timeout

## Rate Limiting
- Per-user: 10 messages/second
- Per-channel: 100 messages/second
- Global: 1000 messages/second

## Error Handling
- Graceful degradation
- Fallback to logging mode
- Alert administrators on critical failures
- Circuit breaker for external dependencies