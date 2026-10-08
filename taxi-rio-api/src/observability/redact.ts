const REDACTED = '[REDACTED]';

const PEM_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const CREDENTIAL_URL_PATTERN =
  /\b((?:mongodb(?:\+srv)?|amqp|amqps|redis|rediss|https?|mysql):\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|password|private[_-]?key|client[_-]?secret|api[_-]?key|secret|token)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,}&]+)/gi;
const SENSITIVE_JSON_PATTERN =
  /("(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|password|private[_-]?key|client[_-]?secret|api[_-]?key|secret|token)"\s*:\s*")([^"]*)(")/gi;

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export function redactString(value: string): string {
  return value
    .replace(PEM_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(CREDENTIAL_URL_PATTERN, `$1${REDACTED}@`)
    .replace(SENSITIVE_JSON_PATTERN, `$1${REDACTED}$3`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1=${REDACTED}`);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested, seen);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, '').toLowerCase();
  if (
    normalized === 'authorization' ||
    normalized === 'password' ||
    normalized === 'passwd' ||
    normalized === 'secret' ||
    normalized === 'apikey' ||
    normalized === 'privatekey' ||
    normalized === 'clientsecret' ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized === 'jwt' ||
    normalized === 'bearer' ||
    normalized === 'token'
  ) {
    return true;
  }

  return (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey')
  );
}
