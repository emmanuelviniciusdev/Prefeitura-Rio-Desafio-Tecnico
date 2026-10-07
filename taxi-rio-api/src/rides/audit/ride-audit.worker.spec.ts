import { Test } from '@nestjs/testing';
import { RabbitmqService } from '../../rabbitmq/rabbitmq.service';
import { RideStatus } from '../domain/ride-status';
import {
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
  type RideAuditEvent,
  type RideAuditRecord,
} from '../events/ride-audit-event';
import { RideAuditRepository } from './ride-audit.repository';
import { RideAuditWorker } from './ride-audit.worker';

describe('RideAuditWorker', () => {
  const rabbitmq = {
    consume: jest.fn<
      Promise<void>,
      [string, (payload: unknown) => Promise<void>]
    >(),
  };
  const audits = {
    insert: jest.fn<Promise<void>, [RideAuditRecord]>(),
    updateStatus: jest.fn<Promise<void>, [RideAuditRecord]>(),
  };
  let worker: RideAuditWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    rabbitmq.consume.mockResolvedValue(undefined);
    audits.insert.mockResolvedValue(undefined);
    audits.updateStatus.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RideAuditWorker,
        { provide: RabbitmqService, useValue: rabbitmq },
        { provide: RideAuditRepository, useValue: audits },
      ],
    }).compile();

    worker = moduleRef.get(RideAuditWorker);
  });

  it('consumes both ride queues', async () => {
    await worker.onModuleInit();

    expect(rabbitmq.consume).toHaveBeenCalledWith(
      RIDE_CREATED_QUEUE,
      expect.any(Function),
    );
    expect(rabbitmq.consume).toHaveBeenCalledWith(
      RIDE_STATUS_CHANGED_QUEUE,
      expect.any(Function),
    );
  });

  it('inserts a requested ride with a null elapsed time', async () => {
    await worker.persistCreated(event());

    expect(audits.insert).toHaveBeenCalledWith({
      id_corrida: '11111111-1111-4111-8111-111111111111',
      status_corrida: RideStatus.Requested,
      dh_inicio: new Date('2026-10-07T18:00:00.000Z'),
      dh_fim: null,
      computed_elapsed_time: null,
    });
    expect(audits.updateStatus).not.toHaveBeenCalled();
  });

  it('updates only the status when confirming a requested ride', async () => {
    await worker.persistStatusChanged(event());

    expect(audits.updateStatus).toHaveBeenCalledWith({
      id_corrida: '11111111-1111-4111-8111-111111111111',
      status_corrida: RideStatus.Requested,
      dh_inicio: new Date('2026-10-07T18:00:00.000Z'),
      dh_fim: null,
      computed_elapsed_time: null,
    });
    expect(audits.insert).not.toHaveBeenCalled();
  });

  it('updates the existing ride when the status changes to finished', async () => {
    await worker.persistStatusChanged(
      event({
        status_corrida: RideStatus.Finished,
        dh_fim: '2026-10-07T18:30:00.000Z',
      }),
    );

    expect(audits.updateStatus).toHaveBeenCalledWith({
      id_corrida: '11111111-1111-4111-8111-111111111111',
      status_corrida: RideStatus.Finished,
      dh_inicio: new Date('2026-10-07T18:00:00.000Z'),
      dh_fim: new Date('2026-10-07T18:30:00.000Z'),
      computed_elapsed_time: 30,
    });
    expect(audits.insert).not.toHaveBeenCalled();
  });

  it('ignores invalid payloads', async () => {
    await worker.persistCreated({ id_corrida: 'missing-fields' });
    await worker.persistStatusChanged({ id_corrida: 'missing-fields' });
    expect(audits.insert).not.toHaveBeenCalled();
    expect(audits.updateStatus).not.toHaveBeenCalled();
  });
});

function event(overrides?: Partial<RideAuditEvent>): RideAuditEvent {
  return {
    id_corrida: '11111111-1111-4111-8111-111111111111',
    status_corrida: RideStatus.Requested,
    dh_inicio: '2026-10-07T18:00:00.000Z',
    dh_fim: null,
    ...overrides,
  };
}
