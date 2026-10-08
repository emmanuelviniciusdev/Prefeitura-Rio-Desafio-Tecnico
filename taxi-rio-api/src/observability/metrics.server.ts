import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { metricsRegistry } from './metrics';

let server: Server | undefined;

export function startMetricsServer(
  port: number,
  host = '0.0.0.0',
): Promise<Server> {
  if (server?.listening) {
    return Promise.resolve(server);
  }

  const created = createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (request.method !== 'GET' || path !== '/metrics') {
      response.statusCode = 404;
      response.end();
      return;
    }

    void metricsRegistry.metrics().then(
      (body) => {
        if (response.writableEnded) {
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', metricsRegistry.contentType);
        response.end(body);
      },
      () => {
        if (response.writableEnded) {
          return;
        }
        response.statusCode = 500;
        response.end();
      },
    );
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    created.once('error', onError);
    created.listen(port, host, () => {
      created.off('error', onError);
      server = created;
      resolve(created);
    });
  });
}

export function stopMetricsServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    current.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

@Injectable()
export class MetricsServerShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await stopMetricsServer();
  }
}
