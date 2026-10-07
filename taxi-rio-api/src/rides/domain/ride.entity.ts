import { Column, Entity, PrimaryColumn } from 'typeorm';
import { RideStatus } from './ride-status';

@Entity('corridas')
export class Ride {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @Column({ name: 'local_partida', type: 'varchar', length: 255 })
  origin: string;

  @Column({ name: 'local_destino', type: 'varchar', length: 255 })
  destination: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 36,
    unique: true,
  })
  idempotencyKey: string;

  @Column({ name: 'dh_inicio', type: 'datetime', precision: 3 })
  startedAt: Date;

  @Column({ name: 'dh_fim', type: 'datetime', precision: 3, nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'status_corrida', type: 'varchar', length: 20 })
  status: RideStatus;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;

  @Column({ name: 'created_by', type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt: Date;

  @Column({ name: 'updated_by', type: 'varchar', length: 255 })
  updatedBy: string;
}
