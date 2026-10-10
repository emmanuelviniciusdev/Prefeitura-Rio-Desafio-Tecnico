import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readSteps,
  readWarmupRate,
  stepTag,
  stressThresholds,
  vusForRate,
} from './config.js';
import {
  aggregateCpuThrottling,
  aggregateInspect,
  cpuPercentOfLimit,
  inferRunStartedAt,
  inWindow,
  parseCpuStat,
} from './docker-stats.js';
import {
  buildPartialStressReport,
  buildStepWindows,
  buildStressReport,
  countStatuses,
  deriveFindings,
  renderStressReport,
} from './stress-report.js';

test('stress steps parse and tag with a padded rate', () => {
  assert.deepEqual(readSteps(undefined), [10, 25, 50, 75, 100, 150, 200]);
  assert.deepEqual(readSteps('10,25,50'), [10, 25, 50]);
  assert.equal(stepTag(10), 'r010');
  assert.equal(stepTag(50), 'r050');
  assert.equal(stepTag(200), 'r200');
  assert.equal(readWarmupRate(undefined), 5);
  assert.throws(() => readSteps('10,10'), /strictly increasing/);
});

test('per-step preAllocated VUs stay below the configured cap', () => {
  assert.deepEqual(vusForRate(10, 200, 800), { preAllocatedVUs: 20, maxVUs: 800 });
  assert.deepEqual(vusForRate(75, 200, 800), { preAllocatedVUs: 150, maxVUs: 800 });
  assert.deepEqual(vusForRate(200, 200, 800), { preAllocatedVUs: 200, maxVUs: 800 });
});

test('partial report is marked when k6 never wrote a summary', () => {
  const report = buildPartialStressReport({
    startedAt: '2026-10-09T12:00:00.000Z',
    steps: [10, 25],
    stepDuration: '1m',
    warmupRate: 5,
    preAllocatedVUs: 200,
    maxVUs: 800,
  });
  assert.equal(report.partial, true);
  assert.match(renderStressReport(report), /Relatório parcial/);
});

test('k6 container StartedAt becomes the run origin', () => {
  assert.equal(
    inferRunStartedAt(
      JSON.stringify({
        name: '/prefeitura-k6-run-1',
        startedAt: '2026-10-09T14:32:53.745753555Z',
      }),
      '',
    ),
    '2026-10-09T14:32:53.745Z',
  );
});

test('stress thresholds never abort', () => {
  const thresholds = stressThresholds(['r010', 'r025']);
  for (const entries of Object.values(thresholds)) {
    for (const entry of entries) {
      assert.equal(entry.abortOnFail, false);
    }
  }
});

test('step windows accumulate startTime from warmup then each duration', () => {
  const windows = buildStepWindows({
    startedAt: '2026-10-09T12:00:00.000Z',
    steps: [10, 25],
    stepDuration: '1m',
    warmupRate: 5,
  });
  assert.equal(windows.warmup.startedAt, '2026-10-09T12:00:00.000Z');
  assert.equal(windows.warmup.finishedAt, '2026-10-09T12:00:30.000Z');
  assert.equal(windows.steps[0].tag, 'r010');
  assert.equal(windows.steps[0].startedAt, '2026-10-09T12:00:30.000Z');
  assert.equal(windows.steps[0].finishedAt, '2026-10-09T12:01:30.000Z');
  assert.equal(windows.steps[1].startedAt, '2026-10-09T12:01:30.000Z');
  assert.equal(windows.steps[1].finishedAt, '2026-10-09T12:02:30.000Z');
});

test('stress report keeps warmup out of per-step stats and records the 4/3 mix', () => {
  const report = buildStressReport({
    generatedAt: '2026-10-09T12:10:00.000Z',
    startedAt: '2026-10-09T12:00:00.000Z',
    steps: [10, 25],
    stepDuration: '1m',
    warmupRate: 5,
    preAllocatedVUs: 200,
    maxVUs: 800,
    metrics: {
      'iterations{scenario:r010}': { values: { count: 600 } },
      'iterations{scenario:r025}': { values: { count: 1500 } },
      'dropped_iterations{scenario:r025}': { values: { count: 12 } },
      'http_req_failed{step:r010}': { values: { rate: 0 } },
      'http_req_failed{step:r025}': { values: { rate: 0.02 } },
      'http_req_duration{step:r010}': {
        values: { avg: 8, med: 7, 'p(90)': 9, 'p(95)': 10, 'p(99)': 12, max: 20 },
      },
      'http_req_duration{step:r025}': {
        values: { avg: 12, med: 8, 'p(90)': 20, 'p(95)': 40, 'p(99)': 80, max: 200 },
      },
      'http_req_duration{step:r010,name:"POST /corridas"}': {
        values: { avg: 9, med: 8, 'p(90)': 10, 'p(95)': 11, 'p(99)': 13, max: 22 },
      },
      'http_status_2xx{step:r010}': { values: { count: 4200 } },
      'http_status_5xx{step:r025}': { values: { count: 40 } },
      'http_status_0{step:r025}': { values: { count: 3 } },
      'status_desatualizado{step:r025}': { values: { count: 2 } },
      'http_req_duration{step:warmup}': { values: { med: 999, 'p(95)': 999 } },
    },
  });

  assert.equal(report.scenario, 'stress');
  assert.equal(report.trafficMix.writesPerIteration, 3);
  assert.equal(report.trafficMix.readShare, 4 / 7);
  assert.deepEqual(report.trafficMix.statusSequence, ['initialized', 'finished']);
  assert.equal(report.steps.length, 2);
  assert.equal(report.steps[0].achievedRatePerSecond, 10);
  assert.equal(report.steps[0].http.durationMs.p95, 10);
  assert.equal(report.steps[0].status.http2xx, 4200);
  assert.equal(report.steps[1].droppedIterations, 12);
  assert.equal(report.steps[1].status.http5xx, 40);
  assert.equal(report.steps[1].status.network, 3);
  assert.equal(report.steps[1].statusDesatualizado, 2);
  assert.equal(report.steps[1].http.durationMs.p95, 40);
  assert.equal(report.findings.inflection.tag, 'r025');
  assert.equal(report.findings.maxSustainableRate, 10);
  const rendered = renderStressReport(report);
  assert.match(rendered, /r010/);
  assert.match(rendered, /initialized → finished/);
  assert.doesNotMatch(rendered, /999/);
});

test('inflection is p95 jumping while p50 stays put', () => {
  const findings = deriveFindings([
    step(10, { p50: 8, p95: 10 }),
    step(25, { p50: 8.5, p95: 11 }),
    step(50, { p50: 9, p95: 80 }),
  ]);
  assert.equal(findings.inflection.tag, 'r050');
  assert.equal(findings.maxSustainableRate, 25);
  assert.match(findings.inflection.evidence, /p95/);
});

test('countStatuses prefers custom counters then http_reqs', () => {
  assert.deepEqual(
    countStatuses(
      { 'http_status_2xx{step:r010}': { values: { count: 10 } } },
      { step: 'r010' },
    ),
    { http2xx: 10, http4xx: 0, http5xx: 0, network: 0, other: 0 },
  );
  assert.equal(
    countStatuses(
      { 'http_reqs{step:r010,status:500}': { values: { count: 4 } } },
      { step: 'r010' },
    ).http5xx,
    4,
  );
});

test('cpu.stat v2 and inspect restart delta use the sample before the window', () => {
  assert.deepEqual(parseCpuStat('nr_periods 9\nnr_throttled 3\nthrottled_usec 1500\n'), {
    nrPeriods: 9,
    nrThrottled: 3,
    throttledTimeNs: 1_500_000,
  });
  assert.equal(cpuPercentOfLimit(25, 0.25), 100);
  assert.equal(
    inWindow('2026-10-09T12:01:00.000Z', {
      startedAt: '2026-10-09T12:00:30.000Z',
      finishedAt: '2026-10-09T12:01:30.000Z',
    }),
    true,
  );

  const window = {
    startedAt: '2026-10-09T12:01:00.000Z',
    finishedAt: '2026-10-09T12:02:00.000Z',
  };
  const inspect = aggregateInspect(
    [
      JSON.stringify({
        sampledAt: '2026-10-09T12:00:50.000Z',
        name: '/taxi-rio-api',
        oomKilled: false,
        restartCount: 1,
        status: 'running',
      }),
      JSON.stringify({
        sampledAt: '2026-10-09T12:01:20.000Z',
        name: '/taxi-rio-api',
        oomKilled: true,
        restartCount: 2,
        status: 'restarting',
      }),
    ].join('\n'),
    window,
  );
  assert.equal(inspect[0].restartDelta, 1);
  assert.equal(inspect[0].oomKilled, true);

  const throttle = aggregateCpuThrottling(
    [
      JSON.stringify({
        sampledAt: '2026-10-09T12:00:50.000Z',
        container: 'taxi-rio-api',
        available: true,
        raw: 'nr_throttled 4\nthrottled_time 1000',
      }),
      JSON.stringify({
        sampledAt: '2026-10-09T12:01:50.000Z',
        container: 'taxi-rio-api',
        available: true,
        raw: 'nr_throttled 10\nthrottled_time 5000',
      }),
    ].join('\n'),
    window,
  );
  assert.equal(throttle[0].nrThrottledDelta, 6);
  assert.equal(throttle[0].throttledTimeNsDelta, 4000);
});

function step(rate, { p50, p95 }) {
  return {
    tag: stepTag(rate),
    configuredRatePerSecond: rate,
    achievedRatePerSecond: rate,
    droppedIterations: 0,
    errorRate: 0,
    generatorLimited: false,
    http: { durationMs: { p50, p95 } },
  };
}
