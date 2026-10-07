import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import type { JwtConfig } from '../config/app.config';
import type { Actor } from './domain/actor';
import { signAccessToken, verifyAccessToken } from './domain/access-token';
import type { AccessTokenResponse } from './domain/access-token-response';
import { findKidForPrivateKey, loadStaticJwks } from './domain/jwks';

@Injectable()
export class AuthService {
  private readonly privateKey: KeyObject;
  private readonly expiresInSeconds: number;
  private readonly keys: ReadonlyMap<string, KeyObject>;
  private readonly kid: string;

  constructor(config: ConfigService) {
    const jwt = config.getOrThrow<JwtConfig>('app.jwt');
    this.expiresInSeconds = jwt.expiresInSeconds;
    this.privateKey = parsePrivateKey(jwt.privateKey);
    const jwks = loadStaticJwks(join(__dirname, 'jwks.json'));
    this.keys = jwks.byKid;
    this.kid = findKidForPrivateKey(this.privateKey, jwks.keys);
  }

  generateToken(actor: Actor): AccessTokenResponse {
    return {
      accessToken: signAccessToken({
        privateKey: this.privateKey,
        kid: this.kid,
        actor,
        expiresInSeconds: this.expiresInSeconds,
      }),
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
    };
  }

  verify(token: string): Actor {
    return verifyAccessToken({ token, keys: this.keys });
  }
}

function parsePrivateKey(pem: string): KeyObject {
  try {
    return createPrivateKey(pem);
  } catch (error) {
    throw new Error(
      'JWT_PRIVATE_KEY could not be parsed as a PKCS#8 private key',
      { cause: error },
    );
  }
}
