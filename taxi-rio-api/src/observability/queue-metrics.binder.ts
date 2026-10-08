import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import {
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
} from '../rides/events/ride-audit-event';
import { bindQueueDepths, unbindQueueDepths } from './metrics';

export const MONITORED_QUEUES = [
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
] as const;

@Injectable()
export class QueueMetricsBinder implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly rabbitmq: RabbitmqService) {}

  onModuleInit(): void {
    bindQueueDepths(() => this.rabbitmq.queueDepths(MONITORED_QUEUES));
  }

  onModuleDestroy(): void {
    unbindQueueDepths();
  }
}
