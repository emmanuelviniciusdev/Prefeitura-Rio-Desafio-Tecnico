// Experiment defaults for the stress load test. STEPS and STEP_DURATION
// override the measured ramp. Warmup stays at a lower arrival rate so it
// does not define the result.

export const WARMUP_DURATION = '30s';
export const WARMUP_PRE_ALLOCATED_VUS = 10;
export const WARMUP_MAX_VUS = 50;

export const DEFAULT_STEPS = [10, 25, 50, 75, 100, 150, 200];
export const DEFAULT_STEP_DURATION = '1m';
export const STRESS_WARMUP_RATE = 5;
export const STRESS_PRE_ALLOCATED_VUS = 200;
export const STRESS_MAX_VUS = 800;
export const K6_CPU_WARN_RATIO = 0.8;
export const DEFAULT_K6_CPUS = '1.0';
export const DEFAULT_K6_MEMORY = '512m';
export const STRESS_K6_MEMORY = '1g';

// Public fixture baked into the passageiro token. Not a secret.
export const PASSENGER_USER_ID = 'e1c6c6d8-08d2-46ce-a670-4be04e1be1cb';

// Stress walks the legal lifecycle. `shouldPublishRideStatusChanged` is true
// for every status, so `initialized` already publishes to
// `corrida.status_alterado`. A second PATCH to `finished` is required to
// reach the worker path that fills `dh_fim` / elapsed time; skipping
// `initialized` is a 409. There is no `aceita` / `finalizada` status.
export const STRESS_STATUS_SEQUENCE = ['initialized', 'finished'];
export const STRESS_FINAL_STATUS = 'finished';

export const ROUTES = {
  create: 'POST /corridas',
  updateStatus: 'PATCH /corridas/:id/status',
  read: 'GET /corridas/:id',
};

export const STRESS_READS_PER_ITERATION = 4;
export const STRESS_WRITES_PER_ITERATION = 3;

export const SUMMARY_TREND_STATS = ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

// Declared cgroup limits from docker-compose.yml. The runner records the
// limits Docker actually enforced beside these values.
export const CONTAINER_LIMITS = [
  { service: 'mysql', container: 'taxi-rio-mysql', cpus: '1.0', memory: '1024m' },
  { service: 'redis', container: 'taxi-rio-redis', cpus: '0.25', memory: '64m' },
  { service: 'mongodb', container: 'taxi-rio-mongodb', cpus: '0.5', memory: '512m' },
  { service: 'rabbitmq', container: 'taxi-rio-rabbitmq', cpus: '0.75', memory: '256m' },
  { service: 'prometheus', container: 'taxi-rio-prometheus', cpus: '0.5', memory: '256m' },
  { service: 'jaeger', container: 'taxi-rio-jaeger', cpus: '0.5', memory: '256m' },
  { service: 'taxi-rio-api', container: 'taxi-rio-api', cpus: '1.0', memory: '256m' },
  { service: 'taxi-rio-worker', container: 'taxi-rio-worker', cpus: '0.25', memory: '128m' },
  { service: 'taxi-rio-app', container: 'taxi-rio-app', cpus: '0.25', memory: '64m' },
  { service: 'k6', container: 'k6', cpus: '1.0', memory: '512m' },
];

const DURATION_PATTERN = /^([1-9]\d*)(ms|s|m|h)$/;

export function readDuration(raw, fallback = DEFAULT_STEP_DURATION, name = 'STEP_DURATION') {
  if (isBlank(raw)) {
    return fallback;
  }

  const value = String(raw).trim();
  if (!DURATION_PATTERN.test(value)) {
    throw new Error(
      `${name} must be a positive integer with a unit (ms, s, m, h). Received: ${value}`,
    );
  }

  return value;
}

export function readSteps(raw) {
  const text = isBlank(raw) ? DEFAULT_STEPS.join(',') : String(raw).trim();
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('STEPS must list at least one positive integer.');
  }

  const steps = parts.map((part) => readPositiveInt(part, 'STEPS'));
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index] <= steps[index - 1]) {
      throw new Error(
        `STEPS must be strictly increasing. Received: ${steps.join(',')}`,
      );
    }
  }

  return steps;
}

export function stepTag(rate) {
  return `r${String(rate).padStart(3, '0')}`;
}

export function readVus(raw, fallback, name) {
  if (isBlank(raw)) {
    return fallback;
  }

  return readPositiveInt(String(raw).trim(), name);
}

export function readWarmupRate(raw, fallback = STRESS_WARMUP_RATE) {
  if (isBlank(raw)) {
    return fallback;
  }

  return readPositiveInt(String(raw).trim(), 'WARMUP_RATE');
}

export function vusForRate(rate, preAllocatedVUs, maxVUs) {
  const needed = Math.max(20, rate * 2);
  return {
    preAllocatedVUs: Math.min(maxVUs, Math.max(20, Math.min(preAllocatedVUs, needed))),
    maxVUs,
  };
}

export function durationToSeconds(value) {
  const parsed = DURATION_PATTERN.exec(value);
  if (!parsed) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const quantity = Number(parsed[1]);
  switch (parsed[2]) {
    case 'ms':
      return quantity / 1000;
    case 's':
      return quantity;
    case 'm':
      return quantity * 60;
    case 'h':
      return quantity * 3600;
    default:
      throw new Error(`Invalid duration: ${value}`);
  }
}

export function missingTokenMessage(env) {
  const passenger = text(env && env.TOKEN_PASSAGEIRO);
  const driver = text(env && env.TOKEN_MOTORISTA);
  if (passenger && driver) {
    return null;
  }

  return 'TOKEN_PASSAGEIRO and TOKEN_MOTORISTA must be set. This script does not embed secrets.';
}

export function stressThresholds(tags) {
  const abort = { abortOnFail: false };
  const thresholds = {
    'http_req_failed{phase:stress}': [{ threshold: 'rate<0.05', ...abort }],
    'http_req_duration{phase:stress}': [{ threshold: 'p(95)<2000', ...abort }],
  };

  for (const tag of tags) {
    thresholds[`http_req_failed{step:${tag}}`] = [{ threshold: 'rate<0.05', ...abort }];
    thresholds[`http_req_duration{step:${tag}}`] = [{ threshold: 'p(95)<2000', ...abort }];
    thresholds[`iterations{scenario:${tag}}`] = [{ threshold: 'count>0', ...abort }];
  }

  return thresholds;
}

function readPositiveInt(raw, name) {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }

  return Number(raw);
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
