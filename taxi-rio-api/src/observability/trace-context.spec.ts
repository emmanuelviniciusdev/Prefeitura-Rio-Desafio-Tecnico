import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  activeTraceFields,
  runWithAssertQueueSpan,
  runWithConsumeSpan,
  runWithDbSpan,
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

  it('nests assertQueue and db spans under the active request', async () => {
    const tracer = trace.getTracer('test');
    const request = tracer.startSpan('http request');

    await context.with(trace.setSpan(context.active(), request), async () => {
      await runWithDbSpan('insert', () => Promise.resolve());
      await runWithAssertQueueSpan('corrida.criada', () => Promise.resolve());
      await runWithDbSpan('update', () => Promise.resolve());
    });
    request.end();

    const spans = exporter.getFinishedSpans();
    const insert = spans.find((span) => span.name === 'insert corridas');
    const assertQueue = spans.find(
      (span) => span.name === 'assertQueue corrida.criada',
    );
    const update = spans.find((span) => span.name === 'update corridas');

    expect(insert?.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(assertQueue?.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(update?.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(insert?.attributes).toEqual({
      'db.system': 'mysql',
      'db.operation.name': 'insert',
      'db.collection.name': 'corridas',
    });
    expect(assertQueue?.attributes).toEqual({
      'messaging.system': 'rabbitmq',
      'messaging.destination.name': 'corrida.criada',
      'messaging.operation.type': 'assert',
    });
    expect(JSON.stringify(insert?.attributes)).not.toContain('user');
  });

  it('marks failed insert and assertQueue spans as errors', async () => {
    await expect(
      runWithDbSpan('insert', () => Promise.reject(new Error('duplicate'))),
    ).rejects.toThrow('duplicate');
    await expect(
      runWithAssertQueueSpan('corrida.criada', () =>
        Promise.reject(new Error('channel blocked')),
      ),
    ).rejects.toThrow('channel blocked');

    const spans = exporter.getFinishedSpans();
    const insert = spans.find((span) => span.name === 'insert corridas');
    const assertQueue = spans.find(
      (span) => span.name === 'assertQueue corrida.criada',
    );
    expect(insert?.status.code).toBe(SpanStatusCode.ERROR);
    expect(assertQueue?.status.code).toBe(SpanStatusCode.ERROR);
  });
});
