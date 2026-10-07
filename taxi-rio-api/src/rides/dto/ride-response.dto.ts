import { ApiProperty } from '@nestjs/swagger';
import type { RideResponse } from '../domain/ride-response';
import { RideStatus } from '../domain/ride-status';

export class RideResponseDto implements RideResponse {
  @ApiProperty({
    description: 'Identificador da corrida (coluna id).',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    description: 'Identificador do usuário (coluna user_id).',
    format: 'uuid',
  })
  userId: string;

  @ApiProperty({ description: 'Local de partida (coluna local_partida).' })
  localPartida: string;

  @ApiProperty({ description: 'Local de destino (coluna local_destino).' })
  localDestino: string;

  @ApiProperty({
    description: 'Chave de idempotência da criação (coluna idempotency_key).',
    format: 'uuid',
  })
  idempotencyKey: string;

  @ApiProperty({
    description: 'Data/hora de início em UTC (coluna dh_inicio).',
    format: 'date-time',
  })
  dhInicio: string;

  @ApiProperty({
    description:
      'Data/hora de término em UTC (coluna dh_fim). Nula até a corrida ser finalizada.',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  dhFim: string | null;

  @ApiProperty({
    enum: RideStatus,
    description: 'Status da corrida (coluna status_corrida).',
  })
  statusCorrida: RideStatus;

  @ApiProperty({
    description: 'Data de criação em UTC (coluna created_at).',
    format: 'date-time',
  })
  createdAt: string;

  @ApiProperty({ description: 'Autor da criação (coluna created_by).' })
  createdBy: string;

  @ApiProperty({
    description: 'Data da última atualização em UTC (coluna updated_at).',
    format: 'date-time',
  })
  updatedAt: string;

  @ApiProperty({
    description: 'Autor da última atualização (coluna updated_by).',
  })
  updatedBy: string;
}
