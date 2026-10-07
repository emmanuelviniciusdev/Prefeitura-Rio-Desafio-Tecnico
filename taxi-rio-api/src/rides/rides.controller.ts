import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../auth/domain/actor';
import type { RideResponse } from './domain/ride-response';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideResponseDto } from './dto/ride-response.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { RidesService } from './rides.service';

@ApiTags('corridas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente ou inválido.' })
@Controller('corridas')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cria uma corrida',
    description:
      'Cria uma corrida com status inicial `accepted`. O cabeçalho Idempotency-Key evita duplicidade: a mesma chave com o mesmo corpo devolve a resposta original; a mesma chave com outro corpo responde conflito. A comparação usa o corpo da requisição.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Identificador único da criação. Reutilize o mesmo valor apenas para repetir a mesma requisição.',
    example: '0b6f9c3e-8a1d-4f5e-9c2a-1d2e3f4a5b6c',
  })
  @ApiCreatedResponse({
    type: RideResponseDto,
    description:
      'Corrida criada ou resposta original reapresentada pela mesma Idempotency-Key.',
  })
  @ApiBadRequestResponse({
    description: 'Cabeçalho Idempotency-Key ausente ou corpo inválido.',
  })
  @ApiConflictResponse({
    description: 'Idempotency-Key já utilizada com outro corpo.',
  })
  create(
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @CurrentActor() actor: Actor,
    @Body() body: CreateRideDto,
  ): Promise<RideResponse> {
    return this.ridesService.create(
      body,
      readSingleHeader(idempotencyKey),
      actor,
    );
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Aceita, inicia ou finaliza uma corrida',
    description:
      'Altera o status da corrida. `accepted` confirma o aceite enquanto a corrida está `accepted`, sem alterar o registro. `initialized` inicia a corrida, somente a partir de `accepted`. `finished` finaliza a corrida, somente a partir de `initialized`, e exige `tempoDecorridoMinutos`.',
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
    description: 'Status inválido ou tempo decorrido ausente na finalização.',
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
  @ApiOperation({
    summary: 'Retorna uma corrida',
    description:
      'Retorna uma corrida pelo id. A leitura é read-through no Redis: em caso de cache miss, a corrida é carregada do MySQL e armazenada no cache. A atualização de status invalida a chave.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identificador da corrida.',
  })
  @ApiOkResponse({ type: RideResponseDto, description: 'Corrida encontrada.' })
  @ApiBadRequestResponse({ description: 'Identificador inválido.' })
  @ApiNotFoundResponse({ description: 'Corrida não encontrada.' })
  findById(@Param('id', ParseUUIDPipe) id: string): Promise<RideResponse> {
    return this.ridesService.findById(id);
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
