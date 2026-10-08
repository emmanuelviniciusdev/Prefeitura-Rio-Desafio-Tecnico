import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpLoggingMiddleware } from './http-logging.middleware';

describe('httpLoggingMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the route without the query string or authorization header', () => {
    const lines = captureStdout();
    const response = fakeResponse(201);
    const next = jest.fn();

    httpLoggingMiddleware(
      {
        method: 'POST',
        url: '/corridas?token=query-secret&user_id=user-secret',
        headers: { authorization: 'Bearer header-secret' },
      } as IncomingMessage,
      response as unknown as ServerResponse,
      next,
    );
    response.finish();

    expect(next).toHaveBeenCalledTimes(1);
    const record = JSON.parse(lines()[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      message: 'request completed',
      context: 'Http',
      http_method: 'POST',
      http_route: '/corridas',
      http_status: 201,
    });
    const serialized = lines()[0];
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('authorization');
  });

  it('skips health, metrics, and documentation routes', () => {
    const lines = captureStdout();

    for (const url of ['/', '/metrics', '/docs', '/docs/swagger']) {
      const response = fakeResponse(200);
      httpLoggingMiddleware(
        { method: 'GET', url } as IncomingMessage,
        response as unknown as ServerResponse,
        () => undefined,
      );
      response.finish();
    }

    expect(lines()).toEqual([]);
  });
});

function fakeResponse(statusCode: number): {
  statusCode: number;
  finish: () => void;
  on: (event: string, listener: () => void) => void;
} {
  const listeners = new Map<string, () => void>();
  return {
    statusCode,
    on(event: string, listener: () => void) {
      listeners.set(event, listener);
    },
    finish() {
      listeners.get('finish')?.();
    },
  };
}

function captureStdout(): () => string[] {
  const chunks: string[] = [];
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return () =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0);
}
