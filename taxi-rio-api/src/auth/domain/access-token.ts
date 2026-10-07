import { createSign, createVerify, type KeyObject } from 'node:crypto';
import { isActor, type Actor } from './actor';

const JWT_ALGORITHM = 'RS256';
const MAX_TOKEN_LENGTH = 8192;

export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: string) {
    super('Invalid access token');
    this.name = 'InvalidAccessTokenError';
  }
}

export function signAccessToken(input: {
  privateKey: KeyObject;
  kid: string;
  actor: Actor;
  expiresInSeconds: number;
  issuedAt?: number;
}): string {
  if (
    !Number.isInteger(input.expiresInSeconds) ||
    input.expiresInSeconds <= 0
  ) {
    throw new Error('expiresInSeconds must be a positive integer');
  }
  if (!input.kid) {
    throw new Error('kid is required to sign an access token');
  }

  const iat = input.issuedAt ?? unixNow();
  return signRs256({
    privateKey: input.privateKey,
    kid: input.kid,
    payload: {
      sub: input.actor,
      iat,
      exp: iat + input.expiresInSeconds,
    },
  });
}

export function verifyAccessToken(input: {
  token: string;
  keys: ReadonlyMap<string, KeyObject>;
  now?: number;
}): Actor {
  const token = input.token;
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidAccessTokenError('malformed');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidAccessTokenError('malformed');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new InvalidAccessTokenError('malformed');
  }

  const header = decodeJson(encodedHeader);
  if (!isJwtHeader(header)) {
    throw new InvalidAccessTokenError('malformed');
  }
  if (header.alg !== JWT_ALGORITHM) {
    throw new InvalidAccessTokenError('alg');
  }
  if (header.typ !== undefined && header.typ !== 'JWT') {
    throw new InvalidAccessTokenError('typ');
  }
  if ('crit' in header) {
    throw new InvalidAccessTokenError('crit');
  }

  const key = input.keys.get(header.kid);
  if (!key) {
    throw new InvalidAccessTokenError('kid');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = Buffer.from(encodedSignature, 'base64url');
  let valid = false;
  try {
    valid = createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(key, signature);
  } catch {
    throw new InvalidAccessTokenError('signature');
  }
  if (!valid) {
    throw new InvalidAccessTokenError('signature');
  }

  return readActor(decodeJson(encodedPayload), input.now ?? unixNow());
}

function signRs256(input: {
  privateKey: KeyObject;
  kid: string;
  payload: { sub: Actor; iat: number; exp: number };
}): string {
  const encodedHeader = encodeJson({
    alg: JWT_ALGORITHM,
    typ: 'JWT',
    kid: input.kid,
  });
  const encodedPayload = encodeJson(input.payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(input.privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

function readActor(value: unknown, now: number): Actor {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidAccessTokenError('claims');
  }

  const claims = value as Record<string, unknown>;
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  if (!isActor(claims.sub)) {
    throw new InvalidAccessTokenError('sub');
  }
  if (
    !isUnixTime(issuedAt) ||
    !isUnixTime(expiresAt) ||
    expiresAt <= issuedAt
  ) {
    throw new InvalidAccessTokenError('exp');
  }
  if (now >= expiresAt) {
    throw new InvalidAccessTokenError('expired');
  }

  return claims.sub;
}

function isJwtHeader(
  value: unknown,
): value is { alg: string; kid: string; typ?: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const header = value as Record<string, unknown>;
  return typeof header.alg === 'string' && typeof header.kid === 'string';
}

function isUnixTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    throw new InvalidAccessTokenError('malformed');
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
