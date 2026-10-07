import type { Actor } from './actor';

export interface Principal {
  actor: Actor;
  userId: string;
}
