import { RideStatus } from './ride-status';
import { canTransition, isIdempotentRequest } from './ride-status.policy';

describe('ride status policy', () => {
  it.each<[RideStatus, RideStatus, boolean]>([
    [RideStatus.Requested, RideStatus.Requested, true],
    [RideStatus.Requested, RideStatus.Initialized, true],
    [RideStatus.Requested, RideStatus.Finished, false],
    [RideStatus.Initialized, RideStatus.Finished, true],
    [RideStatus.Initialized, RideStatus.Initialized, false],
    [RideStatus.Initialized, RideStatus.Requested, false],
    [RideStatus.Finished, RideStatus.Finished, false],
    [RideStatus.Finished, RideStatus.Requested, false],
    [RideStatus.Finished, RideStatus.Initialized, false],
  ])('allows %s -> %s? %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it('treats only requested -> requested as an idempotent request', () => {
    expect(
      isIdempotentRequest(RideStatus.Requested, RideStatus.Requested),
    ).toBe(true);
    expect(
      isIdempotentRequest(RideStatus.Initialized, RideStatus.Initialized),
    ).toBe(false);
    expect(
      isIdempotentRequest(RideStatus.Requested, RideStatus.Initialized),
    ).toBe(false);
  });
});
