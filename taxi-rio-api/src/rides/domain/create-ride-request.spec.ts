import { normalizeCreateRide } from './create-ride-request';

describe('create ride request', () => {
  const userId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const dhInicio = '2026-10-07T18:00:00.000Z';

  it('trims locations and parses dhInicio', () => {
    expect(
      normalizeCreateRide({
        userId: `  ${userId}  `,
        localPartida: '  Copacabana ',
        localDestino: ' Ipanema  ',
        dhInicio,
      }),
    ).toEqual({
      userId,
      localPartida: 'Copacabana',
      localDestino: 'Ipanema',
      startedAt: new Date(dhInicio),
    });
  });
});
