import { recordHttpRequest } from './metrics';
import { startMetricsServer, stopMetricsServer } from './metrics.server';

describe('metrics server', () => {
  afterEach(async () => {
    await stopMetricsServer();
  });

  it('serves the local registry on /metrics', async () => {
    recordHttpRequest({
      method: 'GET',
      route: '/corridas',
      statusCode: 200,
      durationSeconds: 0.01,
    });
    const server = await startMetricsServer(0, '127.0.0.1');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('http_requests_total');
    expect(body).toContain('route="/corridas"');

    const missing = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(missing.status).toBe(404);
  });
});
