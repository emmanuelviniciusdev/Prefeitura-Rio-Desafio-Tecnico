import { Injectable, OnModuleInit } from '@nestjs/common';
import { MongodbService } from '../../mongodb/mongodb.service';
import { RideStatus } from '../domain/ride-status';
import {
  RIDE_AUDIT_COLLECTION,
  type RideAuditRecord,
} from '../events/ride-audit-event';

@Injectable()
export class RideAuditRepository implements OnModuleInit {
  constructor(private readonly mongo: MongodbService) {}

  async onModuleInit(): Promise<void> {
    await this.collection().createIndex({ id_corrida: 1 }, { unique: true });
  }

  async insert(record: RideAuditRecord): Promise<void> {
    await this.collection().insertOne(record);
  }

  async updateStatus(record: RideAuditRecord): Promise<void> {
    const result = await this.collection().updateOne(
      { id_corrida: record.id_corrida },
      { $set: statusUpdate(record) },
    );
    if (result.matchedCount === 0) {
      throw new Error(`Ride audit ${record.id_corrida} was not found`);
    }
  }

  private collection() {
    return this.mongo.collection<RideAuditRecord>(RIDE_AUDIT_COLLECTION);
  }
}

function statusUpdate(record: RideAuditRecord): Partial<RideAuditRecord> {
  if (record.status_corrida !== RideStatus.Finished) {
    return { status_corrida: record.status_corrida };
  }

  return {
    status_corrida: record.status_corrida,
    dh_fim: record.dh_fim,
    computed_elapsed_time: record.computed_elapsed_time,
  };
}
