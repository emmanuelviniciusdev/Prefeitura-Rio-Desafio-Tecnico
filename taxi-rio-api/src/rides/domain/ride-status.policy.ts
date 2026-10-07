import { RideStatus } from './ride-status';

const transitions: Record<RideStatus, readonly RideStatus[]> = {
  [RideStatus.Accepted]: [RideStatus.Accepted, RideStatus.Initialized],
  [RideStatus.Initialized]: [RideStatus.Finished],
  [RideStatus.Finished]: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return transitions[from].includes(to);
}

export function isIdempotentAccept(from: RideStatus, to: RideStatus): boolean {
  return from === RideStatus.Accepted && to === RideStatus.Accepted;
}
