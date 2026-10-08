import { redact, redactString } from './redact';

describe('redact', () => {
  it('removes tokens and secrets from objects but keeps user_id', () => {
    expect(
      redact({
        ride_id: '11111111-1111-4111-8111-111111111111',
        status: 'requested',
        userId: 'user-1',
        user_id: 'user-2',
        token: 'tok-1',
        accessToken: 'tok-2',
        authorization: 'Bearer abc',
        privateKey: 'pem',
        nested: { password: 'pw', api_key: 'key' },
      }),
    ).toEqual({
      ride_id: '11111111-1111-4111-8111-111111111111',
      status: 'requested',
      userId: 'user-1',
      user_id: 'user-2',
      token: '[REDACTED]',
      accessToken: '[REDACTED]',
      authorization: '[REDACTED]',
      privateKey: '[REDACTED]',
      nested: { password: '[REDACTED]', api_key: '[REDACTED]' },
    });
  });

  it('redacts secrets embedded in strings', () => {
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'c2VjcmV0',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature';

    expect(redactString(`key ${pem} end`)).toBe('key [REDACTED] end');
    expect(redactString(`Authorization: Bearer ${jwt}`)).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(redactString('amqp://admin:admin@rabbitmq:5672/vhost')).toBe(
      'amqp://[REDACTED]@rabbitmq:5672/vhost',
    );
    expect(
      redactString(
        'mongodb://admin:admin@mongodb:27017/taxi_rio?authSource=admin',
      ),
    ).toBe('mongodb://[REDACTED]@mongodb:27017/taxi_rio?authSource=admin');
    expect(redactString('user_id=user-1 token=tok-1 status=requested')).toBe(
      'user_id=user-1 token=[REDACTED] status=requested',
    );
    expect(redactString('{"userId":"user-1","id_corrida":"ride-1"}')).toBe(
      '{"userId":"user-1","id_corrida":"ride-1"}',
    );
  });
});
