import type { Actor } from '../../auth/domain/actor';
import type { Principal } from '../../auth/domain/principal';

export function canCreateRide(
  principal: Principal,
  requestedUserId: string,
): boolean {
  return isPassageiroOwner(principal, requestedUserId);
}

export function canReadRide(principal: Principal, rideUserId: string): boolean {
  return isPassageiroOwner(principal, rideUserId);
}

export function canUpdateRideStatus(actor: Actor): boolean {
  return actor === 'motorista';
}

export function canFindFirstPendingRide(actor: Actor): boolean {
  return actor === 'motorista';
}

function isPassageiroOwner(principal: Principal, rideUserId: string): boolean {
  return principal.actor === 'passageiro' && principal.userId === rideUserId;
}
