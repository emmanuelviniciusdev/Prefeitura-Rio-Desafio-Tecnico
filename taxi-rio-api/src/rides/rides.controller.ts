import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { Actor } from '../auth/domain/actor';
import type { Principal } from '../auth/domain/principal';
import { Roles } from '../auth/roles.decorator';
import type {
  FirstPendingRideResponse,
  RideResponse,
} from './domain/ride-response';
import { CreateRideDto } from './dto/create-ride.dto';
import { FirstPendingRideResponseDto } from './dto/first-pending-ride-response.dto';
import { RideResponseDto } from './dto/ride-response.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { RidesService } from './rides.service';

@ApiTags('corridas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente ou inválido.' })
@ApiForbiddenResponse({
  description: 'Perfil do token sem permissão para esta operação.',
})
@Controller('corridas')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  @Roles('passageiro')
  @ApiOperation({
    summary: 'Cria uma corrida',
    description:
      'Somente o perfil `passageiro` pode criar corridas, e o `userId` do corpo deve coincidir com o `user_id` do token. Cria uma corrida com status inicial `accepted`. A inserção usa a coluna `idempotency_key`: se a chave ainda não existir, a corrida é criada (201); se já existir, os dados armazenados são devolvidos (200).',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'UUID único da criação. Reutilize o mesmo valor para obter a corrida já persistida.',
    example: '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c',
  })
  @ApiCreatedResponse({
    type: RideResponseDto,
    description: 'Corrida criada.',
  })
  @ApiOkResponse({
    type: RideResponseDto,
    description: 'Corrida já existente para a mesma Idempotency-Key.',
  })
  @ApiBadRequestResponse({
    description:
      'Cabeçalho Idempotency-Key ausente/inválido ou corpo inválido.',
  })
  async create(
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateRideDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RideResponse> {
    const result = await this.ridesService.create(
      body,
      readSingleHeader(idempotencyKey),
      principal,
    );
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.ride;
  }

  @Get('match-polling')
  @Roles('motorista')
  @ApiOperation({
    summary: 'Retorna a primeira corrida pendente',
    description:
      'Somente o perfil `motorista` pode consultar. Devolve a corrida mais antiga com status `accepted`, em ordem crescente de `created_at`. Sempre responde 200: `corridaEncontrada` é a corrida encontrada ou `null` quando a fila estiver vazia.',
  })
  @ApiOkResponse({
    type: FirstPendingRideResponseDto,
    description: 'Primeira corrida pendente, ou `null` quando não houver.',
  })
  findFirstPending(
    @CurrentActor() actor: Actor,
  ): Promise<FirstPendingRideResponse> {
    return this.ridesService.findFirstPending(actor);
  }

  @Patch(':id/status')
  @Roles('motorista')
  @ApiOperation({
    summary: 'Aceita, inicia ou finaliza uma corrida',
    description:
      'Somente o perfil `motorista` pode alterar o status. `accepted` confirma o aceite enquanto a corrida está `accepted`, sem alterar o registro. `initialized` inicia a corrida, somente a partir de `accepted`. `finished` finaliza a corrida, somente a partir de `initialized`, e preenche `dh_fim` automaticamente.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identificador da corrida.',
  })
  @ApiOkResponse({
    type: RideResponseDto,
    description: 'Corrida com o status atualizado.',
  })
  @ApiBadRequestResponse({
    description: 'Status inválido.',
  })
  @ApiNotFoundResponse({ description: 'Corrida não encontrada.' })
  @ApiConflictResponse({ description: 'Transição de status não permitida.' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body() body: UpdateRideStatusDto,
  ): Promise<RideResponse> {
    return this.ridesService.updateStatus(id, body, actor);
  }

  @Get(':id')
  @Roles('passageiro')
  @ApiOperation({
    summary: 'Retorna uma corrida',
    description:
      'Somente o perfil `passageiro` pode consultar as próprias corridas, identificadas pelo `user_id` do token. A leitura é read-through no Redis: em caso de cache miss, a corrida é carregada do MySQL e armazenada no cache. A atualização de status invalida a chave.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identificador da corrida.',
  })
  @ApiOkResponse({ type: RideResponseDto, description: 'Corrida encontrada.' })
  @ApiBadRequestResponse({ description: 'Identificador inválido.' })
  @ApiNotFoundResponse({ description: 'Corrida não encontrada.' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<RideResponse> {
    return this.ridesService.findById(id, principal);
  }
}

function readSingleHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}
