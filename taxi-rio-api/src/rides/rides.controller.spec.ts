import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import type { Actor } from '../auth/domain/actor';
import type { CreateRideResult, RideResponse } from './domain/ride-response';
import { RideStatus } from './domain/ride-status';
import type { CreateRideDto } from './dto/create-ride.dto';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

describe('RidesController', () => {
  const idempotencyKey = '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c';
  const response: RideResponse = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    localPartida: 'Copacabana',
    localDestino: 'Ipanema',
    idempotencyKey,
    dhInicio: '2026-10-07T18:00:00.000Z',
    dhFim: null,
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
    dhInicio: response.dhInicio,
  };

  const ridesService = {
    create: jest.fn<
      Promise<CreateRideResult>,
      [CreateRideDto, string | undefined, Actor]
    >(),
    updateStatus: jest.fn(),
    findById: jest.fn<Promise<RideResponse>, [string, Actor]>(),
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
    ridesService.create.mockResolvedValue({ created: true, ride: response });
    const { response: httpResponse, status } = statusResponse();

    await expect(
      controller.create(idempotencyKey, 'passageiro', dto, httpResponse),
    ).resolves.toEqual(response);
    expect(ridesService.create).toHaveBeenCalledWith(
      dto,
      idempotencyKey,
      'passageiro',
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });

  it('returns 200 when the idempotency key already exists', async () => {
    ridesService.create.mockResolvedValue({ created: false, ride: response });
    const { response: httpResponse, status } = statusResponse();

    await expect(
      controller.create(idempotencyKey, 'passageiro', dto, httpResponse),
    ).resolves.toEqual(response);
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('uses the first idempotency key when the header is repeated', async () => {
    ridesService.create.mockResolvedValue({ created: true, ride: response });
    const { response: httpResponse } = statusResponse();

    await controller.create(
      [idempotencyKey, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      'passageiro',
      dto,
      httpResponse,
    );

    expect(ridesService.create).toHaveBeenCalledWith(
      dto,
      idempotencyKey,
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

  it('returns a ride by id for the current actor', async () => {
    ridesService.findById.mockResolvedValue(response);

    await expect(
      controller.findById(response.id, 'passageiro'),
    ).resolves.toEqual(response);
    expect(ridesService.findById).toHaveBeenCalledWith(
      response.id,
      'passageiro',
    );
  });
});

function statusResponse(): {
  response: Response;
  status: jest.Mock;
} {
  const status = jest.fn();
  return {
    response: { status } as unknown as Response,
    status,
  };
}
