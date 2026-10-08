import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpMetricsMiddleware } from './http-metrics.middleware';
import { metricsRegistry } from './metrics';

describe('httpMetricsMiddleware', () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('counts requests, latency, and server errors', async () => {
    finish(recordedRequest('GET', '/corridas/match-polling', 200));
    finish(
      recordedRequest(
        'GET',
        '/corridas/11111111-1111-4111-8111-111111111111',
        500,
      ),
    );
    finish(recordedRequest('GET', '/metrics', 200));

    const metrics = await metricsRegistry.getMetricsAsJSON();
    const requests = metricValues(metrics, 'http_requests_total');
    const errors = metricValues(metrics, 'http_request_errors_total');
    const latency = metricValues(metrics, 'http_request_duration_seconds');

    expect(sampleByRoute(requests, '/corridas/match-polling')).toMatchObject({
      value: 1,
      labels: {
        method: 'GET',
        route: '/corridas/match-polling',
        status_code: '200',
      },
    });
    expect(sampleByRoute(requests, '/corridas/:id')).toMatchObject({
      value: 1,
      labels: {
        method: 'GET',
        route: '/corridas/:id',
        status_code: '500',
      },
    });
    expect(sampleByRoute(errors, '/corridas/:id')).toMatchObject({
      value: 1,
      labels: {
        route: '/corridas/:id',
        status_code: '500',
      },
    });
    expect(errors).toHaveLength(1);
    expect(
      latency.some(
        (sample) => sample.metricName === 'http_request_duration_seconds_count',
      ),
    ).toBe(true);
    expect(sampleByRoute(requests, '/metrics')).toBeUndefined();
  });
});

function recordedRequest(
  method: string,
  url: string,
  statusCode: number,
): { response: ReturnType<typeof fakeResponse> } {
  const response = fakeResponse(statusCode);
  httpMetricsMiddleware(
    { method, url } as IncomingMessage,
    response as unknown as ServerResponse,
    () => undefined,
  );
  return { response };
}

function finish(recorded: { response: ReturnType<typeof fakeResponse> }): void {
  recorded.response.finish();
}

function fakeResponse(statusCode: number): {
  statusCode: number;
  finish: () => void;
  once: (event: string, listener: () => void) => void;
} {
  const listeners = new Map<string, () => void>();
  return {
    statusCode,
    once(event: string, listener: () => void) {
      listeners.set(event, listener);
    },
    finish() {
      listeners.get('finish')?.();
    },
  };
}

type Sample = {
  value: number;
  metricName?: string;
  labels: Record<string, string>;
};

function sampleByRoute(samples: Sample[], route: string): Sample | undefined {
  return samples.find((sample) => sample.labels.route === route);
}

function metricValues(
  metrics: Awaited<ReturnType<typeof metricsRegistry.getMetricsAsJSON>>,
  name: string,
): Sample[] {
  const metric = metrics.find((item) => item.name === name);
  return (metric?.values ?? []) as Sample[];
}
