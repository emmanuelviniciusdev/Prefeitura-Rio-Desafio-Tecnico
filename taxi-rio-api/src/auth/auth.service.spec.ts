import { generateKeyPairSync } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { appConfig } from '../config/app.config';
import { useExampleJwtEnv } from '../../test/jwt-env';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  beforeEach(() => {
    useExampleJwtEnv();
  });

  it('issues a bearer token whose subject is the requested actor', async () => {
    const service = await createService();

    const passageiro = service.generateToken('passageiro');
    const motorista = service.generateToken('motorista');

    expect(passageiro).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    expect(service.verify(passageiro.accessToken)).toBe('passageiro');
    expect(service.verify(motorista.accessToken)).toBe('motorista');
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
