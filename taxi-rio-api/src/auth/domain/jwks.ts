import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface VerificationKey {
  kid: string;
  key: KeyObject;
}

export interface StaticJwks {
  keys: readonly VerificationKey[];
  byKid: ReadonlyMap<string, KeyObject>;
}

export function loadStaticJwks(path: string): StaticJwks {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read static JWKS at ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Static JWKS at ${path} is not valid JSON`, {
      cause: error,
    });
  }

  if (!isJwksDocument(parsed)) {
    throw new Error(`Static JWKS at ${path} is invalid`);
  }

  const keys = parsed.keys.map((jwk) => toVerificationKey(jwk));
  const byKid = new Map<string, KeyObject>();
  for (const entry of keys) {
    if (byKid.has(entry.kid)) {
      throw new Error(`Static JWKS contains a duplicate kid ${entry.kid}`);
    }
    byKid.set(entry.kid, entry.key);
  }

  if (byKid.size === 0) {
    throw new Error(`Static JWKS at ${path} does not contain any keys`);
  }

  return { keys, byKid };
}

export function findKidForPrivateKey(
  privateKey: KeyObject,
  keys: readonly VerificationKey[],
): string {
  const local = publicParts(createPublicKey(privateKey));
  const match = keys.find((entry) => {
    const remote = publicParts(entry.key);
    return remote.n === local.n && remote.e === local.e;
  });

  if (!match) {
    throw new Error(
      'JWT private key does not match any key in the static JWKS',
    );
  }

  return match.kid;
}

function toVerificationKey(jwk: RsaPublicJwk): VerificationKey {
  try {
    return {
      kid: jwk.kid,
      key: createPublicKey({
        key: { kty: 'RSA', n: jwk.n, e: jwk.e },
        format: 'jwk',
      }),
    };
  } catch (error) {
    throw new Error(
      `Static JWKS key ${jwk.kid} is not a valid RSA public key`,
      {
        cause: error,
      },
    );
  }
}

function publicParts(key: KeyObject): { n: string; e: string } {
  const jwk: JsonWebKey = key.export({ format: 'jwk' });
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new Error('RSA public key is missing modulus or exponent');
  }

  return { n: jwk.n, e: jwk.e };
}

interface RsaPublicJwk {
  kid: string;
  n: string;
  e: string;
}

function isJwksDocument(value: unknown): value is { keys: RsaPublicJwk[] } {
  if (typeof value !== 'object' || value === null || !('keys' in value)) {
    return false;
  }

  const keys = value.keys;
  return Array.isArray(keys) && keys.every(isRsaPublicJwk);
}

function isRsaPublicJwk(value: unknown): value is RsaPublicJwk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const key = value as Record<string, unknown>;
  if (key.kty !== 'RSA') {
    return false;
  }
  if (key.alg !== undefined && key.alg !== 'RS256') {
    return false;
  }
  if (key.use !== undefined && key.use !== 'sig') {
    return false;
  }
  if (typeof key.kid !== 'string' || key.kid.length === 0) {
    return false;
  }
  if (typeof key.n !== 'string' || typeof key.e !== 'string') {
    return false;
  }
  if ('d' in key || 'p' in key || 'q' in key) {
    return false;
  }

  return true;
}
