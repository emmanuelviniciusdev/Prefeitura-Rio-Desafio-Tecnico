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
import {
  runWithConsumeSpan,
  runWithPublishSpan,
} from '../observability/trace-context';

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
    await runWithPublishSpan(queue, async (headers) => {
      const sent = channel.sendToQueue(queue, content, {
        persistent: true,
        contentType: 'application/json',
        headers,
      });
      if (!sent) {
        await once(channel, 'drain');
      }
      this.logger.log({
        message: 'Published message',
        queue,
      });
    });
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

    const queue = message.fields.routingKey || 'unknown';
    const headers = readMessageHeaders(message);
    let payload: unknown;
    try {
      payload = JSON.parse(message.content.toString('utf8')) as unknown;
    } catch (error) {
      await runWithConsumeSpan(queue, headers, () => {
        this.logger.warn({
          message: 'Dropped invalid JSON message',
          queue,
          error: errorMessage(error),
        });
        return Promise.resolve();
      });
      channel.nack(message, false, false);
      return;
    }

    try {
      await runWithConsumeSpan(queue, headers, async () => {
        try {
          this.logger.log({
            message: 'Processing message',
            queue,
          });
          await handler(payload);
        } catch (error) {
          this.logger.warn({
            message: 'Failed to process message',
            queue,
            error: errorMessage(error),
          });
          throw error;
        }
      });
      channel.ack(message);
    } catch {
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

function readMessageHeaders(
  message: ConsumeMessage,
): Record<string, unknown> | undefined {
  const headers: unknown = message.properties.headers;
  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }

  return headers as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
