import type { Actor } from '../../auth/domain/actor';

export function canCreateRide(actor: Actor): boolean {
  return actor === 'passageiro';
}

export function canReadRide(actor: Actor, createdBy: string): boolean {
  return actor === 'passageiro' && createdBy === actor;
}

export function canUpdateRideStatus(actor: Actor): boolean {
  return actor === 'motorista';
}
