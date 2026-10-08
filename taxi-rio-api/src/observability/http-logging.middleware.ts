import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIgnoredHttpPath } from './http-paths';
import { currentServiceName, writeStructuredLog } from './structured-logger';
import { activeTraceFields } from './trace-context';

export function httpLoggingMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  if (isIgnoredHttpPath(request.url)) {
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
        http_route: request.url?.split('?')[0] ?? '',
        http_status: response.statusCode,
        duration_ms: Math.round(durationMs),
      },
    });
  });
  next();
}
