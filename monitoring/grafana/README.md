# Grafana dashboard

`secretly-dashboard.json` is a Grafana dashboard for the bot's Prometheus
metrics. Import it as-is, or provision it from your GitOps repo (for example
as a ConfigMap labelled for the Grafana sidecar). It has a stable UID,
`secretly-overview`.

## Requirements

- Prometheus scraping `/metrics` on the app's `http` port. With the Helm
  chart, set `monitoring.enabled` and `monitoring.serviceMonitor.enabled`.
  This also adds a NetworkPolicy rule for the namespace in
  `monitoring.serviceMonitor.prometheusNamespaceSelector` (default:
  `kubernetes.io/metadata.name: monitoring`).
- A Prometheus data source. The dashboard asks for one through its
  `datasource` variable, then filters by `namespace` and `job`.

## Rows

| Row | Shows |
| --- | --- |
| Overview | Totals for the selected range: messages scanned and obfuscated, sensitive values found, p95 processing time, processing errors, secrets left visible (delete failed) |
| Detections | Obfuscated messages by severity, detections by type, and range totals for each |
| Pipeline | Scanned vs skipped (rate limited, channel disabled, user exempted), p50/p95/p99 processing time, errors |
| Dismissals and configuration | Dismissal requests and config modal submissions by outcome |
| Runtime | Pods up, CPU, resident memory, event loop lag |

Metric labels are limited to detector type, severity, reason and outcome.
Channel and user IDs are never exported.

## Colors

Severity is ordered, so it uses one blue ramp from light (low) to dark
(critical). Detector types use a fixed categorical order, so each type
keeps its color when others are filtered out. Red is used only for the
error tiles.
