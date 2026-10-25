import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Labels are limited to detector type, severity and outcome. Channel and
// user IDs are left out on purpose: they are unbounded and identify people.
export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const messagesScanned = new Counter({
  name: 'secretly_messages_scanned_total',
  help: 'Messages run through the detectors',
  registers: [registry],
});

export const messagesSkipped = new Counter({
  name: 'secretly_messages_skipped_total',
  help: 'Messages not scanned, by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const detections = new Counter({
  name: 'secretly_detections_total',
  help: 'Sensitive values detected, by detector type and severity',
  labelNames: ['type', 'severity'] as const,
  registers: [registry],
});

export const messagesObfuscated = new Counter({
  name: 'secretly_messages_obfuscated_total',
  help: 'Messages obfuscated, by highest severity found',
  labelNames: ['severity'] as const,
  registers: [registry],
});

export const messageErrors = new Counter({
  name: 'secretly_message_errors_total',
  help: 'Messages that failed while being processed',
  registers: [registry],
});

export const messageDuration = new Histogram({
  name: 'secretly_message_processing_duration_seconds',
  help: 'Time to process a message, from receipt to audit log',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const dismissals = new Counter({
  name: 'secretly_dismissals_total',
  help: 'Dismissal requests, by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const configChanges = new Counter({
  name: 'secretly_config_changes_total',
  help: 'Channel configuration submissions, by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const rateLimiterErrors = new Counter({
  name: 'secretly_rate_limiter_errors_total',
  help: 'Rate limiter backend errors (requests are allowed through when this happens)',
  registers: [registry],
});

export const removalFailures = new Counter({
  name: 'secretly_removal_failures_total',
  help: 'Messages with sensitive data that could not be deleted (the secret stays visible)',
  registers: [registry],
});

export const repostFailures = new Counter({
  name: 'secretly_repost_failures_total',
  help: 'Masked copies that could not be reposted after the original was deleted',
  registers: [registry],
});
