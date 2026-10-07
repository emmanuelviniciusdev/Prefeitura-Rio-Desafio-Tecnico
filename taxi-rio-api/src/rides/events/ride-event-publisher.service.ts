import { Injectable } from '@nestjs/common';
import { RabbitmqService } from '../../rabbitmq/rabbitmq.service';
import type { RideResponse } from '../domain/ride-response';
import {
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
  toRideAuditEvent,
} from './ride-audit-event';

@Injectable()
export class RideEventPublisher {
  constructor(private readonly rabbitmq: RabbitmqService) {}

  async publishCreated(ride: RideResponse): Promise<void> {
    await this.rabbitmq.publish(RIDE_CREATED_QUEUE, toRideAuditEvent(ride));
  }

  async publishStatusChanged(ride: RideResponse): Promise<void> {
    await this.rabbitmq.publish(
      RIDE_STATUS_CHANGED_QUEUE,
      toRideAuditEvent(ride),
    );
  }
}
