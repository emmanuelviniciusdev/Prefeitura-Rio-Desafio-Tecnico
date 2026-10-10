import { ROUTES } from './config.js';
import {
  QUEUE_CREATED,
  QUEUE_STATUS,
  observationWindow,
  prometheusQueries,
} from './prometheus-queries.js';

export async function queryPrometheusAt(prometheusUrl, promql, timeIso) {
  const time = toUnix(timeIso);
  const endpoint = `${trimSlash(prometheusUrl)}/api/v1/query?query=${encodeURIComponent(promql)}${time ? `&time=${time}` : ''}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!body || body.status !== 'success' || !body.data) {
    throw new Error('unexpected payload');
  }

  const series = body.data.result || [];
  if (series.length === 0) {
    return null;
  }

  const value = Number(series[0].value[1]);
  return Number.isFinite(value) ? value : null;
}

export async function observeStep(prometheusUrl, window) {
  const duration = window.duration || '1m';
  const queries = prometheusQueries(observationWindow(duration));
  const values = {};
  let available = false;

  for (const [key, promql] of Object.entries(queries)) {
    try {
      values[key] = await queryPrometheusAt(prometheusUrl, promql, window.finishedAt);
      available = true;
    } catch (error) {
      values[key] = null;
      if (String(error.message) === 'HTTP 0' || error.name === 'TimeoutError' || error.name === 'AbortError') {
        break;
      }
    }
  }

  return {
    tag: window.tag,
    rate: window.rate,
    available,
    window: {
      startedAt: window.startedAt,
      finishedAt: window.finishedAt,
      duration,
    },
    api5xxRatio: values.api5xxRatio ?? null,
    apiLatencyP95Ms: secondsToMs(values.apiLatencyP95Seconds),
    routes: [
      { route: ROUTES.create, latencyP95Ms: secondsToMs(values.apiLatencyPostP95Seconds) },
      { route: ROUTES.updateStatus, latencyP95Ms: secondsToMs(values.apiLatencyPatchP95Seconds) },
      { route: ROUTES.read, latencyP95Ms: secondsToMs(values.apiLatencyGetP95Seconds) },
    ],
    queues: [
      {
        queue: QUEUE_CREATED,
        depthP50: values.queueDepthCriadaP50 ?? null,
        depthMax: values.queueDepthCriadaMax ?? null,
        lagP95Seconds: values.workerLagCriadaP95 ?? null,
      },
      {
        queue: QUEUE_STATUS,
        depthP50: values.queueDepthStatusP50 ?? null,
        depthMax: values.queueDepthStatusMax ?? null,
        lagP95Seconds: values.workerLagStatusP95 ?? null,
      },
    ],
  };
}

function secondsToMs(value) {
  return value === null || value === undefined ? null : value * 1000;
}

function toUnix(iso) {
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? (millis / 1000).toFixed(3) : '';
}

function trimSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
