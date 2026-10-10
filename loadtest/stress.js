// Stress load: sequential arrival-rate steps until the system bends.
// The goal is the inflection point (p95/p99 rising while p50 stays put),
// the first saturated resource, and the evidence — not a pass/fail gate.
//
// Run from the repo root, with the stack already up:
//   ./loadtest/run-stress.sh
//
// STEPS (default "10,25,50,75,100,150,200") and STEP_DURATION (default 1m)
// override the ramp. TOKEN_PASSAGEIRO and TOKEN_MOTORISTA must be set. The
// runner requests short-lived tokens from the public generate-token endpoints
// when those variables are absent, and passes them only through the environment.

import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Gauge } from 'k6/metrics';
import {
  DEFAULT_K6_CPUS,
  DEFAULT_K6_MEMORY,
  DEFAULT_STEP_DURATION,
  PASSENGER_USER_ID,
  ROUTES,
  STRESS_FINAL_STATUS,
  STRESS_MAX_VUS,
  STRESS_PRE_ALLOCATED_VUS,
  STRESS_STATUS_SEQUENCE,
  STRESS_WARMUP_RATE,
  SUMMARY_TREND_STATS,
  WARMUP_DURATION,
  WARMUP_MAX_VUS,
  WARMUP_PRE_ALLOCATED_VUS,
  durationToSeconds,
  missingTokenMessage,
  readDuration,
  readSteps,
  readVus,
  readWarmupRate,
  stepTag,
  stressThresholds,
  vusForRate,
} from './lib/config.js';
import {
  authHeaders,
  jsonHeaders,
  readRideId,
  readStatus,
  trimSlash,
  uuidv4,
} from './lib/k6-http.js';
import { buildStressReport, renderStressReport } from './lib/stress-report.js';

const steps = readSteps(__ENV.STEPS);
const stepDuration = readDuration(__ENV.STEP_DURATION, DEFAULT_STEP_DURATION, 'STEP_DURATION');
const warmupRate = readWarmupRate(__ENV.WARMUP_RATE, STRESS_WARMUP_RATE);
const preAllocatedVUs = readVus(
  __ENV.PRE_ALLOCATED_VUS,
  STRESS_PRE_ALLOCATED_VUS,
  'PRE_ALLOCATED_VUS',
);
const maxVUs = readVus(__ENV.MAX_VUS, STRESS_MAX_VUS, 'MAX_VUS');
const k6Cpus = (__ENV.K6_CPUS || DEFAULT_K6_CPUS).trim();
const k6Memory = (__ENV.K6_MEMORY || DEFAULT_K6_MEMORY).trim();
const baseUrl = trimSlash(__ENV.BASE_URL || 'http://localhost:3000');
const summaryPath = __ENV.SUMMARY_PATH || 'loadtest/results/stress-summary.json';
const stepTags = steps.map(stepTag);

if (preAllocatedVUs > maxVUs) {
  throw new Error(
    `PRE_ALLOCATED_VUS (${preAllocatedVUs}) must be <= MAX_VUS (${maxVUs}).`,
  );
}

const statusDesatualizado = new Counter('status_desatualizado');
const httpStatus2xx = new Counter('http_status_2xx');
const httpStatus4xx = new Counter('http_status_4xx');
const httpStatus5xx = new Counter('http_status_5xx');
const httpStatus0 = new Counter('http_status_0');
const testStartedAtSeconds = new Gauge('obs_test_started_at_seconds');

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: SUMMARY_TREND_STATS,
  summaryTimeUnit: 'ms',
  // Drop URL (ride id cardinality) and status/error tags so p50/p95/p99 stay
  // one series per step and route. HTTP status classes are custom counters.
  systemTags: ['method', 'name', 'check', 'scenario', 'group'],
  // One constant-arrival-rate scenario per step, sequenced by startTime.
  // A single ramping-arrival-rate scenario only exposes one latency
  // distribution for the whole ramp, so it cannot show p50/p95/p99 per step.
  // Arrival-rate executors keep offering the configured rate even when the
  // system slows down; a VU-based executor would silently reduce load as
  // iteration time grows. gracefulStop is 0s on intermediate steps so the
  // next rate does not overlap the previous one.
  scenarios: buildScenarios(),
  thresholds: stressThresholds(stepTags),
};

export function setup() {
  const tokenError = missingTokenMessage(__ENV);
  if (tokenError) {
    exec.test.abort(tokenError);
  }

  const health = http.get(`${baseUrl}/`, {
    tags: { name: 'GET /', phase: 'setup' },
    timeout: '10s',
    responseCallback: http.expectedStatuses(200),
  });
  if (health.status !== 200) {
    exec.test.abort(
      `API is not healthy at ${baseUrl}/ (HTTP ${health.status}). Aborting the stress run.`,
    );
  }

  testStartedAtSeconds.add(Date.now() / 1000);
}

export function stressIteration() {
  const passenger = __ENV.TOKEN_PASSAGEIRO.trim();
  const driver = __ENV.TOKEN_MOTORISTA.trim();

  const created = track(http.post(
    `${baseUrl}/corridas`,
    JSON.stringify({
      userId: PASSENGER_USER_ID,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      dhInicio: '2026-10-08T15:00:00.000Z',
    }),
    {
      headers: jsonHeaders(passenger, { 'Idempotency-Key': uuidv4() }),
      tags: { name: ROUTES.create },
      responseType: 'text',
      responseCallback: http.expectedStatuses(201),
    },
  ));
  const createdOk = check(created, {
    'POST /corridas returned 201': (response) => response.status === 201,
  });
  const rideId = createdOk ? readRideId(created) : null;
  if (!rideId) {
    return;
  }

  for (const statusCorrida of STRESS_STATUS_SEQUENCE) {
    const patched = track(http.patch(
      `${baseUrl}/corridas/${rideId}/status`,
      JSON.stringify({ statusCorrida }),
      {
        headers: jsonHeaders(driver),
        tags: { name: ROUTES.updateStatus },
        responseCallback: http.expectedStatuses(200),
      },
    ));
    const patchedOk = check(patched, {
      'PATCH /corridas/:id/status returned 200': (response) => response.status === 200,
    });
    if (!patchedOk) {
      return;
    }
  }

  // Correctness of cache invalidation after the finished transition.
  // The three reads after this one are the repeated cache-hit traffic.
  const fresh = track(http.get(`${baseUrl}/corridas/${rideId}`, {
    headers: authHeaders(passenger),
    tags: { name: ROUTES.read },
    responseType: 'text',
    responseCallback: http.expectedStatuses(200),
  }));
  const statusMatches = check(fresh, {
    'GET /corridas/:id returned the updated status': (response) =>
      response.status === 200 && readStatus(response) === STRESS_FINAL_STATUS,
  });
  if (exec.scenario.name !== 'warmup' && !statusMatches) {
    statusDesatualizado.add(1);
  }

  for (let index = 0; index < 3; index += 1) {
    track(http.get(`${baseUrl}/corridas/${rideId}`, {
      headers: authHeaders(passenger),
      tags: { name: ROUTES.read },
      responseCallback: http.expectedStatuses(200),
    }));
  }
}

export function handleSummary(data) {
  const generatedAt = new Date().toISOString();
  try {
    const report = buildStressReport({
      metrics: data.metrics,
      steps,
      stepDuration,
      warmupRate,
      preAllocatedVUs,
      maxVUs,
      k6Cpus,
      k6Memory,
      startedAt: readStartedAt(data, generatedAt),
      finishedAt: generatedAt,
      generatedAt,
    });

    return {
      [summaryPath]: `${JSON.stringify(report, null, 2)}\n`,
      stdout: renderStressReport(report),
    };
  } catch (error) {
    const fallback = `${JSON.stringify({
      scenario: 'stress',
      partial: true,
      generatedAt,
      error: String(error && error.message ? error.message : error),
    }, null, 2)}\n`;
    return {
      [summaryPath]: fallback,
      stdout: `handleSummary failed: ${error}\n`,
    };
  }
}

function buildScenarios() {
  const scenarios = {
    warmup: {
      executor: 'constant-arrival-rate',
      exec: 'stressIteration',
      rate: warmupRate,
      timeUnit: '1s',
      duration: WARMUP_DURATION,
      preAllocatedVUs: WARMUP_PRE_ALLOCATED_VUS,
      maxVUs: WARMUP_MAX_VUS,
      gracefulStop: '0s',
      tags: { phase: 'warmup', step: 'warmup' },
    },
  };

  let startSeconds = durationToSeconds(WARMUP_DURATION);
  const stepSeconds = durationToSeconds(stepDuration);
  for (const [index, rate] of steps.entries()) {
    const tag = stepTag(rate);
    const isLast = index === steps.length - 1;
    const vus = vusForRate(rate, preAllocatedVUs, maxVUs);
    scenarios[tag] = {
      executor: 'constant-arrival-rate',
      exec: 'stressIteration',
      rate,
      timeUnit: '1s',
      duration: stepDuration,
      preAllocatedVUs: vus.preAllocatedVUs,
      maxVUs: vus.maxVUs,
      startTime: `${startSeconds}s`,
      gracefulStop: isLast ? '10s' : '0s',
      tags: { phase: 'stress', step: tag },
    };
    startSeconds += stepSeconds;
  }

  return scenarios;
}

function track(response) {
  const status = response.status;
  if (status === 0) {
    httpStatus0.add(1);
  } else if (status >= 200 && status < 300) {
    httpStatus2xx.add(1);
  } else if (status >= 400 && status < 500) {
    httpStatus4xx.add(1);
  } else if (status >= 500) {
    httpStatus5xx.add(1);
  }
  return response;
}

function readStartedAt(data, generatedAt) {
  const gauge = data.metrics && data.metrics.obs_test_started_at_seconds;
  const seconds = gauge && gauge.values ? gauge.values.value : null;
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }

  const durationMs = data.state && data.state.testRunDurationMs;
  const finished = Date.parse(generatedAt);
  if (Number.isFinite(durationMs) && Number.isFinite(finished)) {
    return new Date(finished - durationMs).toISOString();
  }

  return generatedAt;
}
