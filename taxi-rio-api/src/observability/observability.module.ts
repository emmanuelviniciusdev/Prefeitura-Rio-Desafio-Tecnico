import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from './telemetry';

@Injectable()
class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Module({
  providers: [TelemetryShutdown],
})
export class ObservabilityModule {}
