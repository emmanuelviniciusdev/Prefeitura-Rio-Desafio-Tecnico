import {
  CONTAINER_LIMITS,
  DEFAULT_K6_CPUS,
  DEFAULT_K6_MEMORY,
  K6_CPU_WARN_RATIO,
  ROUTES,
  STRESS_FINAL_STATUS,
  STRESS_READS_PER_ITERATION,
  STRESS_STATUS_SEQUENCE,
  STRESS_WRITES_PER_ITERATION,
  WARMUP_DURATION,
  WARMUP_MAX_VUS,
  WARMUP_PRE_ALLOCATED_VUS,
  durationToSeconds,
  stepTag,
} from './config.js';
import {
  ROUTE_ORDER,
  emptyTrend,
  findMetric,
  formatBytes,
  formatCount,
  formatCpu,
  formatMs,
  formatRate,
  formatSeconds,
  formatShare,
  markdownTable,
  metricCount,
  parseMetricKey,
  rateValue,
  trendStats,
} from './baseline-report.js';
import { QUEUE_CREATED, QUEUE_STATUS } from './prometheus-queries.js';

export { ROUTES };
export const STRESS_ROUTE_ORDER = ROUTE_ORDER;

export function buildStepWindows({
  startedAt,
  steps,
  stepDuration,
  warmupDuration = WARMUP_DURATION,
  warmupRate,
}) {
  const origin = Date.parse(startedAt);
  if (!Number.isFinite(origin)) {
    return { warmup: null, steps: [] };
  }

  const warmupSeconds = durationToSeconds(warmupDuration);
  const stepSeconds = durationToSeconds(stepDuration);
  const warmup = {
    tag: 'warmup',
    rate: warmupRate,
    duration: warmupDuration,
    startOffsetSeconds: 0,
    endOffsetSeconds: warmupSeconds,
    startedAt: new Date(origin).toISOString(),
    finishedAt: new Date(origin + warmupSeconds * 1000).toISOString(),
  };

  const windows = steps.map((rate, index) => {
    const startOffsetSeconds = warmupSeconds + index * stepSeconds;
    const endOffsetSeconds = startOffsetSeconds + stepSeconds;
    return {
      tag: stepTag(rate),
      rate,
      duration: stepDuration,
      startOffsetSeconds,
      endOffsetSeconds,
      startedAt: new Date(origin + startOffsetSeconds * 1000).toISOString(),
      finishedAt: new Date(origin + endOffsetSeconds * 1000).toISOString(),
    };
  });

  return { warmup, steps: windows };
}

export function buildStressReport({
  metrics,
  steps,
  stepDuration,
  warmupRate,
  warmupDuration = WARMUP_DURATION,
  preAllocatedVUs,
  maxVUs,
  k6Cpus = DEFAULT_K6_CPUS,
  k6Memory = DEFAULT_K6_MEMORY,
  startedAt,
  finishedAt,
  generatedAt,
}) {
  const requestsPerIteration = STRESS_READS_PER_ITERATION + STRESS_WRITES_PER_ITERATION;
  const windows = buildStepWindows({
    startedAt,
    steps,
    stepDuration,
    warmupDuration,
    warmupRate,
  });
  const stepReports = steps.map((rate) =>
    stepReport(metrics, {
      tag: stepTag(rate),
      rate,
      duration: stepDuration,
    }),
  );

  return {
    scenario: 'stress',
    generatedAt: generatedAt || null,
    timeline: {
      startedAt: startedAt || null,
      finishedAt: finishedAt || null,
      warmup: windows.warmup,
      steps: windows.steps,
    },
    load: {
      executor: 'constant-arrival-rate',
      stepDuration,
      steps: steps.map((rate) => ({ tag: stepTag(rate), ratePerSecond: rate })),
      preAllocatedVUs,
      maxVUs,
      warmup: {
        executor: 'constant-arrival-rate',
        ratePerSecond: warmupRate,
        duration: warmupDuration,
        tag: 'warmup',
        preAllocatedVUs: WARMUP_PRE_ALLOCATED_VUS,
        maxVUs: WARMUP_MAX_VUS,
      },
    },
    trafficMix: {
      readsPerIteration: STRESS_READS_PER_ITERATION,
      writesPerIteration: STRESS_WRITES_PER_ITERATION,
      requestsPerIteration,
      readShare: STRESS_READS_PER_ITERATION / requestsPerIteration,
      writeShare: STRESS_WRITES_PER_ITERATION / requestsPerIteration,
      statusSequence: STRESS_STATUS_SEQUENCE,
      finalStatus: STRESS_FINAL_STATUS,
      pattern:
        'POST /corridas, PATCH initialized, PATCH finished, GET /corridas/:id, then 3x GET /corridas/:id',
    },
    conditions: {
      k6: { cpus: k6Cpus, memory: k6Memory },
      containers: CONTAINER_LIMITS.map((row) =>
        row.service === 'k6' ? { ...row, cpus: k6Cpus, memory: k6Memory } : row,
      ),
    },
    thresholds: thresholdReport(metrics),
    steps: stepReports,
    findings: deriveFindings(stepReports),
    prometheus: null,
    resources: null,
    resourcesByStep: null,
    restartsByStep: null,
    cpuThrottlingByStep: null,
    rabbitmqByStep: null,
    mysqlByStep: null,
    partial: false,
    notes: [
      'Aquecimento (step=warmup, 30s a 5 it/s) fica fora desta tabela.',
      'Um cenário constant-arrival-rate por degrau, em sequência via startTime, para expor p50/p95/p99 por taxa. Um único ramping-arrival-rate não quebra a distribuição por degrau. A taxa de chegada se mantém mesmo se o sistema ficar lento.',
      'Cada iteração usa Idempotency-Key nova, PATCH initialized e PATCH finished (3 escritas e 4 leituras). As duas transições publicam em corrida.status_alterado; finished preenche dhFim e o tempo decorrido no worker. requested→finished é 409.',
      'Limiares são informativos (abortOnFail=false). OOM kill ou reinício durante a rampa é achado, não falha do teste.',
      'Se dropped_iterations > 0 ou a taxa obtida ficar abaixo da pedida, o k6 pode ser o gargalo. CPU do k6 acima de ~80% do limite reforça esse sinal.',
    ],
  };
}

export function buildPartialStressReport(options) {
  const report = buildStressReport({ metrics: {}, ...options });
  return {
    ...report,
    partial: true,
    notes: [
      'Relatório parcial: o k6 foi interrompido antes de gravar o summary (SIGKILL/OOM do gerador, ou o Compose encerrou o container). Métricas HTTP por degrau ficam vazias; OOM, reinícios, CPU e memória vêm das amostras do host.',
      ...report.notes,
    ],
  };
}

export function deriveFindings(stepReports, extras = {}) {
  const inflection = findInflection(stepReports);
  const firstError = stepReports.find((step) => (step.errorRate || 0) >= 0.01);
  const firstDrop = stepReports.find((step) => generatorLimited(step));
  const firstRestart = findFirstStepEvent(extras.restartsByStep, (row) => row.restartDelta > 0 || row.oomKilled);
  const firstThrottle = findFirstStepEvent(extras.cpuThrottlingByStep, (row) => (row.nrThrottledDelta || 0) > 0);
  const firstQueue = findFirstPrometheus(
    extras.prometheusByStep,
    (row) => (row.queues || []).some((queue) => (queue.depthMax || 0) >= 10),
  );
  const firstK6Cpu = findFirstStepEvent(extras.resourcesByStep, (row) => {
    if (row.service !== 'k6') {
      return false;
    }
    return (row.cpuLimitPercentMax || 0) >= K6_CPU_WARN_RATIO * 100;
  });
  const firstCpuLimit = findFirstStepEvent(extras.resourcesByStep, (row) => {
    if (row.service !== 'taxi-rio-api' && row.service !== 'taxi-rio-worker') {
      return false;
    }
    return (row.cpuLimitPercentMax || 0) >= 95;
  });
  const firstMemLimit = findFirstStepEvent(
    extras.resourcesByStep,
    (row) => (row.memoryLimitPercentMax || 0) >= 95,
  );

  const bottleneckCandidates = [
    firstRestart && {
      at: firstRestart.tag,
      rate: firstRestart.rate,
      resource: firstRestart.event.oomKilled ? 'oom' : 'restart',
      evidence: `${firstRestart.event.service}: OOMKilled=${firstRestart.event.oomKilled} restartDelta=${firstRestart.event.restartDelta}`,
    },
    firstThrottle && {
      at: firstThrottle.tag,
      rate: firstThrottle.rate,
      resource: `${firstThrottle.event.service}_cpu_throttle`,
      evidence: `${firstThrottle.event.service}: nr_throttled +${firstThrottle.event.nrThrottledDelta}, throttled_time +${formatNs(firstThrottle.event.throttledTimeNsDelta)}`,
    },
    firstCpuLimit && {
      at: firstCpuLimit.tag,
      rate: firstCpuLimit.rate,
      resource: `${firstCpuLimit.event.service}_cpu`,
      evidence: `${firstCpuLimit.event.service}: CPU máx ${formatCpu(firstCpuLimit.event.cpuLimitPercentMax)} do limite`,
    },
    firstMemLimit && {
      at: firstMemLimit.tag,
      rate: firstMemLimit.rate,
      resource: `${firstMemLimit.event.service}_memory`,
      evidence: `${firstMemLimit.event.service}: memória máx ${formatShare(firstMemLimit.event.memoryLimitPercentMax / 100)} do limite`,
    },
    firstQueue && {
      at: firstQueue.tag,
      rate: firstQueue.rate,
      resource: 'queue',
      evidence: (firstQueue.event.queues || [])
        .map((queue) => `${queue.queue} depth máx ${queue.depthMax}`)
        .join('; '),
    },
    firstDrop && {
      at: firstDrop.tag,
      rate: firstDrop.configuredRatePerSecond,
      resource: 'k6_generator',
      evidence: `dropped_iterations=${firstDrop.droppedIterations}, taxa pedida ${firstDrop.configuredRatePerSecond}/s vs obtida ${formatRate(firstDrop.achievedRatePerSecond)}/s`,
    },
    firstK6Cpu && {
      at: firstK6Cpu.tag,
      rate: firstK6Cpu.rate,
      resource: 'k6_cpu',
      evidence: `CPU do k6 em ${formatCpu(firstK6Cpu.event.cpuLimitPercentMax)} do limite`,
    },
    firstError && {
      at: firstError.tag,
      rate: firstError.configuredRatePerSecond,
      resource: 'http_errors',
      evidence: `taxa de erro ${formatShare(firstError.errorRate)}`,
    },
  ].filter(Boolean);

  const firstBottleneck = earliest(bottleneckCandidates, stepReports);
  const lastHealthy = lastSustainable(stepReports, inflection, firstBottleneck);

  return {
    inflection,
    maxSustainableRate: lastHealthy ? lastHealthy.configuredRatePerSecond : null,
    firstBottleneck: firstBottleneck || null,
    k6MayBeBottleneck: Boolean(firstDrop || firstK6Cpu),
  };
}

export function countStatuses(metrics, tags) {
  const fromCounters = {
    http2xx: metricCount(findMetric(metrics, 'http_status_2xx', tags)),
    http4xx: metricCount(findMetric(metrics, 'http_status_4xx', tags)),
    http5xx: metricCount(findMetric(metrics, 'http_status_5xx', tags)),
    network: metricCount(findMetric(metrics, 'http_status_0', tags)),
    other: 0,
  };
  if (
    fromCounters.http2xx !== null ||
    fromCounters.http4xx !== null ||
    fromCounters.http5xx !== null ||
    fromCounters.network !== null
  ) {
    return {
      http2xx: fromCounters.http2xx || 0,
      http4xx: fromCounters.http4xx || 0,
      http5xx: fromCounters.http5xx || 0,
      network: fromCounters.network || 0,
      other: 0,
    };
  }

  const counts = { http2xx: 0, http4xx: 0, http5xx: 0, network: 0, other: 0 };
  for (const [key, metric] of Object.entries(metrics || {})) {
    const parsed = parseMetricKey(key);
    if (parsed.name !== 'http_reqs') {
      continue;
    }
    if (!tagsMatch(parsed.tags, tags)) {
      continue;
    }

    const count = metricCount(metric) || 0;
    const status = Number(parsed.tags.status);
    if (status === 0) {
      counts.network += count;
    } else if (status >= 200 && status < 300) {
      counts.http2xx += count;
    } else if (status >= 400 && status < 500) {
      counts.http4xx += count;
    } else if (status >= 500) {
      counts.http5xx += count;
    } else {
      counts.other += count;
    }
  }
  return counts;
}

export function renderStressReport(report) {
  const lines = [];
  if (report.partial) {
    lines.push('Relatório parcial — o k6 não chegou ao handleSummary. Achados abaixo vêm do docker stats/inspect.');
  }
  lines.push(
    `Stress — degraus ${report.load.steps.map((step) => `${step.ratePerSecond}/s`).join(' → ')}, ${report.load.stepDuration} cada`,
  );
  lines.push(
    `Proporção por iteração: ${report.trafficMix.readsPerIteration} leituras e ${report.trafficMix.writesPerIteration} escritas (${formatShare(report.trafficMix.readShare)} / ${formatShare(report.trafficMix.writeShare)}). Transições: ${report.trafficMix.statusSequence.join(' → ')}.`,
  );
  lines.push(
    `Limites do k6: ${report.conditions.k6.cpus} CPU, ${report.conditions.k6.memory}. preAllocatedVUs=${report.load.preAllocatedVUs}, maxVUs=${report.load.maxVUs}.`,
  );
  lines.push('');

  const findings = report.findings || {};
  if (findings.maxSustainableRate != null) {
    lines.push(`Taxa máxima sustentável: ${findings.maxSustainableRate} it/s.`);
  }
  if (findings.inflection) {
    lines.push(`Ponto de inflexão: ${findings.inflection.tag} (${findings.inflection.rate}/s). ${findings.inflection.evidence}`);
  }
  if (findings.firstBottleneck) {
    lines.push(
      `Primeiro gargalo: ${findings.firstBottleneck.resource} em ${findings.firstBottleneck.at} (${findings.firstBottleneck.rate}/s). ${findings.firstBottleneck.evidence}`,
    );
  }
  if (findings.k6MayBeBottleneck) {
    lines.push('Sinal de que o k6 pode ser o gargalo: dropped_iterations ou taxa obtida abaixo da pedida, ou CPU do k6 acima de ~80% do limite.');
  }
  lines.push('');

  lines.push(markdownTable(
    [
      'Degrau',
      'Pedida/s',
      'Obtida/s',
      'Dropped',
      'p50',
      'p95',
      'p99',
      'max',
      'Erro',
      '2xx',
      '4xx',
      '5xx',
      'status 0',
      'desatualizado',
    ],
    report.steps.map((step) => [
      step.tag,
      String(step.configuredRatePerSecond),
      formatRate(step.achievedRatePerSecond),
      String(step.droppedIterations),
      formatMs(step.http.durationMs.p50),
      formatMs(step.http.durationMs.p95),
      formatMs(step.http.durationMs.p99),
      formatMs(step.http.durationMs.max),
      formatShare(step.errorRate),
      String(step.status.http2xx),
      String(step.status.http4xx),
      String(step.status.http5xx),
      String(step.status.network),
      String(step.statusDesatualizado),
    ]),
  ));
  lines.push('');
  lines.push('Tempos em milissegundos, medidos pelo k6 por degrau (tag step=rNNN). Aquecimento excluído.');
  lines.push('');

  for (const step of report.steps) {
    lines.push(`Rotas em ${step.tag} (${step.configuredRatePerSecond}/s):`);
    lines.push(markdownTable(
      ['Rota', 'avg', 'p50', 'p90', 'p95', 'p99', 'max', 'Erro'],
      [
        routeRow('todas', step.http.durationMs, step.errorRate),
        ...step.routes.map((route) => routeRow(route.route, route.durationMs, route.errorRate)),
      ],
    ));
    lines.push('');
  }

  const prometheusByStep = report.prometheusByStep || [];
  if (prometheusByStep.length === 0) {
    lines.push('Prometheus: ainda não consultado por degrau. Rode ./loadtest/run-stress.sh.');
  } else {
    lines.push('Prometheus por degrau (janela exata, vista da API e do worker):');
    lines.push(markdownTable(
      [
        'Degrau',
        '5xx API',
        'p95 API',
        'POST p95',
        'PATCH p95',
        'GET p95',
        `${QUEUE_CREATED} máx`,
        `${QUEUE_CREATED} lag p95`,
        `${QUEUE_STATUS} máx`,
        `${QUEUE_STATUS} lag p95`,
      ],
      prometheusByStep.map((row) => [
        row.tag,
        formatShare(row.api5xxRatio),
        formatMs(row.apiLatencyP95Ms),
        formatMs(row.routes?.[0]?.latencyP95Ms),
        formatMs(row.routes?.[1]?.latencyP95Ms),
        formatMs(row.routes?.[2]?.latencyP95Ms),
        formatCount(row.queues?.[0]?.depthMax),
        formatSeconds(row.queues?.[0]?.lagP95Seconds),
        formatCount(row.queues?.[1]?.depthMax),
        formatSeconds(row.queues?.[1]?.lagP95Seconds),
      ]),
    ));
  }

  lines.push('');
  renderResourceSection(lines, report);
  renderRestartSection(lines, report);
  renderThrottleSection(lines, report);
  renderBrokerSection(lines, report);

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function stepReport(metrics, step) {
  const seconds = durationToSeconds(step.duration);
  const iterations = metricCount(findMetric(metrics, 'iterations', { scenario: step.tag }));
  const measured = typeof iterations === 'number' && iterations > 0;
  const achieved = measured ? iterations / seconds : null;
  const dropped = metricCount(findMetric(metrics, 'dropped_iterations', { scenario: step.tag })) || 0;
  const tags = { step: step.tag };

  return {
    tag: step.tag,
    configuredRatePerSecond: step.rate,
    achievedRatePerSecond: achieved,
    duration: step.duration,
    iterations: measured ? iterations : null,
    droppedIterations: dropped,
    errorRate: measured ? rateValue(findMetric(metrics, 'http_req_failed', tags)) : null,
    http: {
      durationMs: measured
        ? trendStats(findMetric(metrics, 'http_req_duration', tags))
        : emptyTrend(),
    },
    routes: STRESS_ROUTE_ORDER.map((route) => ({
      route,
      errorRate: measured
        ? rateValue(findMetric(metrics, 'http_req_failed', { ...tags, name: route }))
        : null,
      durationMs: measured
        ? trendStats(findMetric(metrics, 'http_req_duration', { ...tags, name: route }))
        : emptyTrend(),
    })),
    status: countStatuses(metrics, tags),
    statusDesatualizado: metricCount(findMetric(metrics, 'status_desatualizado', tags)) || 0,
    generatorLimited: measured && (dropped > 0 || achieved < step.rate * 0.95),
  };
}

function generatorLimited(step) {
  return Boolean(step.generatorLimited);
}

function findInflection(steps) {
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    const prevP95 = previous.http.durationMs.p95;
    const currP95 = current.http.durationMs.p95;
    const prevP50 = previous.http.durationMs.p50;
    const currP50 = current.http.durationMs.p50;
    if (![prevP95, currP95, prevP50, currP50].every(Number.isFinite)) {
      continue;
    }

    const p95Ratio = currP95 / Math.max(prevP95, 0.001);
    const p50Ratio = currP50 / Math.max(prevP50, 0.001);
    const spread = currP95 / Math.max(currP50, 0.001);
    const previousSpread = prevP95 / Math.max(prevP50, 0.001);

    if (p95Ratio >= 2 && p50Ratio < 1.5) {
      return {
        tag: current.tag,
        rate: current.configuredRatePerSecond,
        evidence: `p95 ${prevP95.toFixed(1)}→${currP95.toFixed(1)} ms (${p95Ratio.toFixed(1)}x) enquanto p50 ${prevP50.toFixed(1)}→${currP50.toFixed(1)} ms.`,
      };
    }
    if (spread >= 3 && previousSpread < 3 && p50Ratio < 1.5) {
      return {
        tag: current.tag,
        rate: current.configuredRatePerSecond,
        evidence: `p95/p50 foi a ${spread.toFixed(1)} em ${current.tag} (p50 ${currP50.toFixed(1)} ms, p95 ${currP95.toFixed(1)} ms).`,
      };
    }
  }
  return null;
}

function lastSustainable(steps, inflection, bottleneck) {
  const cutoffTag = inflection?.tag || bottleneck?.at;
  if (!cutoffTag) {
    return [...steps].reverse().find((step) => !step.generatorLimited && (step.errorRate || 0) < 0.05) || null;
  }
  const index = steps.findIndex((step) => step.tag === cutoffTag);
  if (index <= 0) {
    return null;
  }
  return steps[index - 1];
}

function earliest(candidates, steps) {
  const order = new Map(steps.map((step, index) => [step.tag, index]));
  let best = null;
  let bestIndex = Infinity;
  for (const candidate of candidates) {
    const index = order.has(candidate.at) ? order.get(candidate.at) : Infinity;
    if (index < bestIndex) {
      best = candidate;
      bestIndex = index;
    }
  }
  return best;
}

function findFirstStepEvent(byStep, predicate) {
  if (!Array.isArray(byStep)) {
    return null;
  }
  for (const step of byStep) {
    const rows = step.containers || step.resources || step.rows || [];
    const event = rows.find(predicate);
    if (event) {
      return { tag: step.tag, rate: step.rate, event };
    }
  }
  return null;
}

function findFirstPrometheus(byStep, predicate) {
  if (!Array.isArray(byStep)) {
    return null;
  }
  for (const step of byStep) {
    if (predicate(step)) {
      return { tag: step.tag, rate: step.rate, event: step };
    }
  }
  return null;
}

function thresholdReport(metrics) {
  const rows = [];
  for (const [key, metric] of Object.entries(metrics || {})) {
    if (!metric || !metric.thresholds) {
      continue;
    }
    if (!key.includes('phase:stress') && !key.includes('step:r') && !key.includes('scenario:r')) {
      continue;
    }
    for (const [expression, result] of Object.entries(metric.thresholds)) {
      rows.push({
        metric: key,
        expression,
        ok: Boolean(result && result.ok),
      });
    }
  }
  return rows;
}

function tagsMatch(actual, expected) {
  return Object.entries(expected).every(([tag, value]) => actual[tag] === value);
}

function routeRow(route, durationMs, errorRate) {
  const stats = durationMs || {};
  return [
    route,
    formatMs(stats.avg),
    formatMs(stats.p50),
    formatMs(stats.p90),
    formatMs(stats.p95),
    formatMs(stats.p99),
    formatMs(stats.max),
    formatShare(errorRate),
  ];
}

function formatNs(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)} s`;
  }
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(1)} ms`;
  }
  return `${Math.round(value / 1000)} µs`;
}

function renderResourceSection(lines, report) {
  const byStep = report.resourcesByStep || [];
  if (byStep.length === 0) {
    if (!report.resources) {
      lines.push('CPU e memória: ainda não coletadas. Rode ./loadtest/run-stress.sh para amostrar docker stats.');
      return;
    }
    lines.push('CPU e memória (execução inteira, docker stats):');
    lines.push(resourceTable(report.resources));
    return;
  }

  lines.push('CPU e memória por degrau (docker stats a cada 5s, % do limite):');
  for (const step of byStep) {
    lines.push(`${step.tag} (${step.rate}/s):`);
    lines.push(resourceTable(step.resources || []));
    lines.push('');
  }
}

function resourceTable(resources) {
  return markdownTable(
    [
      'Serviço',
      'CPU média',
      'CPU máx',
      '% CPU lim.',
      'Memória média',
      'Memória máx',
      '% mem. lim.',
      'Limite CPU',
      'Limite mem.',
    ],
    resources.map((row) => [
      row.service,
      formatCpu(row.cpuPercentAvg),
      formatCpu(row.cpuPercentMax),
      formatCpu(row.cpuLimitPercentMax),
      formatBytes(row.memoryBytesAvg),
      formatBytes(row.memoryBytesMax),
      formatShare(
        Number.isFinite(row.memoryLimitPercentMax) ? row.memoryLimitPercentMax / 100 : null,
      ),
      row.cpuLimit || '—',
      row.memoryLimit || '—',
    ]),
  );
}

function renderRestartSection(lines, report) {
  const byStep = report.restartsByStep || [];
  if (byStep.length === 0) {
    lines.push('OOM/reinícios: ainda não coletados.');
    return;
  }

  const rows = [];
  for (const step of byStep) {
    for (const container of step.containers || []) {
      if (container.restartDelta > 0 || container.oomKilled) {
        rows.push([
          step.tag,
          container.service,
          container.oomKilled ? 'sim' : 'não',
          String(container.restartDelta),
          container.lastStatus || '—',
        ]);
      }
    }
  }

  if (rows.length === 0) {
    lines.push('OOM/reinícios: nenhum RestartCount ou OOMKilled durante os degraus.');
    return;
  }

  lines.push('OOM/reinícios (achado, não falha do teste):');
  lines.push(markdownTable(['Degrau', 'Serviço', 'OOMKilled', 'Δ RestartCount', 'Estado'], rows));
}

function renderThrottleSection(lines, report) {
  const byStep = report.cpuThrottlingByStep || [];
  if (byStep.length === 0) {
    lines.push('Throttling de CPU (cgroup cpu.stat): ainda não coletado.');
    return;
  }

  const rows = [];
  let missingHint = null;
  for (const step of byStep) {
    for (const container of step.containers || []) {
      if (!container.available && container.hint) {
        missingHint = container.hint;
      }
      rows.push([
        step.tag,
        container.service,
        container.available ? String(container.nrThrottledDelta ?? '—') : '—',
        container.available ? formatNs(container.throttledTimeNsDelta) : '—',
      ]);
    }
  }

  lines.push('Throttling de CPU (delta de nr_throttled e throttled_time do cgroup):');
  lines.push(markdownTable(['Degrau', 'Serviço', 'Δ nr_throttled', 'Δ throttled_time'], rows));
  if (missingHint) {
    lines.push(missingHint);
  }
}

function renderBrokerSection(lines, report) {
  const rabbit = report.rabbitmqByStep || [];
  const mysql = report.mysqlByStep || [];
  if (rabbit.length === 0 && mysql.length === 0) {
    return;
  }

  if (rabbit.length > 0) {
    const available = rabbit.some((step) => step.available);
    if (!available) {
      lines.push(rabbit[0].hint || 'Métricas nativas do RabbitMQ não estão no Prometheus.');
    } else {
      lines.push('RabbitMQ (API de management, não há scrape Prometheus deste broker):');
      lines.push(markdownTable(
        ['Degrau', 'Alarme de memória', 'Alarme de disco', 'Conexões bloqueadas máx'],
        rabbit.map((step) => [
          step.tag,
          step.memAlarm ? 'sim' : 'não',
          step.diskAlarm ? 'sim' : 'não',
          step.blockedConnectionsMax == null ? '—' : String(step.blockedConnectionsMax),
        ]),
      ));
    }
  }

  if (mysql.length > 0) {
    const available = mysql.some((step) => step.available);
    if (!available) {
      lines.push(mysql[0].hint || 'Pool MySQL sem métrica na API.');
    } else {
      lines.push('MySQL (SHOW GLOBAL STATUS; a API não exporta o pool TypeORM):');
      lines.push(markdownTable(
        ['Degrau', 'Threads_connected máx', 'Threads_running máx', 'Max_used_connections', 'max_connections'],
        mysql.map((step) => [
          step.tag,
          String(step.threadsConnectedMax ?? '—'),
          String(step.threadsRunningMax ?? '—'),
          String(step.maxUsedConnections ?? '—'),
          String(step.maxConnections ?? '—'),
        ]),
      ));
    }
  }
}
