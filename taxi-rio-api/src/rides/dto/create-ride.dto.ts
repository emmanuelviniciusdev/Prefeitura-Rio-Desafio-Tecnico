import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRideDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Identificador do usuário (coluna user_id).',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Local de partida (coluna local_partida).',
    example: 'Copacabana',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  localPartida: string;

  @ApiProperty({
    description: 'Local de destino (coluna local_destino).',
    example: 'Ipanema',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  localDestino: string;

  @ApiPropertyOptional({
    type: Number,
    format: 'float',
    description:
      'Tempo decorrido em minutos (coluna tempo_decorrido_minutos). Padrão: 0.',
    example: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(0)
  tempoDecorridoMinutos?: number;
}
