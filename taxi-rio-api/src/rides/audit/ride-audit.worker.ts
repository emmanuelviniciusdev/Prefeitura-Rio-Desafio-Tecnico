import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitmqService } from '../../rabbitmq/rabbitmq.service';
import {
  parseRideAuditEvent,
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
  toRideAuditRecord,
} from '../events/ride-audit-event';
import { RideAuditRepository } from './ride-audit.repository';

@Injectable()
export class RideAuditWorker implements OnModuleInit {
  private readonly logger = new Logger(RideAuditWorker.name);

  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly audits: RideAuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.consume(RIDE_CREATED_QUEUE, (payload) =>
      this.persistCreated(payload),
    );
    await this.rabbitmq.consume(RIDE_STATUS_CHANGED_QUEUE, (payload) =>
      this.persistStatusChanged(payload),
    );
    this.logger.log(
      `Consuming ${RIDE_CREATED_QUEUE} and ${RIDE_STATUS_CHANGED_QUEUE}`,
    );
  }

  async persistCreated(payload: unknown): Promise<void> {
    const record = this.recordFrom(payload);
    if (!record) {
      return;
    }

    await this.audits.insert(record);
  }

  async persistStatusChanged(payload: unknown): Promise<void> {
    const record = this.recordFrom(payload);
    if (!record) {
      return;
    }

    await this.audits.updateStatus(record);
  }

  private recordFrom(payload: unknown) {
    const event = parseRideAuditEvent(payload);
    if (!event) {
      this.logger.warn('Ignoring invalid ride audit event');
      return null;
    }

    return toRideAuditRecord(event);
  }
}
