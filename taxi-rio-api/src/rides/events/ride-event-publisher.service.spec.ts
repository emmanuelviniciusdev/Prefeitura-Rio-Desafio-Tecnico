import { Test } from '@nestjs/testing';
import { RabbitmqService } from '../../rabbitmq/rabbitmq.service';
import type { RideResponse } from '../domain/ride-response';
import { RideStatus } from '../domain/ride-status';
import {
  RIDE_CREATED_QUEUE,
  RIDE_STATUS_CHANGED_QUEUE,
} from './ride-audit-event';
import { RideEventPublisher } from './ride-event-publisher.service';

describe('RideEventPublisher', () => {
  const rabbitmq = {
    assertQueues: jest.fn<Promise<void>, [readonly string[]]>(),
    publish: jest.fn<Promise<void>, [string, unknown]>(),
  };
  let publisher: RideEventPublisher;

  beforeEach(async () => {
    jest.clearAllMocks();
    rabbitmq.assertQueues.mockResolvedValue(undefined);
    rabbitmq.publish.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RideEventPublisher,
        { provide: RabbitmqService, useValue: rabbitmq },
      ],
    }).compile();

    publisher = moduleRef.get(RideEventPublisher);
  });

  it('declares the ride queues at startup', async () => {
    await publisher.onModuleInit();

    expect(rabbitmq.assertQueues).toHaveBeenCalledWith([
      RIDE_CREATED_QUEUE,
      RIDE_STATUS_CHANGED_QUEUE,
    ]);
  });

  it('publishes without declaring the queue again', async () => {
    await publisher.publishCreated(ride());
    await publisher.publishStatusChanged(ride());

    expect(rabbitmq.assertQueues).not.toHaveBeenCalled();
    expect(rabbitmq.publish).toHaveBeenNthCalledWith(
      1,
      RIDE_CREATED_QUEUE,
      expect.objectContaining({ id_corrida: ride().id }),
    );
    expect(rabbitmq.publish).toHaveBeenNthCalledWith(
      2,
      RIDE_STATUS_CHANGED_QUEUE,
      expect.objectContaining({ id_corrida: ride().id }),
    );
  });
});

function ride(): RideResponse {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    idempotencyKey: '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c',
    dhInicio: '2026-10-07T18:00:00.000Z',
    dhFim: null,
    statusCorrida: RideStatus.Requested,
    createdAt: '2026-10-07T18:00:00.000Z',
    createdBy: 'passageiro',
    updatedAt: '2026-10-07T18:00:00.000Z',
    updatedBy: 'passageiro',
  };
}
