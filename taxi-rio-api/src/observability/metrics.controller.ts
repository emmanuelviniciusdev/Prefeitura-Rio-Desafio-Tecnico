import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import {
  METRICS_SCOPE_HEADER,
  metricsRegistry,
  renderMetrics,
} from './metrics';

@ApiExcludeController()
@Public()
@Controller()
export class MetricsController {
  @Get('metrics')
  async scrape(
    @Headers(METRICS_SCOPE_HEADER) scope: string | string[] | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const body = await renderMetrics(firstHeader(scope));
    response
      .status(200)
      .setHeader('Content-Type', metricsRegistry.contentType)
      .setHeader('Cache-Control', 'no-store')
      .send(body);
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}
