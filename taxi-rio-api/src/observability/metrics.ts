import { Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const PUBLISHED_AT_HEADER = 'published_at';
export const METRICS_SCOPE_HEADER = 'x-metrics-scope';
export const METRICS_SCOPE_LOCAL = 'local';

const HTTP_LABELS = ['method', 'route', 'status_code'] as const;
const WORKER_LABELS = ['queue', 'result'] as const;
const QUEUE_LABELS = ['queue'] as const;
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];
const DELAY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KNOWN_ROUTES = new Set([
  '/auth/generate-token/passageiro',
  '/auth/generate-token/motorista',
  '/corridas',
  '/corridas/match-polling',
  '/corridas/:id',
  '/corridas/:id/status',
]);

const logger = new Logger('Metrics');
const warningsAt = new Map<string, number>();

export const metricsRegistry = new Registry();

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: HTTP_LABELS,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: HTTP_LABELS,
  buckets: DURATION_BUCKETS,
  registers: [metricsRegistry],
});

const httpRequestErrorsTotal = new Counter({
  name: 'http_request_errors_total',
  help: 'HTTP responses with status code 500 or higher',
  labelNames: HTTP_LABELS,
  registers: [metricsRegistry],
});

const workerMessagesTotal = new Counter({
  name: 'worker_messages_total',
  help: 'Queue messages processed by the worker',
  labelNames: WORKER_LABELS,
  registers: [metricsRegistry],
});

const workerMessageDurationSeconds = new Histogram({
  name: 'worker_message_duration_seconds',
  help: 'Worker message processing duration in seconds',
  labelNames: WORKER_LABELS,
  buckets: DURATION_BUCKETS,
  registers: [metricsRegistry],
});

const workerMessageErrorsTotal = new Counter({
  name: 'worker_message_errors_total',
  help: 'Queue messages the worker failed to process',
  labelNames: QUEUE_LABELS,
  registers: [metricsRegistry],
});

const queueDelayHistogram = new Histogram({
  name: 'queue_delay_seconds',
  help: 'Seconds between event publication and the start of processing',
  labelNames: QUEUE_LABELS,
  buckets: DELAY_BUCKETS,
  registers: [metricsRegistry],
});

type QueueDepth = {
  queue: string;
  messages: number;
};

let queueDepthsBound = false;
let readQueueDepths: () => Promise<QueueDepth[]> = () => Promise.resolve([]);

export const queueMessages = new Gauge({
  name: 'queue_messages',
  help: 'Messages waiting in the queue',
  labelNames: QUEUE_LABELS,
  registers: [metricsRegistry],
  async collect() {
    await collectQueueDepth(this);
  },
});

configureMetrics(defaultServiceName());

export type WorkerProcessingResult = 'ok' | 'error';

export function configureMetrics(serviceName: string): void {
  metricsRegistry.setDefaultLabels({ service: serviceName });
}

export function readMetricsPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.METRICS_PORT?.trim();
  if (!raw) {
    return 9464;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`METRICS_PORT out of range: ${raw}`);
  }

  return port;
}

export function bindQueueDepths(reader: () => Promise<QueueDepth[]>): void {
  queueDepthsBound = true;
  readQueueDepths = reader;
}

export function unbindQueueDepths(): void {
  queueDepthsBound = false;
  readQueueDepths = () => Promise.resolve([]);
}

export function normalizeHttpRoute(url: string | undefined): string {
  const rawPath = url?.split('?')[0] || '/';
  const path =
    rawPath.length > 1 && rawPath.endsWith('/')
      ? rawPath.slice(0, -1)
      : rawPath;
  const templated = path.replace(new RegExp(UUID_PATTERN, 'gi'), ':id');
  if (KNOWN_ROUTES.has(templated)) {
    return templated;
  }

  return 'unmatched';
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}): void {
  const labels = {
    method: input.method,
    route: input.route,
    status_code: String(input.statusCode),
  };
  httpRequestsTotal.inc(labels);
  observe(httpRequestDurationSeconds, labels, input.durationSeconds);
  if (input.statusCode >= 500) {
    httpRequestErrorsTotal.inc(labels);
  }
}

export function recordWorkerProcessing(
  queue: string,
  result: WorkerProcessingResult,
  startedAt: bigint,
): void {
  const labels = { queue, result };
  workerMessagesTotal.inc(labels);
  observe(workerMessageDurationSeconds, labels, secondsSince(startedAt));
  if (result === 'error') {
    workerMessageErrorsTotal.inc({ queue });
  }
}

export function readPublishedAt(
  headers: Record<string, unknown> | undefined,
): Date | undefined {
  const raw = headerText(headers?.[PUBLISHED_AT_HEADER]);
  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return new Date(parsed);
}

export function queueDelaySeconds(publishedAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - publishedAt.getTime()) / 1000);
}

export function recordQueueDelay(
  queue: string,
  publishedAt: Date | undefined,
  now = new Date(),
): void {
  if (!publishedAt) {
    return;
  }

  observe(queueDelayHistogram, { queue }, queueDelaySeconds(publishedAt, now));
}

export async function renderMetrics(scope?: string): Promise<string> {
  const local = await metricsRegistry.metrics();
  if (scope === METRICS_SCOPE_LOCAL) {
    return local;
  }

  const remote = await fetchWorkerMetrics();
  return mergePrometheusExpositions(local, remote);
}

export function mergePrometheusExpositions(
  primary: string,
  secondary: string,
): string {
  const extra = secondary.trim();
  if (extra.length === 0) {
    return primary.endsWith('\n') ? primary : `${primary}\n`;
  }

  const declared = new Set<string>();
  const seenSamples = new Set<string>();
  for (const line of primary.split('\n')) {
    const name = metadataMetricName(line);
    if (name) {
      declared.add(name);
    }
    if (line.length > 0 && !line.startsWith('#')) {
      seenSamples.add(line);
    }
  }

  const kept: string[] = [];
  for (const line of extra.split('\n')) {
    const name = metadataMetricName(line);
    if (name) {
      if (declared.has(name)) {
        continue;
      }
      declared.add(name);
    }
    if (line.length > 0 && !line.startsWith('#')) {
      if (seenSamples.has(line)) {
        continue;
      }
      seenSamples.add(line);
    }
    kept.push(line);
  }

  const tail = kept.join('\n').trim();
  const head = primary.trimEnd();
  if (tail.length === 0) {
    return `${head}\n`;
  }

  return `${head}\n${tail}\n`;
}

async function collectQueueDepth(gauge: Gauge<'queue'>): Promise<void> {
  if (!queueDepthsBound) {
    return;
  }

  let depths: QueueDepth[];
  try {
    depths = await readQueueDepths();
  } catch (error) {
    warnOccasionally(
      'queue-depth',
      `Failed to read queue depth: ${errorMessage(error)}`,
    );
    return;
  }

  gauge.reset();
  for (const depth of depths) {
    gauge.set({ queue: depth.queue }, depth.messages);
  }
}

function observe(
  histogram: Histogram<string>,
  labels: Record<string, string>,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  histogram.observe(labels, value);
}

function secondsSince(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

async function fetchWorkerMetrics(): Promise<string> {
  const url = process.env.WORKER_METRICS_URL?.trim();
  if (!url) {
    return '';
  }

  try {
    const response = await fetch(url, {
      headers: { [METRICS_SCOPE_HEADER]: METRICS_SCOPE_LOCAL },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      warnOccasionally(
        'worker-metrics',
        `Worker metrics responded ${response.status}`,
      );
      return '';
    }

    return await response.text();
  } catch (error) {
    warnOccasionally(
      'worker-metrics',
      `Worker metrics unavailable: ${errorMessage(error)}`,
    );
    return '';
  }
}

function metadataMetricName(line: string): string | undefined {
  if (!line.startsWith('# HELP ') && !line.startsWith('# TYPE ')) {
    return undefined;
  }

  const name = line.split(' ')[2];
  return name && name.length > 0 ? name : undefined;
}

function headerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  return undefined;
}

function defaultServiceName(): string {
  const configured = process.env.OTEL_SERVICE_NAME?.trim();
  if (configured) {
    return configured;
  }

  const entry = process.argv[1] ?? '';
  return entry.includes('worker') ? 'taxi-rio-worker' : 'taxi-rio-api';
}

function warnOccasionally(key: string, message: string): void {
  const now = Date.now();
  const previous = warningsAt.get(key) ?? 0;
  if (now - previous < 60_000) {
    return;
  }

  warningsAt.set(key, now);
  logger.warn(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
