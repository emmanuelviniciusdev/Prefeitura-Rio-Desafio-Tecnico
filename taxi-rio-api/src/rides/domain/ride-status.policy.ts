import { RideStatus } from './ride-status';

const transitions: Record<RideStatus, readonly RideStatus[]> = {
  [RideStatus.Requested]: [RideStatus.Requested, RideStatus.Initialized],
  [RideStatus.Initialized]: [RideStatus.Finished],
  [RideStatus.Finished]: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return transitions[from].includes(to);
}

export function isIdempotentRequest(from: RideStatus, to: RideStatus): boolean {
  return from === RideStatus.Requested && to === RideStatus.Requested;
}
