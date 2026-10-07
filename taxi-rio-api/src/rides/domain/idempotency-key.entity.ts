import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { RideResponse } from './ride-response';

@Entity('idempotency_keys')
export class IdempotencyKeyRecord {
  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar', length: 255 })
  key: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 36 })
  resourceId: string;

  @Column({ name: 'response_body', type: 'json' })
  responseBody: RideResponse;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
