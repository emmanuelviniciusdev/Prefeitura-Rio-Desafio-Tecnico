import { tracesEndpoint } from './telemetry';

describe('tracesEndpoint', () => {
  it('builds the OTLP HTTP traces URL from the collector base', () => {
    expect(tracesEndpoint('http://jaeger:4318')).toBe(
      'http://jaeger:4318/v1/traces',
    );
    expect(tracesEndpoint('http://jaeger:4318/')).toBe(
      'http://jaeger:4318/v1/traces',
    );
    expect(tracesEndpoint('http://jaeger:4318/v1/traces')).toBe(
      'http://jaeger:4318/v1/traces',
    );
  });
});
