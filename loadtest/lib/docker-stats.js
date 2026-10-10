import { CONTAINER_LIMITS } from './config.js';

const MEMORY_UNITS = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

export function aggregateDockerStats(raw, window) {
  const buckets = new Map();
  for (const line of String(raw).split('\n')) {
    const sample = parseStatsLine(line);
    if (!sample || !inWindow(sample.sampledAt, window)) {
      continue;
    }

    const current = buckets.get(sample.container) || {
      container: sample.container,
      service: serviceName(sample.container),
      cpu: [],
      memory: [],
    };
    if (sample.cpuPercent !== null) {
      current.cpu.push(sample.cpuPercent);
    }
    if (sample.memoryBytes !== null) {
      current.memory.push(sample.memoryBytes);
    }
    buckets.set(sample.container, current);
  }

  return [...buckets.values()].map((bucket) => ({
    container: bucket.container,
    service: bucket.service,
    samples: Math.max(bucket.cpu.length, bucket.memory.length),
    cpuPercentAvg: average(bucket.cpu),
    cpuPercentMax: maximum(bucket.cpu),
    memoryBytesAvg: average(bucket.memory),
    memoryBytesMax: maximum(bucket.memory),
  }));
}

export function aggregateDockerLimits(raw) {
  const limits = new Map();
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const container = String(parsed.name || '').replace(/^\//, '');
    if (!container || !isExperimentContainer(container)) {
      continue;
    }

    limits.set(container, {
      container,
      service: serviceName(container),
      cpuLimit: nanoCpusToCpus(parsed.nanoCpus),
      memoryLimitBytes: positiveNumber(parsed.memory),
    });
  }

  return [...limits.values()];
}

export function attachResources(report, stats, limits) {
  const declared = new Map(
    (report.conditions && report.conditions.containers
      ? report.conditions.containers
      : CONTAINER_LIMITS
    ).map((row) => [row.service, row]),
  );
  const measured = new Map(stats.map((row) => [row.service, row]));
  const enforced = new Map(limits.map((row) => [row.service, row]));
  const services = [];

  for (const service of declared.keys()) {
    services.push(service);
  }
  for (const service of measured.keys()) {
    if (!services.includes(service)) {
      services.push(service);
    }
  }

  const resources = services.map((service) => {
    const planned = declared.get(service) || {};
    const usage = measured.get(service) || {};
    const actual = enforced.get(service) || {};
    const enforcedCpu = actual.cpuLimit ?? parseCpuLimit(planned.cpus);
    const enforcedMemoryBytes = actual.memoryLimitBytes ?? parseMemoryLimit(planned.memory);
    return {
      service,
      container: usage.container || actual.container || planned.container || service,
      samples: usage.samples || 0,
      cpuPercentAvg: usage.cpuPercentAvg ?? null,
      cpuPercentMax: usage.cpuPercentMax ?? null,
      memoryBytesAvg: usage.memoryBytesAvg ?? null,
      memoryBytesMax: usage.memoryBytesMax ?? null,
      cpuLimit: planned.cpus || null,
      memoryLimit: planned.memory || null,
      enforcedCpu,
      enforcedMemoryBytes,
      cpuLimitPercentAvg: cpuPercentOfLimit(usage.cpuPercentAvg, enforcedCpu),
      cpuLimitPercentMax: cpuPercentOfLimit(usage.cpuPercentMax, enforcedCpu),
      memoryLimitPercentAvg: memoryPercentOfLimit(usage.memoryBytesAvg, enforcedMemoryBytes),
      memoryLimitPercentMax: memoryPercentOfLimit(usage.memoryBytesMax, enforcedMemoryBytes),
    };
  });

  return {
    ...report,
    resources,
    resourcesMeta: {
      source: 'docker stats',
      intervalSeconds: 5,
    },
  };
}

export function parseCpuPercent(value) {
  const match = /^([0-9]+(?:\.[0-9]+)?)%$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
}

export function parseMemoryUsage(value) {
  const usage = String(value).split('/')[0].trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/.exec(usage);
  if (!match) {
    return null;
  }

  const unit = MEMORY_UNITS[match[2].toLowerCase()];
  if (!unit) {
    return null;
  }

  return Number(match[1]) * unit;
}

function parseStatsLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const container = String(parsed.Name || parsed.Container || '').replace(/^\//, '');
  if (!container || !isExperimentContainer(container)) {
    return null;
  }

  return {
    container,
    sampledAt: parseTimestamp(parsed.sampledAt),
    cpuPercent: parseCpuPercent(parsed.CPUPerc || ''),
    memoryBytes: parseMemoryUsage(parsed.MemUsage || ''),
  };
}

export function parseCpuStat(raw) {
  const values = {};
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.search(/\s+/);
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator);
    const number = Number(trimmed.slice(separator).trim());
    if (Number.isFinite(number)) {
      values[key] = number;
    }
  }

  const throttledTimeNs =
    values.throttled_time ??
    (values.throttled_usec !== undefined ? values.throttled_usec * 1000 : null);

  return {
    nrPeriods: values.nr_periods ?? null,
    nrThrottled: values.nr_throttled ?? null,
    throttledTimeNs: throttledTimeNs ?? null,
  };
}

export function inferRunStartedAt(inspectRaw, statsRaw) {
  const inspect = parseJsonl(inspectRaw);
  for (const row of inspect) {
    const name = String(row.name || row.Name || '');
    if (!name.includes('k6') || typeof row.startedAt !== 'string') {
      continue;
    }
    const millis = Date.parse(row.startedAt);
    if (Number.isFinite(millis)) {
      return new Date(millis).toISOString();
    }
  }

  const stats = parseJsonl(statsRaw);
  for (const row of stats) {
    const sampledAt = parseTimestamp(row.sampledAt);
    if (sampledAt) {
      return sampledAt;
    }
  }

  return null;
}

export function parseJsonl(raw) {
  const rows = [];
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return rows;
}

export function inWindow(timestamp, window) {
  if (!window) {
    return true;
  }
  const value = parseTimestamp(timestamp);
  if (!value) {
    return false;
  }
  const start = Date.parse(window.startedAt);
  const end = Date.parse(window.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }
  const millis = Date.parse(value);
  return millis >= start && millis < end;
}

export function cpuPercentOfLimit(cpuPercent, cpuLimit) {
  if (!Number.isFinite(cpuPercent) || !Number.isFinite(cpuLimit) || cpuLimit <= 0) {
    return null;
  }
  return cpuPercent / cpuLimit;
}

export function memoryPercentOfLimit(memoryBytes, limitBytes) {
  if (!Number.isFinite(memoryBytes) || !Number.isFinite(limitBytes) || limitBytes <= 0) {
    return null;
  }
  return (memoryBytes / limitBytes) * 100;
}

export function aggregateInspect(raw, window) {
  const samples = parseJsonl(raw)
    .map(normalizeInspect)
    .filter((sample) => sample && sample.sampledAt)
    .sort((left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt));

  const start = window ? Date.parse(window.startedAt) : null;
  const end = window ? Date.parse(window.finishedAt) : Number.POSITIVE_INFINITY;
  const buckets = new Map();

  for (const sample of samples) {
    const millis = Date.parse(sample.sampledAt);
    const current = buckets.get(sample.container) || {
      container: sample.container,
      service: serviceName(sample.container),
      before: null,
      inside: [],
    };
    if (Number.isFinite(start) && millis < start) {
      current.before = sample;
    } else if (!Number.isFinite(start) || (millis >= start && millis < end)) {
      current.inside.push(sample);
    }
    buckets.set(sample.container, current);
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.before || bucket.inside.length > 0)
    .map((bucket) => {
      const baseline = bucket.before || bucket.inside[0];
      const last = bucket.inside[bucket.inside.length - 1] || baseline;
      return {
        container: bucket.container,
        service: bucket.service,
        oomKilled: bucket.inside.some((sample) => sample.oomKilled),
        restartCount: last.restartCount,
        restartDelta: Math.max(0, last.restartCount - baseline.restartCount),
        lastStatus: last.status,
      };
    });
}

export function aggregateCpuThrottling(raw, window) {
  const samples = parseJsonl(raw)
    .map(normalizeCpuSample)
    .filter((sample) => sample && sample.sampledAt)
    .sort((left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt));

  const start = window ? Date.parse(window.startedAt) : null;
  const end = window ? Date.parse(window.finishedAt) : Number.POSITIVE_INFINITY;
  const buckets = new Map();

  for (const sample of samples) {
    const millis = Date.parse(sample.sampledAt);
    const current = buckets.get(sample.container) || {
      container: sample.container,
      service: serviceName(sample.container),
      before: null,
      inside: [],
    };
    if (Number.isFinite(start) && millis < start) {
      current.before = sample;
    } else if (!Number.isFinite(start) || (millis >= start && millis < end)) {
      current.inside.push(sample);
    }
    buckets.set(sample.container, current);
  }

  const missingHint =
    'cpu.stat unavailable inside the container. On Linux, read /sys/fs/cgroup/cpu.stat (v2) or cpu/cpu.stat (v1) from the host cgroup of the container. Docker stats CPU stuck at the limit is a weaker proxy.';

  return [...buckets.values()]
    .filter((bucket) => bucket.before || bucket.inside.length > 0)
    .map((bucket) => {
      const first = bucket.before || bucket.inside[0];
      const last = bucket.inside[bucket.inside.length - 1] || first;
      const available = Boolean(first?.available && last?.available && first.stat && last.stat);
      return {
        container: bucket.container,
        service: bucket.service,
        available,
        samples: bucket.inside.length,
        nrThrottledDelta:
          available && last.stat.nrThrottled !== null && first.stat.nrThrottled !== null
            ? Math.max(0, last.stat.nrThrottled - first.stat.nrThrottled)
            : null,
        throttledTimeNsDelta:
          available && last.stat.throttledTimeNs !== null && first.stat.throttledTimeNs !== null
            ? Math.max(0, last.stat.throttledTimeNs - first.stat.throttledTimeNs)
            : null,
        hint: available ? null : missingHint,
      };
    });
}

export function aggregateRabbitmq(raw, window) {
  const samples = parseJsonl(raw).filter((sample) => inWindow(sample.sampledAt, window));
  if (samples.length === 0) {
    return {
      available: false,
      memAlarm: null,
      diskAlarm: null,
      blockedConnectionsMax: null,
      hint: 'RabbitMQ management API was not sampled. Open http://localhost:15672 (admin/admin) and check Nodes → memory alarm and Connections with state=blocked, or run: docker exec taxi-rio-rabbitmq rabbitmq-diagnostics check_local_alarms',
    };
  }

  const available = samples.some((sample) => sample.available);
  if (!available) {
    return {
      available: false,
      memAlarm: null,
      diskAlarm: null,
      blockedConnectionsMax: null,
      hint: samples[0].hint ||
        'Prometheus does not scrape RabbitMQ. Use the management UI at http://localhost:15672 or rabbitmq-diagnostics check_local_alarms.',
    };
  }

  return {
    available: true,
    memAlarm: samples.some((sample) => sample.memAlarm),
    diskAlarm: samples.some((sample) => sample.diskAlarm),
    blockedConnectionsMax: maximum(
      samples.map((sample) => sample.blockedConnections).filter((value) => Number.isFinite(value)),
    ),
    hint: null,
  };
}

export function aggregateMysql(raw, window) {
  const samples = parseJsonl(raw).filter((sample) => inWindow(sample.sampledAt, window));
  if (samples.length === 0 || !samples.some((sample) => sample.available)) {
    return {
      available: false,
      threadsConnectedMax: null,
      threadsRunningMax: null,
      maxUsedConnections: null,
      maxConnections: null,
      hint: 'MySQL status was not sampled. The API does not export pool metrics; infer saturation from write latency vs API CPU, or run SHOW GLOBAL STATUS LIKE \'Threads_%\' inside taxi-rio-mysql.',
    };
  }

  const available = samples.filter((sample) => sample.available);
  return {
    available: true,
    threadsConnectedMax: maximum(available.map((sample) => sample.threadsConnected)),
    threadsRunningMax: maximum(available.map((sample) => sample.threadsRunning)),
    maxUsedConnections: maximum(available.map((sample) => sample.maxUsedConnections)),
    maxConnections: available[0].maxConnections ?? null,
    hint: null,
  };
}

function normalizeInspect(parsed) {
  const container = String(parsed.name || parsed.Name || '').replace(/^\//, '');
  if (!container || !isExperimentContainer(container)) {
    return null;
  }

  return {
    container,
    sampledAt: parseTimestamp(parsed.sampledAt),
    oomKilled: Boolean(parsed.oomKilled || parsed.OOMKilled),
    restartCount: Number.isFinite(Number(parsed.restartCount)) ? Number(parsed.restartCount) : 0,
    status: typeof parsed.status === 'string' ? parsed.status : '',
  };
}

function normalizeCpuSample(parsed) {
  const container = String(parsed.container || parsed.name || '').replace(/^\//, '');
  if (!container) {
    return null;
  }

  const raw = parsed.raw || '';
  const available = parsed.available !== false && Boolean(raw);
  return {
    container,
    sampledAt: parseTimestamp(parsed.sampledAt),
    available,
    stat: available ? parseCpuStat(raw) : null,
  };
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function parseCpuLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseMemoryLimit(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^([0-9]+(?:\.[0-9]+)?)(k|m|g)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const quantity = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : 1024;
  return quantity * multiplier;
}

function isExperimentContainer(name) {
  return name.startsWith('taxi-rio-') || name.includes('k6');
}

function serviceName(container) {
  const declared = CONTAINER_LIMITS.find((row) => row.container === container);
  if (declared) {
    return declared.service;
  }
  if (container.includes('k6')) {
    return 'k6';
  }
  return container.replace(/^taxi-rio-/, '');
}

function nanoCpusToCpus(value) {
  const nano = positiveNumber(value);
  return nano === null ? null : nano / 1e9;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}
