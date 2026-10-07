import type { Request } from 'express';
import type { Actor } from './domain/actor';

export interface AuthenticatedRequest extends Request {
  actor?: Actor;
}
