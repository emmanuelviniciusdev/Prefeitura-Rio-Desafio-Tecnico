import { SetMetadata } from '@nestjs/common';
import type { Actor } from './domain/actor';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Actor[]) => SetMetadata(ROLES_KEY, roles);
