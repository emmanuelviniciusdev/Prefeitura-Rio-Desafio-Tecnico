import { ACTOR_USER_IDS } from '../../auth/domain/actor';
import type { Principal } from '../../auth/domain/principal';
import {
  canCreateRide,
  canFindFirstPendingRide,
  canReadRide,
  canUpdateRideStatus,
} from './ride-access.policy';

describe('ride access policy', () => {
  const passageiro: Principal = {
    actor: 'passageiro',
    userId: ACTOR_USER_IDS.passageiro,
  };
  const motorista: Principal = {
    actor: 'motorista',
    userId: ACTOR_USER_IDS.motorista,
  };

  it('lets only a passageiro create a ride for their own user_id', () => {
    expect(canCreateRide(passageiro, passageiro.userId)).toBe(true);
    expect(canCreateRide(passageiro, motorista.userId)).toBe(false);
    expect(canCreateRide(motorista, motorista.userId)).toBe(false);
    expect(canCreateRide(motorista, passageiro.userId)).toBe(false);
  });

  it('lets a passageiro read only rides owned by their user_id', () => {
    expect(canReadRide(passageiro, passageiro.userId)).toBe(true);
    expect(canReadRide(passageiro, motorista.userId)).toBe(false);
    expect(canReadRide(motorista, passageiro.userId)).toBe(false);
    expect(canReadRide(motorista, motorista.userId)).toBe(false);
  });

  it('lets only a motorista update ride status', () => {
    expect(canUpdateRideStatus('motorista')).toBe(true);
    expect(canUpdateRideStatus('passageiro')).toBe(false);
  });

  it('lets only a motorista read the first pending ride', () => {
    expect(canFindFirstPendingRide('motorista')).toBe(true);
    expect(canFindFirstPendingRide('passageiro')).toBe(false);
  });
});
