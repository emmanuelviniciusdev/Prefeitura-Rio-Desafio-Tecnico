import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { appConfig } from '../config/app.config';
import { useExampleJwtEnv } from '../../test/jwt-env';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { ACTOR_USER_IDS } from './domain/actor';
import type { Principal } from './domain/principal';
import { Public } from './public.decorator';

@Controller('probe')
class ProbeController {
  @Public()
  @Get('health')
  health(): string {
    return 'ok';
  }

  @Get()
  actor(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}

describe('JwtAuthGuard', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    useExampleJwtEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [appConfig],
        }),
        AuthModule,
      ],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('leaves public routes open and authenticates the actor on protected routes', async () => {
    await request(app.getHttpServer())
      .get('/probe/health')
      .expect(200)
      .expect('ok');

    const passageiro = await request(app.getHttpServer())
      .post('/auth/generate-token/passageiro')
      .expect(200);
    const motorista = await request(app.getHttpServer())
      .post('/auth/generate-token/motorista')
      .expect(200);

    await request(app.getHttpServer()).get('/probe').expect(401);

    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${readToken(passageiro.body)}`)
      .expect(200)
      .expect({
        actor: 'passageiro',
        userId: ACTOR_USER_IDS.passageiro,
      });

    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${readToken(motorista.body)}`)
      .expect(200)
      .expect({
        actor: 'motorista',
        userId: ACTOR_USER_IDS.motorista,
      });

    const service = app.get(AuthService);
    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', service.generateToken('passageiro').accessToken)
      .expect(401);
  });
});

function readToken(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string'
  ) {
    throw new Error('Token response is invalid');
  }

  return value.accessToken;
}
