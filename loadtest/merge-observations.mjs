import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_K6_CPUS,
  DEFAULT_STEP_DURATION,
  STRESS_K6_MEMORY,
  STRESS_MAX_VUS,
  STRESS_PRE_ALLOCATED_VUS,
  STRESS_WARMUP_RATE,
  readDuration,
  readSteps,
  readVus,
  readWarmupRate,
} from './lib/config.js';
import {
  aggregateCpuThrottling,
  aggregateDockerLimits,
  aggregateDockerStats,
  aggregateInspect,
  aggregateMysql,
  aggregateRabbitmq,
  attachResources,
  inferRunStartedAt,
  parseJsonl,
} from './lib/docker-stats.js';
import { observeStep } from './lib/prometheus-observe.js';
import {
  buildPartialStressReport,
  deriveFindings,
  renderStressReport,
} from './lib/stress-report.js';

const argv = process.argv.slice(2).filter((arg) => arg !== '--partial');
const partial = process.argv.includes('--partial');
const summaryPath = argv[0];
const statsPath = argv[1];
const limitsPath = argv[2];
const inspectPath = argv[3];
const cgroupPath = argv[4];
const rabbitmqPath = argv[5];
const mysqlPath = argv[6];

if (!summaryPath || !statsPath || !limitsPath) {
  console.error(
    'Usage: node loadtest/merge-observations.mjs [--partial] <summary.json> <docker-stats.jsonl> <docker-limits.jsonl> [inspect.jsonl] [cgroup.jsonl] [rabbitmq.jsonl] [mysql.jsonl]',
  );
  process.exit(1);
}

const statsRaw = readOptional(statsPath);
const limitsRaw = readOptional(limitsPath);
const inspectRaw = readOptional(inspectPath);
const cgroupRaw = readOptional(cgroupPath);
const rabbitmqRaw = readOptional(rabbitmqPath);
const mysqlRaw = readOptional(mysqlPath);

let report;
if (partial || !existsSync(summaryPath)) {
  report = buildPartialStressReport({
    steps: readSteps(process.env.STEPS),
    stepDuration: readDuration(process.env.STEP_DURATION, DEFAULT_STEP_DURATION, 'STEP_DURATION'),
    warmupRate: readWarmupRate(process.env.WARMUP_RATE, STRESS_WARMUP_RATE),
    preAllocatedVUs: readVus(process.env.PRE_ALLOCATED_VUS, STRESS_PRE_ALLOCATED_VUS, 'PRE_ALLOCATED_VUS'),
    maxVUs: readVus(process.env.MAX_VUS, STRESS_MAX_VUS, 'MAX_VUS'),
    k6Cpus: (process.env.K6_CPUS || DEFAULT_K6_CPUS).trim(),
    k6Memory: (process.env.K6_MEMORY || STRESS_K6_MEMORY).trim(),
    startedAt: inferRunStartedAt(inspectRaw, statsRaw),
    finishedAt: lastSampledAt(statsRaw, inspectRaw),
    generatedAt: new Date().toISOString(),
  });
} else {
  report = JSON.parse(readFileSync(summaryPath, 'utf8'));
}

const updated = await mergeStress(report);

writeFileSync(summaryPath, `${JSON.stringify(updated, null, 2)}\n`);
process.stdout.write(renderStressReport(updated));

async function mergeStress(base) {
  const limits = aggregateDockerLimits(limitsRaw);
  const withResources = attachResources(base, aggregateDockerStats(statsRaw), limits);
  const windows = (base.timeline && base.timeline.steps) || [];

  const resourcesByStep = windows.map((window) => ({
    tag: window.tag,
    rate: window.rate,
    resources: attachResources(
      base,
      aggregateDockerStats(statsRaw, window),
      limits,
    ).resources,
  }));
  const restartsByStep = windows.map((window) => ({
    tag: window.tag,
    rate: window.rate,
    containers: aggregateInspect(inspectRaw, window),
  }));
  const cpuThrottlingByStep = windows.map((window) => ({
    tag: window.tag,
    rate: window.rate,
    containers: aggregateCpuThrottling(cgroupRaw, window),
  }));
  const rabbitmqByStep = windows.map((window) => ({
    tag: window.tag,
    rate: window.rate,
    ...aggregateRabbitmq(rabbitmqRaw, window),
  }));
  const mysqlByStep = windows.map((window) => ({
    tag: window.tag,
    rate: window.rate,
    ...aggregateMysql(mysqlRaw, window),
  }));

  const prometheusUrl = process.env.PROMETHEUS_HOST_URL || 'http://localhost:9090';
  let prometheusByStep = [];
  try {
    prometheusByStep = await Promise.all(
      windows.map((window) => observeStep(prometheusUrl, window)),
    );
  } catch (error) {
    console.warn(`Prometheus observation failed: ${error.message}`);
  }

  const findings = deriveFindings(base.steps || [], {
    restartsByStep,
    cpuThrottlingByStep,
    prometheusByStep,
    resourcesByStep,
  });

  return {
    ...withResources,
    findings,
    prometheusByStep,
    resourcesByStep,
    restartsByStep,
    cpuThrottlingByStep,
    rabbitmqByStep,
    mysqlByStep,
  };
}

function lastSampledAt(stats, inspect) {
  let latest = null;
  for (const row of [...parseJsonl(stats), ...parseJsonl(inspect)]) {
    const value = row.sampledAt;
    if (typeof value === 'string' && (!latest || value > latest)) {
      latest = value;
    }
  }
  return latest;
}

function readOptional(path) {
  if (!path || !existsSync(path)) {
    return '';
  }
  return readFileSync(path, 'utf8');
}
