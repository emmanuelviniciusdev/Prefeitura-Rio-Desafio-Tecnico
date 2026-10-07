import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { appConfig } from '../config/app.config';
import { useExampleJwtEnv } from '../../test/jwt-env';
import { AuthModule } from './auth.module';
import { CurrentActor } from './current-actor.decorator';
import type { Actor } from './domain/actor';
import { Roles } from './roles.decorator';

@Controller('probe')
class ProbeController {
  @Roles('passageiro')
  @Get('passageiro')
  passageiro(@CurrentActor() actor: Actor): { actor: Actor } {
    return { actor };
  }

  @Roles('motorista')
  @Get('motorista')
  motorista(@CurrentActor() actor: Actor): { actor: Actor } {
    return { actor };
  }
}

describe('RolesGuard', () => {
  let app: INestApplication<App>;
  let passageiroToken = '';
  let motoristaToken = '';

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
    passageiroToken = await issueToken('passageiro');
    motoristaToken = await issueToken('motorista');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 403 when the token profile is not allowed', async () => {
    await request(app.getHttpServer()).get('/probe/passageiro').expect(401);

    await request(app.getHttpServer())
      .get('/probe/passageiro')
      .set('Authorization', `Bearer ${passageiroToken}`)
      .expect(200)
      .expect({ actor: 'passageiro' });

    await request(app.getHttpServer())
      .get('/probe/passageiro')
      .set('Authorization', `Bearer ${motoristaToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/probe/motorista')
      .set('Authorization', `Bearer ${motoristaToken}`)
      .expect(200)
      .expect({ actor: 'motorista' });

    await request(app.getHttpServer())
      .get('/probe/motorista')
      .set('Authorization', `Bearer ${passageiroToken}`)
      .expect(403);
  });

  async function issueToken(actor: Actor): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/auth/generate-token/${actor}`)
      .expect(200);
    return readToken(response.body);
  }
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
