import { registry } from './metrics';

describe('metrics registry', () => {
  it('exposes the secretly metrics and default process metrics in Prometheus format', async () => {
    const text = await registry.metrics();
    for (const name of [
      'secretly_messages_scanned_total',
      'secretly_messages_skipped_total',
      'secretly_detections_total',
      'secretly_messages_obfuscated_total',
      'secretly_message_errors_total',
      'secretly_message_processing_duration_seconds',
      'secretly_dismissals_total',
      'secretly_config_changes_total',
      'secretly_rate_limiter_errors_total',
      'process_cpu_seconds_total',
      'nodejs_eventloop_lag_seconds',
    ]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
    expect(registry.contentType).toContain('text/plain');
  });
});
