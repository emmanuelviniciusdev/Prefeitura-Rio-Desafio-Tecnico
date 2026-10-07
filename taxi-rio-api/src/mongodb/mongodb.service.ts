import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Collection, type Document } from 'mongodb';
import type { MongodbConfig } from '../config/app.config';

@Injectable()
export class MongodbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongodbService.name);
  private readonly client: MongoClient;
  private readonly databaseName: string;

  constructor(config: ConfigService) {
    const mongodb = config.getOrThrow<MongodbConfig>('app.mongodb');
    this.databaseName = mongodb.database;
    this.client = new MongoClient(mongodb.uri, { directConnection: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  collection<T extends Document>(name: string): Collection<T> {
    return this.client.db(this.databaseName).collection<T>(name);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.close();
    } catch (error) {
      this.logger.warn(
        `MongoDB shutdown failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
