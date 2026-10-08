import { Logger } from '@nestjs/common';
import {
  mergePrometheusExpositions,
  metricsRegistry,
  normalizeHttpRoute,
  queueDelaySeconds,
  readMetricsPort,
  readPublishedAt,
  renderMetrics,
} from './metrics';

describe('metrics', () => {
  const previousWorkerUrl = process.env.WORKER_METRICS_URL;

  beforeEach(() => {
    metricsRegistry.resetMetrics();
    delete process.env.WORKER_METRICS_URL;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (previousWorkerUrl === undefined) {
      delete process.env.WORKER_METRICS_URL;
    } else {
      process.env.WORKER_METRICS_URL = previousWorkerUrl;
    }
  });

  it('measures queue delay from the publication datetime', () => {
    const publishedAt = new Date('2026-10-08T01:00:00.000Z');
    const now = new Date('2026-10-08T01:00:02.500Z');

    expect(queueDelaySeconds(publishedAt, now)).toBe(2.5);
    expect(queueDelaySeconds(now, publishedAt)).toBe(0);
  });

  it('reads an ISO publication datetime from message headers', () => {
    expect(
      readPublishedAt({
        published_at: '2026-10-08T01:00:00.000Z',
      })?.toISOString(),
    ).toBe('2026-10-08T01:00:00.000Z');
    expect(
      readPublishedAt({
        published_at: Buffer.from('2026-10-08T01:00:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-10-08T01:00:00.000Z');
    expect(readPublishedAt({ published_at: 'not-a-date' })).toBeUndefined();
    expect(readPublishedAt(undefined)).toBeUndefined();
  });

  it('collapses ride ids and unknown paths', () => {
    expect(
      normalizeHttpRoute(
        '/corridas/11111111-1111-4111-8111-111111111111/status?token=secret',
      ),
    ).toBe('/corridas/:id/status');
    expect(normalizeHttpRoute('/corridas/match-polling')).toBe(
      '/corridas/match-polling',
    );
    expect(normalizeHttpRoute('/corridas/not-a-uuid')).toBe('unmatched');
  });

  it('rejects an invalid metrics port', () => {
    expect(readMetricsPort({})).toBe(9464);
    expect(readMetricsPort({ METRICS_PORT: '9470' })).toBe(9470);
    expect(() => readMetricsPort({ METRICS_PORT: '0' })).toThrow(
      /METRICS_PORT out of range/,
    );
    expect(() => readMetricsPort({ METRICS_PORT: 'nope' })).toThrow(
      /METRICS_PORT out of range/,
    );
  });

  it('merges worker samples without repeating metric metadata', () => {
    const merged = mergePrometheusExpositions(
      [
        '# HELP queue_messages Messages waiting in the queue',
        '# TYPE queue_messages gauge',
        'queue_messages{queue="corrida.criada",service="taxi-rio-api"} 1',
        '',
      ].join('\n'),
      [
        '# HELP queue_messages Messages waiting in the queue',
        '# TYPE queue_messages gauge',
        'queue_messages{queue="corrida.criada",service="taxi-rio-worker"} 2',
        '# HELP worker_messages_total Queue messages processed by the worker',
        '# TYPE worker_messages_total counter',
        'worker_messages_total{queue="corrida.criada",service="taxi-rio-worker"} 3',
        '',
      ].join('\n'),
    );

    expect(merged.match(/# TYPE queue_messages/g)).toHaveLength(1);
    expect(merged).toContain('service="taxi-rio-api"');
    expect(merged).toContain('service="taxi-rio-worker"');
    expect(merged).toContain('worker_messages_total');
  });

  it('appends worker metrics and still serves local metrics when the worker is down', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.WORKER_METRICS_URL = 'http://taxi-rio-worker:9464/metrics';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          [
            '# HELP worker_messages_total Queue messages processed by the worker',
            '# TYPE worker_messages_total counter',
            'worker_messages_total{queue="corrida.criada",service="taxi-rio-worker"} 3',
          ].join('\n'),
          { status: 200 },
        ),
      );

    const body = await renderMetrics();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://taxi-rio-worker:9464/metrics',
      expect.objectContaining({
        headers: { 'x-metrics-scope': 'local' },
      }),
    );
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain(
      'worker_messages_total{queue="corrida.criada",service="taxi-rio-worker"} 3',
    );

    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const localOnly = await renderMetrics();
    expect(localOnly).toContain('# TYPE http_requests_total counter');
    expect(localOnly).not.toContain('service="taxi-rio-worker"');

    const scoped = await renderMetrics('local');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scoped).not.toContain('service="taxi-rio-worker"');
  });
});
