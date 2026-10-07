import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { AccessTokenResponse } from './domain/access-token-response';
import { AccessTokenResponseDto } from './dto/access-token-response.dto';
import { Public } from './public.decorator';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('generate-token/passageiro')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gera um token de passageiro',
    description:
      'O JWT inclui `sub=passageiro` e `user_id=e1c6c6d8-08d2-46ce-a670-4be04e1be1cb`.',
  })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  generatePassageiroToken(): AccessTokenResponse {
    return this.authService.generateToken('passageiro');
  }

  @Post('generate-token/motorista')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gera um token de motorista',
    description:
      'O JWT inclui `sub=motorista` e `user_id=2bd66a43-5cdf-4e6a-8ad0-fbfa6b6bc6b0`.',
  })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  generateMotoristaToken(): AccessTokenResponse {
    return this.authService.generateToken('motorista');
  }
}
