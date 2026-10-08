import './observability/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { configureMetrics } from './observability/metrics';
import { installStructuredLogger } from './observability/structured-logger';
import { readServiceName, startTelemetry } from './observability/telemetry';

async function bootstrap(): Promise<void> {
  const serviceName = readServiceName('taxi-rio-api');
  startTelemetry(serviceName);
  configureMetrics(serviceName);
  const logger = installStructuredLogger(serviceName);
  const app = await NestFactory.create(AppModule, { logger });
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
