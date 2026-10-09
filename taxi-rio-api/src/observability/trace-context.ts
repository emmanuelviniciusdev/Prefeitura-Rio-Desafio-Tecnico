import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Exception,
  type Span,
} from '@opentelemetry/api';
import { redactString } from './redact';

const tracer = trace.getTracer('taxi-rio');

export type DbOperation = 'insert' | 'update';

export interface TraceFields {
  trace_id?: string;
  span_id?: string;
}

export function activeTraceFields(): TraceFields {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return {};
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

export async function runWithPublishSpan<T>(
  queue: string,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return runWithSpan(
    `publish ${queue}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: messagingAttributes(queue, 'publish'),
    },
    async () => {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);
      return fn(headers);
    },
  );
}

export async function runWithConsumeSpan<T>(
  queue: string,
  headers: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const extracted = propagation.extract(
    ROOT_CONTEXT,
    carrierFromHeaders(headers),
  );
  return runWithSpan(
    `process ${queue}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: messagingAttributes(queue, 'process'),
      parent: extracted,
    },
    fn,
  );
}

export async function runWithAssertQueueSpan<T>(
  queue: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithSpan(
    `assertQueue ${queue}`,
    {
      kind: SpanKind.CLIENT,
      attributes: messagingAttributes(queue, 'assert'),
    },
    fn,
  );
}

export async function runWithDbSpan<T>(
  operation: DbOperation,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithSpan(
    `${operation} corridas`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'mysql',
        'db.operation.name': operation,
        'db.collection.name': 'corridas',
      },
    },
    fn,
  );
}

async function runWithSpan<T>(
  name: string,
  options: {
    kind: SpanKind;
    attributes?: Attributes;
    parent?: Context;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? context.active();
  const span = tracer.startSpan(
    name,
    {
      kind: options.kind,
      attributes: options.attributes,
    },
    parent,
  );

  return context.with(trace.setSpan(parent, span), async () => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordFailure(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

function messagingAttributes(
  queue: string,
  operation: 'publish' | 'process' | 'assert',
): Attributes {
  return {
    'messaging.system': 'rabbitmq',
    'messaging.destination.name': queue,
    'messaging.operation.type': operation,
  };
}

function carrierFromHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const carrier: Record<string, string> = {};
  if (!headers) {
    return carrier;
  }

  for (const [key, value] of Object.entries(headers)) {
    const text = headerText(value);
    if (text === undefined) {
      continue;
    }
    carrier[key] = text;
    carrier[key.toLowerCase()] = text;
  }

  return carrier;
}

function headerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return undefined;
}

function recordFailure(span: Span, error: unknown): void {
  const message = redactString(errorMessage(error)).slice(0, 120);
  const exception: Exception =
    error instanceof Error ? { name: error.name, message } : { message };
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
