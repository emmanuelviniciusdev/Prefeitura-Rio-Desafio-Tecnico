import {
  hashCreateRideRequest,
  normalizeCreateRide,
} from './create-ride-request';

describe('create ride request', () => {
  const userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  it('trims locations and defaults elapsed minutes to zero', () => {
    expect(
      normalizeCreateRide({
        userId: `  ${userId}  `,
        localPartida: '  Copacabana ',
        localDestino: ' Ipanema  ',
      }),
    ).toEqual({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      tempoDecorridoMinutos: 0,
    });
  });

  it('hashes the normalized body deterministically', () => {
    const request = normalizeCreateRide({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      tempoDecorridoMinutos: 12.25,
    });

    expect(hashCreateRideRequest(request)).toBe(hashCreateRideRequest(request));
    expect(hashCreateRideRequest(request)).toHaveLength(64);
  });

  it('changes the hash when the destination changes', () => {
    const left = hashCreateRideRequest({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      tempoDecorridoMinutos: 0,
    });
    const right = hashCreateRideRequest({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Centro',
      tempoDecorridoMinutos: 0,
    });

    expect(left).not.toBe(right);
  });
});
