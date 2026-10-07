import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { RideStatus } from '../domain/ride-status';

export class UpdateRideStatusDto {
  @ApiProperty({
    enum: RideStatus,
    description:
      'Novo status (coluna status_corrida). `accepted` confirma o aceite, `initialized` inicia e `finished` finaliza.',
    example: RideStatus.Initialized,
  })
  @IsEnum(RideStatus)
  statusCorrida: RideStatus;

  @ApiPropertyOptional({
    type: Number,
    format: 'float',
    description:
      'Tempo decorrido em minutos (coluna tempo_decorrido_minutos). Obrigatório quando statusCorrida é `finished`.',
    example: 18.5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(0)
  tempoDecorridoMinutos?: number;
}
