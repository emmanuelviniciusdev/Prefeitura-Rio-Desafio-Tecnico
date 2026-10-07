import {
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { join } from 'node:path';
import { normalizePrivateKeyPem } from '../../config/app.config';
import { exampleJwtPrivateKey } from '../../../test/jwt-env';
import type { Actor } from './actor';
import {
  InvalidAccessTokenError,
  signAccessToken,
  verifyAccessToken,
} from './access-token';
import { loadStaticJwks } from './jwks';

describe('access tokens', () => {
  const issuedAt = 1_700_000_000;
  const expiresInSeconds = 60;
  const jwks = loadStaticJwks(join(__dirname, '../jwks.json'));
  const kid = jwks.keys[0]?.kid ?? '';
  const privateKey = createPrivateKey(
    normalizePrivateKeyPem(exampleJwtPrivateKey()),
  );

  it('signs a token that the static JWKS accepts for each actor', () => {
    for (const actor of ['passageiro', 'motorista'] as const) {
      const token = sign(actor);

      expect(
        verifyAccessToken({ token, keys: jwks.byKid, now: issuedAt }),
      ).toBe(actor);
    }
  });

  it('rejects an expired token', () => {
    const token = sign('passageiro');

    expectInvalid(token, issuedAt + expiresInSeconds, 'expired');
  });

  it('rejects a tampered signature', () => {
    const token = sign('passageiro');
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expectInvalid(tampered, issuedAt, 'signature');
  });

  it('rejects an unknown key id', () => {
    const token = signAccessToken({
      privateKey,
      kid: 'missing',
      actor: 'passageiro',
      expiresInSeconds,
      issuedAt,
    });

    expectInvalid(token, issuedAt, 'kid');
  });

  it('rejects alg none and HMAC headers', () => {
    const payload = claims('passageiro');

    expectInvalid(
      craft({ alg: 'none', kid }, payload, 'signature'),
      issuedAt,
      'alg',
    );
    expectInvalid(
      craft({ alg: 'HS256', kid }, payload, 'signature'),
      issuedAt,
      'alg',
    );
  });

  it('rejects a signature from another private key', () => {
    const { privateKey: otherKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const token = signRaw(otherKey, kid, claims('passageiro'));

    expectInvalid(token, issuedAt, 'signature');
  });

  it('rejects a subject that is not an actor', () => {
    const token = signRaw(privateKey, kid, {
      sub: 'system',
      iat: issuedAt,
      exp: issuedAt + expiresInSeconds,
    });

    expectInvalid(token, issuedAt, 'sub');
  });

  it('rejects a malformed token', () => {
    expectInvalid('not-a-jwt', issuedAt, 'malformed');
  });

  function sign(actor: Actor): string {
    return signAccessToken({
      privateKey,
      kid,
      actor,
      expiresInSeconds,
      issuedAt,
    });
  }

  function expectInvalid(token: string, now: number, reason: string): void {
    try {
      verifyAccessToken({ token, keys: jwks.byKid, now });
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAccessTokenError);
      if (error instanceof InvalidAccessTokenError) {
        expect(error.reason).toBe(reason);
      }
      return;
    }

    throw new Error('Expected an invalid token');
  }
});

function claims(actor: string): Record<string, unknown> {
  return {
    sub: actor,
    iat: 1_700_000_000,
    exp: 1_700_000_060,
  };
}

function craft(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signature: string,
): string {
  return `${encode(header)}.${encode(payload)}.${encode(signature)}`;
}

function signRaw(
  key: KeyObject,
  kid: string,
  payload: Record<string, unknown>,
): string {
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode(payload)}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function encode(value: object | string): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(raw, 'utf8').toString('base64url');
}
