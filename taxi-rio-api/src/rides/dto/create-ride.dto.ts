import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
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

  @ApiProperty({
    description: 'Data/hora de início da corrida (coluna dh_inicio).',
    format: 'date-time',
    example: '2026-10-07T18:00:00.000Z',
  })
  @IsISO8601()
  dhInicio: string;
}
