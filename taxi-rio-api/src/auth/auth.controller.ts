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
  @ApiOperation({ summary: 'Gera um token de passageiro' })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  generatePassageiroToken(): AccessTokenResponse {
    return this.authService.generateToken('passageiro');
  }

  @Post('generate-token/motorista')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera um token de motorista' })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  generateMotoristaToken(): AccessTokenResponse {
    return this.authService.generateToken('motorista');
  }
}
