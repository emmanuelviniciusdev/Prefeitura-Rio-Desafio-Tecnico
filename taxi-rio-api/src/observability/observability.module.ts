import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { MetricsController } from './metrics.controller';
import { MetricsServerShutdown } from './metrics.server';
import { QueueMetricsBinder } from './queue-metrics.binder';
import { shutdownTelemetry } from './telemetry';

@Injectable()
class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Module({
  imports: [RabbitmqModule],
  controllers: [MetricsController],
  providers: [TelemetryShutdown, QueueMetricsBinder, MetricsServerShutdown],
})
export class ObservabilityModule {}
