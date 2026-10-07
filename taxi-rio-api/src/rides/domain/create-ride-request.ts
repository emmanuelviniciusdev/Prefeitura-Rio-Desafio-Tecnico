import { createHash } from 'node:crypto';
import type { CreateRideDto } from '../dto/create-ride.dto';

export interface NormalizedCreateRide {
  userId: string;
  localPartida: string;
  localDestino: string;
  tempoDecorridoMinutos: number;
}

export function normalizeCreateRide(
  input: CreateRideDto,
): NormalizedCreateRide {
  return {
    userId: input.userId.trim(),
    localPartida: input.localPartida.trim(),
    localDestino: input.localDestino.trim(),
    tempoDecorridoMinutos: input.tempoDecorridoMinutos ?? 0,
  };
}

export function hashCreateRideRequest(request: NormalizedCreateRide): string {
  const canonical = JSON.stringify({
    localDestino: request.localDestino,
    localPartida: request.localPartida,
    tempoDecorridoMinutos: request.tempoDecorridoMinutos,
    userId: request.userId,
  });

  return createHash('sha256').update(canonical).digest('hex');
}
