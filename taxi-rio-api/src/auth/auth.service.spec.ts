import { generateKeyPairSync } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { appConfig } from '../config/app.config';
import { useExampleJwtEnv } from '../../test/jwt-env';
import { ACTOR_USER_IDS } from './domain/actor';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  beforeEach(() => {
    useExampleJwtEnv();
  });

  it('issues a bearer token with the actor and user_id claims', async () => {
    const service = await createService();

    const passageiro = service.generateToken('passageiro');
    const motorista = service.generateToken('motorista');

    expect(passageiro).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    expect(service.verify(passageiro.accessToken)).toEqual({
      actor: 'passageiro',
      userId: ACTOR_USER_IDS.passageiro,
    });
    expect(service.verify(motorista.accessToken)).toEqual({
      actor: 'motorista',
      userId: ACTOR_USER_IDS.motorista,
    });
    expect(readClaim(passageiro.accessToken, 'user_id')).toBe(
      ACTOR_USER_IDS.passageiro,
    );
    expect(readClaim(motorista.accessToken, 'user_id')).toBe(
      ACTOR_USER_IDS.motorista,
    );
  });

  it('refuses to start when the private key does not match the static JWKS', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    if (typeof pem !== 'string') {
      throw new Error('Expected a PEM private key');
    }
    process.env.JWT_PRIVATE_KEY = pem;

    await expect(createService()).rejects.toThrow(/static JWKS/);
  });

  it('refuses to start when JWT_PRIVATE_KEY is missing', async () => {
    delete process.env.JWT_PRIVATE_KEY;

    await expect(createService()).rejects.toThrow(/JWT_PRIVATE_KEY/);
  });
});

async function createService(): Promise<AuthService> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [appConfig],
      }),
    ],
    providers: [AuthService],
  }).compile();

  return moduleRef.get(AuthService);
}

function readClaim(token: string, claim: string): unknown {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('Token payload is missing');
  }

  const claims = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  return claims[claim];
}
