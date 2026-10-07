import { createPrivateKey } from 'node:crypto';
import { exampleJwtPrivateKey } from '../../test/jwt-env';
import { normalizePrivateKeyPem } from './app.config';

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
