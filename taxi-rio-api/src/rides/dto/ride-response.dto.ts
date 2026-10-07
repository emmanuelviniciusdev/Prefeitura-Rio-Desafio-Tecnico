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
    type: Number,
    format: 'float',
    description: 'Tempo decorrido em minutos (coluna tempo_decorrido_minutos).',
    example: 18.5,
    minimum: 0,
  })
  tempoDecorridoMinutos: number;

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
