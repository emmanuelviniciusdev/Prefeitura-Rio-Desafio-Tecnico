import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Actor } from './domain/actor';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw new UnauthorizedException('Missing access token');
    }

    return request.actor;
  },
);
