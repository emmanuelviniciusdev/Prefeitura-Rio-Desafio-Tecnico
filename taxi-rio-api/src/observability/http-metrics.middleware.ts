import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIgnoredHttpPath } from './http-paths';
import { normalizeHttpRoute, recordHttpRequest } from './metrics';

export function httpMetricsMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  if (isIgnoredHttpPath(request.url)) {
    next();
    return;
  }

  const started = process.hrtime.bigint();
  response.once('finish', () => {
    recordHttpRequest({
      method: (request.method ?? 'UNKNOWN').toUpperCase(),
      route: normalizeHttpRoute(request.url),
      statusCode: response.statusCode,
      durationSeconds:
        Number(process.hrtime.bigint() - started) / 1_000_000_000,
    });
  });
  next();
}
