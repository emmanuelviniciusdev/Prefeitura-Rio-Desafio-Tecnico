import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  activeTraceFields,
  runWithConsumeSpan,
  runWithPublishSpan,
} from './trace-context';

describe('trace context across broker hops', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    const manager = new AsyncLocalStorageContextManager();
    manager.enable();
    context.setGlobalContextManager(manager);
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('keeps one trace id from publish through consume', async () => {
    const tracer = trace.getTracer('test');
    const request = tracer.startSpan('http request');

    await context.with(trace.setSpan(context.active(), request), async () => {
      await runWithPublishSpan('corrida.criada', async (headers) => {
        expect(headers.traceparent?.split('-')[1]).toBe(
          request.spanContext().traceId,
        );
        await runWithConsumeSpan('corrida.criada', headers, () => {
          expect(activeTraceFields().trace_id).toBe(
            request.spanContext().traceId,
          );
          return Promise.resolve();
        });
      });
    });
    request.end();

    const spans = exporter.getFinishedSpans();
    const producer = spans.find(
      (span) => span.name === 'publish corrida.criada',
    );
    const consumer = spans.find(
      (span) => span.name === 'process corrida.criada',
    );
    expect(producer?.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(consumer?.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(consumer?.parentSpanContext?.spanId).toBe(
      producer?.spanContext().spanId,
    );
    expect(JSON.stringify(producer?.attributes)).not.toContain('user');
    expect(JSON.stringify(consumer?.attributes)).not.toContain('token');
  });

  it('reads a traceparent header stored as a buffer', async () => {
    const traceId = '0123456789abcdef0123456789abcdef';
    const spanId = '0123456789abcdef';
    let consumed: string | undefined;

    await runWithConsumeSpan(
      'corrida.status_alterado',
      {
        traceparent: Buffer.from(`00-${traceId}-${spanId}-01`),
      },
      () => {
        consumed = activeTraceFields().trace_id;
        return Promise.resolve();
      },
    );

    expect(consumed).toBe(traceId);
  });
});
