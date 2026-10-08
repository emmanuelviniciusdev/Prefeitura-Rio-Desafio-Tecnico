import './observability/register';
import { NestFactory } from '@nestjs/core';
import { configureMetrics, readMetricsPort } from './observability/metrics';
import { startMetricsServer } from './observability/metrics.server';
import { installStructuredLogger } from './observability/structured-logger';
import { readServiceName, startTelemetry } from './observability/telemetry';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap(): Promise<void> {
  const serviceName = readServiceName('taxi-rio-worker');
  startTelemetry(serviceName);
  configureMetrics(serviceName);
  const logger = installStructuredLogger(serviceName);
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger,
  });
  app.enableShutdownHooks();
  try {
    await startMetricsServer(readMetricsPort());
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap();
