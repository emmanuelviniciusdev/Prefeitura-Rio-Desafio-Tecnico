import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { NoopSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { isIgnoredHttpPath } from './http-paths';

const REDACTED_QUERY_PARAMS = [
  'sig',
  'Signature',
  'AWSAccessKeyId',
  'X-Goog-Signature',
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Security-Token',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'api_key',
  'apikey',
  'secret',
  'password',
  'private_key',
  'authorization',
];

let sdk: NodeSDK | undefined;

export function readServiceName(fallback: string): string {
  const configured = process.env.OTEL_SERVICE_NAME?.trim();
  if (!configured) {
    return fallback;
  }

  return configured;
}

export function startTelemetry(serviceName: string): void {
  if (sdk) {
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  sdk = new NodeSDK({
    serviceName,
    instrumentations: [
      new HttpInstrumentation({
        disableOutgoingRequestInstrumentation: true,
        ignoreIncomingRequestHook: (request) => isIgnoredHttpPath(request.url),
        redactedQueryParams: REDACTED_QUERY_PARAMS,
        redactedQueryParamsServer: REDACTED_QUERY_PARAMS,
      }),
    ],
    ...(endpoint
      ? {
          traceExporter: new OTLPTraceExporter({
            url: tracesEndpoint(endpoint),
          }),
        }
      : { spanProcessors: [new NoopSpanProcessor()] }),
  });
  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  if (!current) {
    return;
  }

  await current.shutdown();
}

export function tracesEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, '');
  if (trimmed.endsWith('/v1/traces')) {
    return trimmed;
  }

  return `${trimmed}/v1/traces`;
}
