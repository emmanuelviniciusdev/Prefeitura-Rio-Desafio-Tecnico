import { createPrivateKey } from 'node:crypto';
import { exampleJwtPrivateKey } from '../../test/jwt-env';
import { appConfig, normalizePrivateKeyPem } from './app.config';

describe('appConfig', () => {
  const previousPrefetch = process.env.RABBITMQ_PREFETCH;
  const previousKey = process.env.JWT_PRIVATE_KEY;

  afterEach(() => {
    restoreEnv('RABBITMQ_PREFETCH', previousPrefetch);
    restoreEnv('JWT_PRIVATE_KEY', previousKey);
  });

  it('defaults rabbitmq prefetch to 10', () => {
    process.env.JWT_PRIVATE_KEY = exampleJwtPrivateKey();
    delete process.env.RABBITMQ_PREFETCH;

    expect(appConfig().rabbitmq.prefetch).toBe(10);
  });

  it('reads RABBITMQ_PREFETCH', () => {
    process.env.JWT_PRIVATE_KEY = exampleJwtPrivateKey();
    process.env.RABBITMQ_PREFETCH = '10';

    expect(appConfig().rabbitmq.prefetch).toBe(10);
  });
});

describe('normalizePrivateKeyPem', () => {
  it('turns escaped newlines into a PKCS#8 key', () => {
    const pem = normalizePrivateKeyPem(exampleJwtPrivateKey());

    expect(pem.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(pem.endsWith('-----END PRIVATE KEY-----\n')).toBe(true);
    expect(() => createPrivateKey(pem)).not.toThrow();
  });

  it('requires JWT_PRIVATE_KEY', () => {
    expect(() => normalizePrivateKeyPem(undefined)).toThrow(
      /JWT_PRIVATE_KEY is required/,
    );
    expect(() => normalizePrivateKeyPem('   ')).toThrow(
      /JWT_PRIVATE_KEY is required/,
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
