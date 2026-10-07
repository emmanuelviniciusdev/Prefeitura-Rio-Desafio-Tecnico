import { Test } from '@nestjs/testing';
import type { Actor } from '../auth/domain/actor';
import type { RideResponse } from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import type { CreateRideDto } from './dto/create-ride.dto';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

describe('RidesController', () => {
  const response: RideResponse = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    tempoDecorridoMinutos: 0,
    statusCorrida: RideStatus.Accepted,
    createdAt: '2026-10-07T18:00:00.000Z',
    createdBy: 'passageiro',
    updatedAt: '2026-10-07T18:00:00.000Z',
    updatedBy: 'passageiro',
  };
  const dto: CreateRideDto = {
    userId: response.userId,
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
  };

  const ridesService = {
    create: jest.fn<
      Promise<RideResponse>,
      [CreateRideDto, string | undefined, Actor]
    >(),
    updateStatus: jest.fn(),
    findById: jest.fn<Promise<RideResponse>, [string]>(),
  };

  let controller: RidesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [RidesController],
      providers: [{ provide: RidesService, useValue: ridesService }],
    }).compile();

    controller = moduleRef.get(RidesController);
  });

  it('creates a ride with the idempotency key and actor', async () => {
    ridesService.create.mockResolvedValue(response);

    await expect(
      controller.create('key-1', 'passageiro', dto),
    ).resolves.toEqual(response);
    expect(ridesService.create).toHaveBeenCalledWith(
      dto,
      'key-1',
      'passageiro',
    );
  });

  it('uses the first idempotency key when the header is repeated', async () => {
    ridesService.create.mockResolvedValue(response);

    await controller.create(['key-1', 'key-2'], 'passageiro', dto);

    expect(ridesService.create).toHaveBeenCalledWith(
      dto,
      'key-1',
      'passageiro',
    );
  });

  it('updates the ride status', async () => {
    ridesService.updateStatus.mockResolvedValue({
      ...response,
      statusCorrida: RideStatus.Initialized,
    });

    await expect(
      controller.updateStatus(response.id, 'motorista', {
        statusCorrida: RideStatus.Initialized,
      }),
    ).resolves.toMatchObject({ statusCorrida: RideStatus.Initialized });
    expect(ridesService.updateStatus).toHaveBeenCalledWith(
      response.id,
      { statusCorrida: RideStatus.Initialized },
      'motorista',
    );
  });

  it('returns a ride by id', async () => {
    ridesService.findById.mockResolvedValue(response);

    await expect(controller.findById(response.id)).resolves.toEqual(response);
  });
});
