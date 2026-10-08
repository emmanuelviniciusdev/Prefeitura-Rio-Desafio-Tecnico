import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { appConfig } from './config/app.config';
import { DatabaseModule } from './database/database.module';
import { ObservabilityModule } from './observability/observability.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { RedisModule } from './redis/redis.module';
import { RidesModule } from './rides/rides.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: join(__dirname, '../.env'),
    }),
    ObservabilityModule,
    AuthModule,
    DatabaseModule,
    RedisModule,
    RabbitmqModule,
    RidesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
