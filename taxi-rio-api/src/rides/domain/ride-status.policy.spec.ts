import { RideStatus } from './ride-status';
import { canTransition, isIdempotentAccept } from './ride-status.policy';

describe('ride status policy', () => {
  it.each<[RideStatus, RideStatus, boolean]>([
    [RideStatus.Accepted, RideStatus.Accepted, true],
    [RideStatus.Accepted, RideStatus.Initialized, true],
    [RideStatus.Accepted, RideStatus.Finished, false],
    [RideStatus.Initialized, RideStatus.Finished, true],
    [RideStatus.Initialized, RideStatus.Initialized, false],
    [RideStatus.Initialized, RideStatus.Accepted, false],
    [RideStatus.Finished, RideStatus.Finished, false],
    [RideStatus.Finished, RideStatus.Accepted, false],
    [RideStatus.Finished, RideStatus.Initialized, false],
  ])('allows %s -> %s? %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it('treats only accepted -> accepted as an idempotent accept', () => {
    expect(isIdempotentAccept(RideStatus.Accepted, RideStatus.Accepted)).toBe(
      true,
    );
    expect(
      isIdempotentAccept(RideStatus.Initialized, RideStatus.Initialized),
    ).toBe(false);
    expect(
      isIdempotentAccept(RideStatus.Accepted, RideStatus.Initialized),
    ).toBe(false);
  });
});
