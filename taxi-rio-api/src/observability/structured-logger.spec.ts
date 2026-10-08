import { context, trace } from '@opentelemetry/api';
import { installOtelForTests } from '../../test/otel';
import { StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
  beforeAll(() => {
    installOtelForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a JSON line with the active trace id and redacts secrets', () => {
    const lines = captureStdout();
    const logger = new StructuredLogger('taxi-rio-api');
    const span = trace.getTracer('test').startSpan('request');

    context.with(trace.setSpan(context.active(), span), () => {
      logger.log(
        {
          message: 'issued credential',
          userId: 'user-1',
          token: 'tok-1',
          ride_id: 'ride-1',
        },
        'AuthService',
      );
    });
    span.end();

    const record = JSON.parse(lines()[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'info',
      service: 'taxi-rio-api',
      context: 'AuthService',
      message: 'issued credential',
      ride_id: 'ride-1',
      userId: 'user-1',
      token: '[REDACTED]',
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
    });
    expect(record.timestamp).toEqual(expect.any(String));
    expect(lines()[0]).toContain('user-1');
    expect(lines()[0]).not.toContain('tok-1');
  });
});

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
