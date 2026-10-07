import type { Request } from 'express';
import type { Principal } from './domain/principal';

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}
