import { Logger } from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import {
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
} from '../rides/events/ride-audit-event';
import { metricsRegistry } from './metrics';
import { MONITORED_QUEUES, QueueMetricsBinder } from './queue-metrics.binder';

describe('QueueMetricsBinder', () => {
  const rabbitmq = {
    queueDepths: jest.fn<
      Promise<Array<{ queue: string; messages: number }>>,
      [readonly string[]]
    >(),
  };
  let binder: QueueMetricsBinder;

  beforeEach(() => {
    metricsRegistry.resetMetrics();
    rabbitmq.queueDepths.mockReset();
    binder = new QueueMetricsBinder(rabbitmq as unknown as RabbitmqService);
  });

  afterEach(() => {
    binder.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('exports queue size when metrics are scraped', async () => {
    rabbitmq.queueDepths.mockResolvedValue([
      { queue: RIDE_CREATED_QUEUE, messages: 4 },
      { queue: RIDE_STATUS_CHANGED_QUEUE, messages: 0 },
    ]);
    binder.onModuleInit();

    const metrics = await metricsRegistry.getMetricsAsJSON();

    expect(rabbitmq.queueDepths).toHaveBeenCalledWith(MONITORED_QUEUES);
    expect(queueSize(metrics, RIDE_CREATED_QUEUE)).toBe(4);
    expect(queueSize(metrics, RIDE_STATUS_CHANGED_QUEUE)).toBe(0);
  });

  it('keeps the last queue size when the broker read fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    rabbitmq.queueDepths.mockResolvedValueOnce([
      { queue: RIDE_CREATED_QUEUE, messages: 4 },
    ]);
    binder.onModuleInit();
    await metricsRegistry.metrics();

    rabbitmq.queueDepths.mockRejectedValueOnce(new Error('channel closed'));
    const metrics = await metricsRegistry.getMetricsAsJSON();

    expect(queueSize(metrics, RIDE_CREATED_QUEUE)).toBe(4);
  });
});

function queueSize(
  metrics: Awaited<ReturnType<typeof metricsRegistry.getMetricsAsJSON>>,
  queue: string,
): number | undefined {
  const gauge = metrics.find((metric) => metric.name === 'queue_messages');
  const sample = gauge?.values.find((value) => value.labels.queue === queue);
  return sample?.value;
}
