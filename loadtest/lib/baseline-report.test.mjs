import assert from 'node:assert/strict';
import test from 'node:test';
import { findMetric, parseMetricKey } from './baseline-report.js';
import { CONTAINER_LIMITS, readDuration } from './config.js';
import { aggregateDockerLimits, aggregateDockerStats, attachResources, parseMemoryUsage } from './docker-stats.js';
import { prometheusQueries } from './prometheus-queries.js';

test('step duration rejects values without a unit', () => {
  assert.equal(readDuration(undefined), '1m');
  assert.throws(() => readDuration('4 minutes'), /unit/);
});

test('metric keys keep quoted route names', () => {
  const parsed = parseMetricKey('http_req_duration{step:r010,name:"POST /corridas"}');
  assert.deepEqual(parsed, {
    name: 'http_req_duration',
    tags: { step: 'r010', name: 'POST /corridas' },
  });

  const metrics = {
    'http_req_duration{step:r010}': { values: { med: 1 } },
    'http_req_duration{step:r010,name:"POST /corridas"}': { values: { med: 2 } },
    'http_req_duration{name:POST /corridas}': { values: { med: 3 } },
  };
  assert.equal(findMetric(metrics, 'http_req_duration', { step: 'r010' }).values.med, 1);
  assert.equal(
    findMetric(metrics, 'http_req_duration', { step: 'r010', name: 'POST /corridas' }).values.med,
    2,
  );
});

test('docker stats aggregate CPU and memory for experiment containers', () => {
  const stats = aggregateDockerStats([
    JSON.stringify({ Name: 'taxi-rio-api', CPUPerc: '10.0%', MemUsage: '100MiB / 512MiB' }),
    JSON.stringify({ Name: 'taxi-rio-api', CPUPerc: '30.0%', MemUsage: '140MiB / 512MiB' }),
    JSON.stringify({ Name: 'unrelated', CPUPerc: '99%', MemUsage: '1GiB / 2GiB' }),
    JSON.stringify({ Name: 'prefeitura-k6-run-1', CPUPerc: '5%', MemUsage: '64MiB / 512MiB' }),
  ].join('\n'));

  assert.equal(stats.length, 2);
  assert.equal(stats[0].service, 'taxi-rio-api');
  assert.equal(stats[0].cpuPercentAvg, 20);
  assert.equal(stats[0].cpuPercentMax, 30);
  assert.equal(stats[0].memoryBytesMax, 140 * 1024 * 1024);
  assert.equal(stats[1].service, 'k6');
  assert.equal(parseMemoryUsage('512KiB / 128MiB'), 512 * 1024);

  const limits = aggregateDockerLimits(JSON.stringify({
    name: '/taxi-rio-api',
    nanoCpus: 1_000_000_000,
    memory: 512 * 1024 * 1024,
  }));
  const report = attachResources(
    {
      scenario: 'stress',
      conditions: { k6: { cpus: '1.0', memory: '1g' }, containers: CONTAINER_LIMITS },
      resources: null,
    },
    stats,
    limits,
  );
  const api = report.resources.find((row) => row.service === 'taxi-rio-api');
  assert.equal(api.cpuLimit, '1.0');
  assert.equal(api.memoryLimit, '256m');
  assert.equal(api.enforcedMemoryBytes, 512 * 1024 * 1024);
  assert.equal(api.enforcedCpu, 1);
  assert.equal(api.cpuPercentMax, 30);
});

test('prometheus queries use exact queue names and the observation window', () => {
  const queries = prometheusQueries('240s');
  assert.match(queries.queueDepthCriadaMax, /queue="corrida\.criada"}\[240s\]/);
  assert.match(queries.workerLagStatusP95, /queue="corrida\.status_alterado"/);
  assert.match(queries.api5xxRatio, /http_request_errors_total\{service="taxi-rio-api"\}/);
  assert.match(queries.apiLatencyGetP95Seconds, /route="\/corridas\/:id"/);
});
