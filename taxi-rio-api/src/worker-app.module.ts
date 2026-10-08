import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { appConfig } from './config/app.config';
import { ObservabilityModule } from './observability/observability.module';
import { RideAuditModule } from './rides/audit/ride-audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: join(__dirname, '../.env'),
    }),
    ObservabilityModule,
    RideAuditModule,
  ],
})
export class WorkerAppModule {}
