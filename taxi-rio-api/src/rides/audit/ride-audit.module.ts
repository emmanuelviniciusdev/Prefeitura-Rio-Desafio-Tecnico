import { Module } from '@nestjs/common';
import { MongodbModule } from '../../mongodb/mongodb.module';
import { RabbitmqModule } from '../../rabbitmq/rabbitmq.module';
import { RideAuditRepository } from './ride-audit.repository';
import { RideAuditWorker } from './ride-audit.worker';

@Module({
  imports: [RabbitmqModule, MongodbModule],
  providers: [RideAuditRepository, RideAuditWorker],
})
export class RideAuditModule {}
