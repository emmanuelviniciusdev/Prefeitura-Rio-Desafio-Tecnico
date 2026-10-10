import { durationToSeconds } from './config.js';

export const QUEUE_CREATED = 'corrida.criada';
export const QUEUE_STATUS = 'corrida.status_alterado';

// Range selector aligned with the measured phase. Queried at teardown, so the
// window ends when the stress step ends and leaves the warmup behind.
export function observationWindow(duration) {
  const seconds = Math.max(1, Math.round(durationToSeconds(duration)));
  return `${seconds}s`;
}

export function prometheusQueries(window) {
  return {
    queueDepthCriadaP50: queueDepthQuantile(QUEUE_CREATED, 0.5, window),
    queueDepthCriadaMax: queueDepthMax(QUEUE_CREATED, window),
    queueDepthStatusP50: queueDepthQuantile(QUEUE_STATUS, 0.5, window),
    queueDepthStatusMax: queueDepthMax(QUEUE_STATUS, window),
    workerLagCriadaP95: workerLagP95(QUEUE_CREATED, window),
    workerLagStatusP95: workerLagP95(QUEUE_STATUS, window),
    api5xxRatio: api5xxRatio(window),
    apiLatencyP95Seconds: apiLatencyP95(window),
    apiLatencyPostP95Seconds: apiRouteLatencyP95('POST', '/corridas', window),
    apiLatencyPatchP95Seconds: apiRouteLatencyP95(
      'PATCH',
      '/corridas/:id/status',
      window,
    ),
    apiLatencyGetP95Seconds: apiRouteLatencyP95('GET', '/corridas/:id', window),
  };
}

function queueDepthQuantile(queue, quantile, window) {
  return `max(quantile_over_time(${quantile}, queue_messages{queue="${queue}"}[${window}]))`;
}

function queueDepthMax(queue, window) {
  return `max(max_over_time(queue_messages{queue="${queue}"}[${window}]))`;
}

function workerLagP95(queue, window) {
  return `histogram_quantile(0.95, sum by (le) (rate(queue_delay_seconds_bucket{queue="${queue}"}[${window}])))`;
}

function api5xxRatio(window) {
  return `(sum(rate(http_request_errors_total{service="taxi-rio-api"}[${window}])) or vector(0)) / sum(rate(http_requests_total{service="taxi-rio-api"}[${window}]))`;
}

function apiLatencyP95(window) {
  return `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="taxi-rio-api"}[${window}])))`;
}

function apiRouteLatencyP95(method, route, window) {
  return `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="taxi-rio-api",method="${method}",route="${route}"}[${window}])))`;
}
