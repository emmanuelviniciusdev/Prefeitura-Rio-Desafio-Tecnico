import { ApiProperty } from '@nestjs/swagger';
import type { FirstPendingRideResponse } from '../domain/ride-response';
import { RideResponseDto } from './ride-response.dto';

export class FirstPendingRideResponseDto implements FirstPendingRideResponse {
  @ApiProperty({
    type: RideResponseDto,
    nullable: true,
    description:
      'Primeira corrida pendente (`requested`) em ordem crescente de `created_at`. Nula quando não houver corrida pendente.',
  })
  corridaEncontrada: RideResponseDto | null;
}
