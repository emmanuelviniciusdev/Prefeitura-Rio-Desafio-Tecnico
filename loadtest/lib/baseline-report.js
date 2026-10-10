import { ROUTES, SUMMARY_TREND_STATS } from './config.js';

export const ROUTE_ORDER = [ROUTES.create, ROUTES.updateStatus, ROUTES.read];

export function parseMetricKey(key) {
  const brace = key.indexOf('{');
  if (brace === -1) {
    return { name: key, tags: {} };
  }

  const name = key.slice(0, brace);
  const body = key.endsWith('}') ? key.slice(brace + 1, -1) : key.slice(brace + 1);
  const tags = {};
  for (const part of body.match(/(?:[^,"]|"(?:\\.|[^"])*")+/g) || []) {
    const separator = part.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const tag = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    tags[tag] = value;
  }

  return { name, tags };
}

export function findMetric(metrics, metricName, expectedTags) {
  let best = null;
  let bestExtra = Infinity;

  for (const [key, metric] of Object.entries(metrics || {})) {
    const parsed = parseMetricKey(key);
    if (parsed.name !== metricName) {
      continue;
    }

    const expected = Object.entries(expectedTags);
    const matches = expected.every(([tag, value]) => parsed.tags[tag] === value);
    if (!matches) {
      continue;
    }

    const extra = Object.keys(parsed.tags).length - expected.length;
    if (extra < bestExtra) {
      best = metric;
      bestExtra = extra;
    }
  }

  return best;
}

export function emptyTrend() {
  return { avg: null, med: null, p50: null, p90: null, p95: null, p99: null, max: null };
}

export function trendStats(metric) {
  const values = metric && metric.values ? metric.values : {};
  const stats = {};
  for (const key of SUMMARY_TREND_STATS) {
    const value = values[key];
    stats[trendName(key)] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  stats.p50 = stats.med;
  return stats;
}

function trendName(key) {
  if (key === 'p(90)') return 'p90';
  if (key === 'p(95)') return 'p95';
  if (key === 'p(99)') return 'p99';
  return key;
}

export function metricCount(metric) {
  const value = metric && metric.values ? metric.values.count : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function rateValue(metric) {
  const value = metric && metric.values ? metric.values.rate : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function markdownTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, index) => Math.max(...all.map((row) => String(row[index]).length)));
  const format = (row) => `| ${row.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ')} |`;
  return [
    format(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(format),
  ].join('\n');
}

export function formatMs(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

export function formatShare(value) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(value * 100).toFixed(2)}%`;
}

export function formatRate(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

export function formatCount(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

export function formatSeconds(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (value < 1) {
    return `${(value * 1000).toFixed(0)} ms`;
  }
  return `${value.toFixed(3)} s`;
}

export function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const mib = value / (1024 * 1024);
  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(2)} GiB`;
  }
  if (mib >= 1) {
    return `${mib.toFixed(1)} MiB`;
  }
  return `${(value / 1024).toFixed(0)} KiB`;
}

export function formatCpu(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}
