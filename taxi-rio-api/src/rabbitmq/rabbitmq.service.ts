import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from 'amqplib';
import { once } from 'node:events';
import type { RabbitmqConfig } from '../config/app.config';

export type MessageHandler = (payload: unknown) => Promise<void>;

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private readonly url: string;
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<RabbitmqConfig>('app.rabbitmq').url;
  }

  async onModuleInit(): Promise<void> {
    const connection = await connect(this.url);
    connection.on('error', (error: Error) => {
      this.logger.warn(`RabbitMQ connection error: ${error.message}`);
    });
    const channel = await connection.createChannel();
    channel.on('error', (error: Error) => {
      this.logger.warn(`RabbitMQ channel error: ${error.message}`);
    });
    await channel.prefetch(1);
    this.connection = connection;
    this.channel = channel;
  }

  async publish(queue: string, payload: unknown): Promise<void> {
    const channel = this.requireChannel();
    await channel.assertQueue(queue, { durable: true });
    const content = Buffer.from(JSON.stringify(payload));
    const sent = channel.sendToQueue(queue, content, {
      persistent: true,
      contentType: 'application/json',
    });
    if (!sent) {
      await once(channel, 'drain');
    }
  }

  async consume(queue: string, handler: MessageHandler): Promise<void> {
    const channel = this.requireChannel();
    await channel.assertQueue(queue, { durable: true });
    await channel.consume(queue, (message) => {
      void this.handleDelivery(channel, message, handler);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close(this.channel, 'channel');
    await this.close(this.connection, 'connection');
  }

  private async handleDelivery(
    channel: Channel,
    message: ConsumeMessage | null,
    handler: MessageHandler,
  ): Promise<void> {
    if (!message) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message.content.toString('utf8')) as unknown;
    } catch (error) {
      this.logger.warn(
        `Dropped invalid JSON from ${message.fields.routingKey}: ${errorMessage(error)}`,
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      await handler(payload);
      channel.ack(message);
    } catch (error) {
      this.logger.warn(
        `Failed to process ${message.fields.routingKey}: ${errorMessage(error)}`,
      );
      channel.nack(message, false, true);
    }
  }

  private requireChannel(): Channel {
    if (!this.channel) {
      throw new Error('RabbitMQ channel is not connected');
    }

    return this.channel;
  }

  private async close(
    closable: { close(): Promise<void> } | undefined,
    label: string,
  ): Promise<void> {
    if (!closable) {
      return;
    }

    try {
      await closable.close();
    } catch (error) {
      this.logger.warn(
        `RabbitMQ ${label} shutdown failed: ${errorMessage(error)}`,
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
