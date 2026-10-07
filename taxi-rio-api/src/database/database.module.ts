import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { MysqlConfig } from '../config/app.config';
import { Ride } from '../rides/domain/ride.entity';
import { CreateCorridas1791396000000 } from './migrations/1791396000000-CreateCorridas';
import { MoveIdempotencyKeyOntoCorridas1791397000000 } from './migrations/1791397000000-MoveIdempotencyKeyOntoCorridas';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mysql = config.getOrThrow<MysqlConfig>('app.mysql');

        return {
          type: 'mysql' as const,
          host: mysql.host,
          port: mysql.port,
          username: mysql.username,
          password: mysql.password,
          database: mysql.database,
          charset: 'utf8mb4',
          timezone: 'Z',
          entities: [Ride],
          migrations: [
            CreateCorridas1791396000000,
            MoveIdempotencyKeyOntoCorridas1791397000000,
          ],
          migrationsRun: true,
          migrationsTransactionMode: 'none',
          synchronize: false,
          retryAttempts: 10,
          retryDelay: 2000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
