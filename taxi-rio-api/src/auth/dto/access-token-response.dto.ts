import { ApiProperty } from '@nestjs/swagger';
import type { AccessTokenResponse } from '../domain/access-token-response';

export class AccessTokenResponseDto implements AccessTokenResponse {
  @ApiProperty({ description: 'JWT RS256.' })
  accessToken: string;

  @ApiProperty({
    description: 'Esquema a ser enviado no cabeçalho Authorization.',
    example: 'Bearer',
  })
  tokenType: 'Bearer';

  @ApiProperty({
    description: 'Validade do token, em segundos.',
    example: 3600,
  })
  expiresIn: number;
}
