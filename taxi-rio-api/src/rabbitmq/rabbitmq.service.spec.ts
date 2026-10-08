import { context, trace } from '@opentelemetry/api';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { installOtelForTests } from '../../test/otel';
import { installStructuredLogger } from '../observability/structured-logger';
import { RabbitmqService } from './rabbitmq.service';

describe('RabbitmqService trace propagation', () => {
  const sent: Array<{
    content: Buffer;
    headers?: Record<string, string>;
  }> = [];
  let deliver: ((message: ConsumeMessage | null) => void) | undefined;
  const ack = jest.fn();
  const nack = jest.fn();

  beforeAll(() => {
    installOtelForTests();
    installStructuredLogger('taxi-rio-api');
  });

  beforeEach(() => {
    sent.length = 0;
    deliver = undefined;
    ack.mockReset();
    nack.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forwards the trace id in broker headers and keeps it out of the logs', async () => {
    const logs = captureOutput();
    const service = connectedService(sent, ack, nack, (onMessage) => {
      deliver = onMessage;
    });
    const span = trace.getTracer('test').startSpan('http request');
    const payload = {
      id_corrida: '11111111-1111-4111-8111-111111111111',
      status_corrida: 'requested',
      user_id: 'user-secret',
      token: 'token-secret',
    };

    await context.with(trace.setSpan(context.active(), span), async () => {
      await service.publish('corrida.criada', payload);
    });
    span.end();

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].content.toString('utf8'))).toEqual(payload);
    expect(sent[0].headers?.traceparent?.split('-')[1]).toBe(
      span.spanContext().traceId,
    );
    expect(logs()).toContain(span.spanContext().traceId);
    expect(logs()).not.toContain('token-secret');
    expect(logs()).not.toContain('secret-pass');

    let consumedTraceId: string | undefined;
    await service.consume('corrida.criada', () => {
      consumedTraceId = trace.getActiveSpan()?.spanContext().traceId;
      return Promise.resolve();
    });
    deliver?.({
      content: Buffer.from(JSON.stringify(payload)),
      fields: { routingKey: 'corrida.criada' },
      properties: { headers: sent[0].headers },
    } as ConsumeMessage);
    await waitFor(() => ack.mock.calls.length === 1);

    expect(consumedTraceId).toBe(span.spanContext().traceId);
    expect(logs()).not.toContain('token-secret');
  });

  it('redacts secrets from failed processing logs and keeps the trace id', async () => {
    const logs = captureOutput();
    const service = connectedService(sent, ack, nack, (onMessage) => {
      deliver = onMessage;
    });
    const traceId = '0123456789abcdef0123456789abcdef';
    await service.consume('corrida.criada', () =>
      Promise.reject(
        new Error('upstream token=token-secret user_id=user-secret'),
      ),
    );
    deliver?.({
      content: Buffer.from(JSON.stringify({ id_corrida: 'ride-1' })),
      fields: { routingKey: 'corrida.criada' },
      properties: {
        headers: {
          traceparent: `00-${traceId}-0123456789abcdef-01`,
        },
      },
    } as ConsumeMessage);
    await waitFor(() => nack.mock.calls.length === 1);

    expect(logs()).toContain(traceId);
    expect(logs()).not.toContain('token-secret');
    expect(logs()).toContain('user-secret');
    expect(logs()).toContain('[REDACTED]');
    expect(ack).not.toHaveBeenCalled();
  });
});

function connectedService(
  sent: Array<{ content: Buffer; headers?: Record<string, string> }>,
  ack: jest.Mock,
  nack: jest.Mock,
  captureDeliver: (onMessage: (message: ConsumeMessage | null) => void) => void,
): RabbitmqService {
  const service = new RabbitmqService({
    getOrThrow: () => ({
      url: 'amqp://admin:secret-pass@localhost:5672',
    }),
  } as unknown as ConfigService);
  Object.assign(service, {
    channel: {
      assertQueue: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn(
        (
          _queue: string,
          content: Buffer,
          options: { headers?: Record<string, string> },
        ) => {
          sent.push({ content, headers: options.headers });
          return true;
        },
      ),
      consume: jest.fn(
        (
          _queue: string,
          onMessage: (message: ConsumeMessage | null) => void,
        ) => {
          captureDeliver(onMessage);
          return Promise.resolve({ consumerTag: 'test' });
        },
      ),
      ack,
      nack,
    },
  });
  return service;
}

function captureOutput(): () => string {
  const chunks: string[] = [];
  const write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  };
  jest.spyOn(process.stdout, 'write').mockImplementation(write);
  jest.spyOn(process.stderr, 'write').mockImplementation(write);
  return () => chunks.join('');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for the broker handler');
}
