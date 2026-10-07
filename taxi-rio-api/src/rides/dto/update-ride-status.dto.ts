import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RideStatus } from '../domain/ride-status';

export class UpdateRideStatusDto {
  @ApiProperty({
    enum: RideStatus,
    description:
      'Novo status (coluna status_corrida). `requested` confirma a solicitação, `initialized` inicia e `finished` finaliza.',
    example: RideStatus.Initialized,
  })
  @IsEnum(RideStatus)
  statusCorrida: RideStatus;
}
