import {
  canCreateRide,
  canReadRide,
  canUpdateRideStatus,
} from './ride-access.policy';

describe('ride access policy', () => {
  it('lets only a passageiro create rides', () => {
    expect(canCreateRide('passageiro')).toBe(true);
    expect(canCreateRide('motorista')).toBe(false);
  });

  it('lets a passageiro read only rides they created', () => {
    expect(canReadRide('passageiro', 'passageiro')).toBe(true);
    expect(canReadRide('passageiro', 'motorista')).toBe(false);
    expect(canReadRide('motorista', 'passageiro')).toBe(false);
    expect(canReadRide('motorista', 'motorista')).toBe(false);
  });

  it('lets only a motorista update ride status', () => {
    expect(canUpdateRideStatus('motorista')).toBe(true);
    expect(canUpdateRideStatus('passageiro')).toBe(false);
  });
});
