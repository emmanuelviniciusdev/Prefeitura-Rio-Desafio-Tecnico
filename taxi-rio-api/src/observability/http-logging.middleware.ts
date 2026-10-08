import type { IncomingMessage, ServerResponse } from 'node:http';
import { activeTraceFields } from './trace-context';
import { currentServiceName, writeStructuredLog } from './structured-logger';

export function httpLoggingMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const path = request.url?.split('?')[0] ?? '';
  if (isIgnoredPath(path)) {
    next();
    return;
  }

  const started = process.hrtime.bigint();
  const trace = activeTraceFields();
  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    writeStructuredLog({
      level: 'info',
      service: currentServiceName(),
      context: 'Http',
      message: 'request completed',
      traceId: trace.trace_id,
      spanId: trace.span_id,
      fields: {
        http_method: request.method,
        http_route: path,
        http_status: response.statusCode,
        duration_ms: Math.round(durationMs),
      },
    });
  });
  next();
}

function isIgnoredPath(path: string): boolean {
  return (
    path === '/' ||
    path === '/docs' ||
    path === '/docs-json' ||
    path.startsWith('/docs/')
  );
}
