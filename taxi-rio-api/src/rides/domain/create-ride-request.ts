import type { CreateRideDto } from '../dto/create-ride.dto';

export interface NormalizedCreateRide {
  userId: string;
  localPartida: string;
  localDestino: string;
  startedAt: Date;
}

export function normalizeCreateRide(
  input: CreateRideDto,
): NormalizedCreateRide {
  return {
    userId: input.userId.trim(),
    localPartida: input.localPartida.trim(),
    localDestino: input.localDestino.trim(),
    startedAt: new Date(input.dhInicio),
  };
}
