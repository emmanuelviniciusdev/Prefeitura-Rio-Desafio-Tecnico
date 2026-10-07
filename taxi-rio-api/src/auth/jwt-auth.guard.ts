import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './authenticated-request';
import { InvalidAccessTokenError } from './domain/access-token';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.trim() === '') {
      throw new UnauthorizedException('Missing access token');
    }

    const token = readBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException('Invalid access token');
    }

    try {
      request.principal = this.authService.verify(token);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException('Invalid access token');
      }
      throw error;
    }

    return true;
  }
}

function readBearerToken(authorization: string): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1];
}
