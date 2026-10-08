import './observability/register';
import { NestFactory } from '@nestjs/core';
import { installStructuredLogger } from './observability/structured-logger';
import { readServiceName, startTelemetry } from './observability/telemetry';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap(): Promise<void> {
  const serviceName = readServiceName('taxi-rio-worker');
  startTelemetry(serviceName);
  const logger = installStructuredLogger(serviceName);
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger,
  });
  app.enableShutdownHooks();
}

void bootstrap();
