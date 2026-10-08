import { readServiceName, startTelemetry } from './telemetry';

startTelemetry(readServiceName(defaultServiceName()));

function defaultServiceName(): string {
  const entry = process.argv[1] ?? '';
  return entry.includes('worker') ? 'taxi-rio-worker' : 'taxi-rio-api';
}
