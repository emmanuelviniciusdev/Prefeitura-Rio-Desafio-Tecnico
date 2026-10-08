import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthModule } from '../auth/auth.module';
import { appConfig } from '../config/app.config';
import { useExampleJwtEnv } from '../../test/jwt-env';
import { MetricsController } from './metrics.controller';

@Controller('secret')
class SecretController {
  @Get()
  secret(): string {
    return 'nope';
  }
}

describe('MetricsController', () => {
  let app: INestApplication<App>;
  const previousWorkerUrl = process.env.WORKER_METRICS_URL;

  beforeAll(async () => {
    process.env.WORKER_METRICS_URL = '';
    useExampleJwtEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [appConfig],
        }),
        AuthModule,
      ],
      controllers: [MetricsController, SecretController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (previousWorkerUrl === undefined) {
      delete process.env.WORKER_METRICS_URL;
    } else {
      process.env.WORKER_METRICS_URL = previousWorkerUrl;
    }
    await app?.close();
  });

  it('exposes Prometheus metrics without a token', async () => {
    await request(app.getHttpServer()).get('/secret').expect(401);

    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('# TYPE http_requests_total counter');
    expect(response.text).toContain(
      '# TYPE http_request_duration_seconds histogram',
    );
    expect(response.text).toContain('# TYPE http_request_errors_total counter');
    expect(response.text).toContain('# TYPE queue_messages gauge');
    expect(response.text).toContain('# TYPE queue_delay_seconds histogram');
  });
});
