import { Logger, type LoggerService } from '@nestjs/common';
import { activeTraceFields } from './trace-context';
import { redact, redactString } from './redact';

export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StructuredLog {
  level: StructuredLogLevel;
  service: string;
  message: string;
  context?: string;
  stack?: string;
  fields?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
}

const RESERVED_FIELDS = new Set([
  'timestamp',
  'level',
  'service',
  'context',
  'message',
  'stack',
  'trace_id',
  'span_id',
]);

let configuredServiceName =
  process.env.OTEL_SERVICE_NAME?.trim() || 'taxi-rio-api';

export function currentServiceName(): string {
  return configuredServiceName;
}

export function installStructuredLogger(serviceName: string): StructuredLogger {
  configuredServiceName = serviceName;
  const logger = new StructuredLogger(serviceName);
  Logger.overrideLogger(logger);
  return logger;
}

export class StructuredLogger implements LoggerService {
  constructor(private readonly service: string) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams, true);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams, true);
  }

  private write(
    level: StructuredLogLevel,
    message: unknown,
    optionalParams: unknown[],
    includeStack = false,
  ): void {
    const parsed = includeStack
      ? splitErrorArguments([message, ...optionalParams])
      : splitLogArguments([message, ...optionalParams]);
    const content = messageAndFields(parsed.messages);
    writeStructuredLog({
      level,
      service: this.service,
      message: content.message,
      context: parsed.context,
      stack: parsed.stack,
      fields: content.fields,
    });
  }
}

export function writeStructuredLog(entry: StructuredLog): void {
  const redactedFields = redact(entry.fields ?? {});
  const fields = isRecord(redactedFields) ? redactedFields : {};
  for (const key of RESERVED_FIELDS) {
    delete fields[key];
  }

  const active = activeTraceFields();
  const traceId = entry.traceId ?? active.trace_id;
  const spanId = entry.spanId ?? active.span_id;
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    service: entry.service,
    ...fields,
  };
  if (entry.context) {
    record.context = entry.context;
  }
  record.message = redactString(entry.message);
  if (traceId) {
    record.trace_id = traceId;
  }
  if (spanId) {
    record.span_id = spanId;
  }
  if (entry.stack) {
    record.stack = redactString(entry.stack);
  }

  const line = `${safeJson(record)}\n`;
  const stream =
    entry.level === 'warn' || entry.level === 'error' || entry.level === 'fatal'
      ? process.stderr
      : process.stdout;
  stream.write(line);
}

function splitLogArguments(args: unknown[]): {
  context?: string;
  messages: unknown[];
  stack?: string;
} {
  return { ...contextAndMessages(args), stack: undefined };
}

function splitErrorArguments(args: unknown[]): {
  context?: string;
  messages: unknown[];
  stack?: string;
} {
  if (args.length === 2) {
    if (isStackFormat(args[1]) || args[1] === undefined) {
      return {
        messages: [args[0]],
        stack: typeof args[1] === 'string' ? args[1] : undefined,
      };
    }
    return { ...contextAndMessages(args), stack: undefined };
  }

  const { messages, context } = contextAndMessages(args);
  if (messages.length <= 1) {
    return { messages, context };
  }

  const last = messages[messages.length - 1];
  if (typeof last !== 'string' && last !== undefined) {
    return { messages, context };
  }

  return {
    context,
    stack: typeof last === 'string' ? last : undefined,
    messages: messages.slice(0, -1),
  };
}

function contextAndMessages(args: unknown[]): {
  context?: string;
  messages: unknown[];
} {
  if (args.length <= 1) {
    return { messages: args };
  }

  const last = args[args.length - 1];
  if (typeof last !== 'string') {
    return { messages: args };
  }

  return {
    context: last,
    messages: args.slice(0, -1),
  };
}

function messageAndFields(messages: unknown[]): {
  message: string;
  fields: Record<string, unknown>;
} {
  const [first, ...rest] = messages;
  if (isRecord(first)) {
    const { message: nested, ...fields } = first;
    return {
      message: typeof nested === 'string' ? nested : 'log',
      fields: rest.length > 0 ? { ...fields, details: rest } : fields,
    };
  }
  if (first instanceof Error) {
    return {
      message: first.message,
      fields: rest.length > 0 ? { details: rest } : {},
    };
  }

  return {
    message: stringifyMessage(first),
    fields: rest.length > 0 ? { details: rest } : {},
  };
}

function stringifyMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return safeJson(redact(value));
}

function isStackFormat(stack: unknown): stack is string {
  return typeof stack === 'string' && /^(.)+\n\s+at .+:\d+:\d+/.test(stack);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ message: 'Failed to serialize log' });
  }
}
