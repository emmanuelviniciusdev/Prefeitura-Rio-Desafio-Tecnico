import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const CGROUP_CONTAINERS = ['taxi-rio-api', 'taxi-rio-worker'];
const CGROUP_PATHS = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu/cpu.stat'];
const MYSQL_STATUS_SQL =
  "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Aborted_connects'); SHOW GLOBAL VARIABLES WHERE Variable_name='max_connections';";
const APP_TO_CONTAINER = {
  'taxi-rio-api': 'taxi-rio-api',
  'taxi-rio-worker': 'taxi-rio-worker',
  'taxi-rio-app': 'taxi-rio-app',
  mysql: 'taxi-rio-mysql',
  redis: 'taxi-rio-redis',
  mongodb: 'taxi-rio-mongodb',
  rabbitmq: 'taxi-rio-rabbitmq',
  prometheus: 'taxi-rio-prometheus',
  jaeger: 'taxi-rio-jaeger',
};
const EXEC_CONTAINERS = {
  'taxi-rio-api': 'taxi-rio-api',
  'taxi-rio-worker': 'taxi-rio-worker',
  'taxi-rio-mysql': 'mysql',
};

export async function sampleOnce(paths) {
  if (paths.runtime === 'k3d') {
    await sampleK3dOnce(paths);
    return;
  }

  const sampledAt = new Date().toISOString();
  const ids = docker(['ps', '-q']).trim().split(/\s+/).filter(Boolean);

  sampleStats(paths.stats, sampledAt);
  if (ids.length > 0) {
    sampleLimits(paths.limits, ids);
    sampleInspect(paths.inspect, ids, sampledAt);
  }
  sampleCgroup(paths.cgroup, sampledAt);
  await sampleRabbitmq(paths.rabbitmq, sampledAt, paths.rabbitmqUrl, paths.rabbitmqUser, paths.rabbitmqPassword);
  sampleMysql(paths.mysql, sampledAt);
}

async function sampleK3dOnce(paths) {
  const sampledAt = new Date().toISOString();
  const namespace = paths.namespace || 'taxi-rio';
  const pods = listNamespacedPods(namespace);

  sampleK3dStats(paths.stats, sampledAt, namespace, pods);
  sampleK3dLimits(paths.limits, pods);
  sampleK3dInspect(paths.inspect, pods, sampledAt);
  sampleK3dCgroup(paths.cgroup, namespace, pods, sampledAt);
  await sampleRabbitmq(paths.rabbitmq, sampledAt, paths.rabbitmqUrl, paths.rabbitmqUser, paths.rabbitmqPassword);
  sampleK3dMysql(paths.mysql, namespace, pods, sampledAt);
}

function sampleStats(file, sampledAt) {
  const raw = docker(['stats', '--no-stream', '--format', '{{json .}}']);
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      parsed.sampledAt = sampledAt;
      appendFileSync(file, `${JSON.stringify(parsed)}\n`);
    } catch {
      continue;
    }
  }
}

function sampleLimits(file, ids) {
  const raw = docker([
    'inspect',
    '--format',
    '{"name":"{{.Name}}","nanoCpus":{{.HostConfig.NanoCpus}},"memory":{{.HostConfig.Memory}}}',
    ...ids,
  ]);
  if (raw.trim()) {
    appendFileSync(file, raw.endsWith('\n') ? raw : `${raw}\n`);
  }
}

function sampleInspect(file, ids, sampledAt) {
  const raw = docker([
    'inspect',
    '--format',
    '{"name":"{{.Name}}","oomKilled":{{.State.OOMKilled}},"restartCount":{{.RestartCount}},"status":"{{.State.Status}}","startedAt":"{{.State.StartedAt}}","pid":{{.State.Pid}}}',
    ...ids,
  ]);
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      parsed.sampledAt = sampledAt;
      appendFileSync(file, `${JSON.stringify(parsed)}\n`);
    } catch {
      continue;
    }
  }
}

function sampleCgroup(file, sampledAt) {
  for (const container of CGROUP_CONTAINERS) {
    let raw = '';
    for (const path of CGROUP_PATHS) {
      raw = docker(['exec', container, 'cat', path]);
      if (raw.trim()) {
        break;
      }
    }
    appendFileSync(
      file,
      `${JSON.stringify({
        sampledAt,
        container,
        available: Boolean(raw.trim()),
        raw: raw.trim(),
      })}\n`,
    );
  }
}

async function sampleRabbitmq(file, sampledAt, url, user, password) {
  const base = (url || 'http://localhost:15672').replace(/\/$/, '');
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user || 'admin'}:${password || 'admin'}`).toString('base64')}`,
  };
  const hint =
    'Prometheus does not scrape RabbitMQ. Open http://localhost:15672 (admin/admin) and check Nodes → memory alarm and Connections with state=blocked, or run: docker exec taxi-rio-rabbitmq rabbitmq-diagnostics check_local_alarms';

  try {
    const [nodes, connections] = await Promise.all([
      fetchJson(`${base}/api/nodes`, headers),
      fetchJson(`${base}/api/connections`, headers),
    ]);
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const connectionList = Array.isArray(connections) ? connections : [];
    appendFileSync(
      file,
      `${JSON.stringify({
        sampledAt,
        available: true,
        memAlarm: nodeList.some((node) => node.mem_alarm),
        diskAlarm: nodeList.some((node) => node.disk_free_alarm),
        blockedConnections: connectionList.filter((connection) => connection.state === 'blocked').length,
        hint: null,
      })}\n`,
    );
  } catch {
    appendFileSync(
      file,
      `${JSON.stringify({
        sampledAt,
        available: false,
        memAlarm: null,
        diskAlarm: null,
        blockedConnections: null,
        hint,
      })}\n`,
    );
  }
}

function sampleMysql(file, sampledAt) {
  writeMysqlSample(
    file,
    sampledAt,
    docker(['exec', 'taxi-rio-mysql', 'mysql', '-N', '-uroot', '-proot', '-e', MYSQL_STATUS_SQL]),
  );
}

function sampleK3dStats(file, sampledAt, namespace, pods) {
  const byPodName = new Map();
  for (const pod of pods) {
    const canonical = canonicalContainerName(pod);
    if (canonical) {
      byPodName.set(pod.metadata?.name, canonical);
    }
  }

  const raw = kubectl(['top', 'pods', '-n', namespace, '--no-headers']);
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) {
      continue;
    }
    const canonical = byPodName.get(parts[0]);
    if (!canonical) {
      continue;
    }
    appendFileSync(
      file,
      `${JSON.stringify({
        Name: canonical,
        CPUPerc: cpuQuantityToPercent(parts[1]),
        MemUsage: `${normalizeTopMemory(parts[2])} / 0B`,
        sampledAt,
      })}\n`,
    );
  }
}

function sampleK3dLimits(file, pods) {
  const seen = new Set();
  for (const pod of pods) {
    const name = canonicalContainerName(pod);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const resources = containerLimits(pod, name);
    appendFileSync(
      file,
      `${JSON.stringify({
        name,
        nanoCpus: resources.nanoCpus,
        memory: resources.memoryBytes,
      })}\n`,
    );
  }
}

function sampleK3dInspect(file, pods, sampledAt) {
  const byName = new Map();
  for (const pod of pods) {
    const name = canonicalContainerName(pod);
    if (!name) {
      continue;
    }
    const status = podInspect(pod, name);
    const current = byName.get(name);
    if (!current) {
      byName.set(name, { name, ...status });
      continue;
    }
    current.oomKilled = current.oomKilled || status.oomKilled;
    current.restartCount += status.restartCount;
    if (status.status && status.status !== 'running') {
      current.status = status.status;
    }
    if (status.startedAt && (!current.startedAt || status.startedAt < current.startedAt)) {
      current.startedAt = status.startedAt;
    }
  }

  for (const row of byName.values()) {
    appendFileSync(file, `${JSON.stringify({ ...row, sampledAt, pid: 0 })}\n`);
  }
}

function sampleK3dCgroup(file, namespace, pods, sampledAt) {
  for (const container of CGROUP_CONTAINERS) {
    const pod = runningPod(pods, container);
    let raw = '';
    if (pod) {
      const execContainer = EXEC_CONTAINERS[container] || container;
      for (const path of CGROUP_PATHS) {
        raw = kubectl(['exec', '-n', namespace, pod.metadata.name, '-c', execContainer, '--', 'cat', path]);
        if (raw.trim()) {
          break;
        }
      }
    }
    appendFileSync(
      file,
      `${JSON.stringify({
        sampledAt,
        container,
        available: Boolean(raw.trim()),
        raw: raw.trim(),
      })}\n`,
    );
  }
}

function sampleK3dMysql(file, namespace, pods, sampledAt) {
  const pod = runningPod(pods, 'taxi-rio-mysql');
  const raw = pod
    ? kubectl([
        'exec',
        '-n',
        namespace,
        pod.metadata.name,
        '-c',
        EXEC_CONTAINERS['taxi-rio-mysql'],
        '--',
        'mysql',
        '-N',
        '-uroot',
        '-proot',
        '-e',
        MYSQL_STATUS_SQL,
      ])
    : '';
  writeMysqlSample(file, sampledAt, raw);
}

function writeMysqlSample(file, sampledAt, raw) {
  if (!raw.trim()) {
    appendFileSync(
      file,
      `${JSON.stringify({
        sampledAt,
        available: false,
        hint: 'Could not run SHOW GLOBAL STATUS inside taxi-rio-mysql. The API does not export TypeORM pool metrics.',
      })}\n`,
    );
    return;
  }

  const values = {};
  for (const line of raw.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      values[parts[0]] = Number(parts[1]);
    }
  }

  appendFileSync(
    file,
    `${JSON.stringify({
      sampledAt,
      available: true,
      threadsConnected: values.Threads_connected ?? null,
      threadsRunning: values.Threads_running ?? null,
      maxUsedConnections: values.Max_used_connections ?? null,
      abortedConnects: values.Aborted_connects ?? null,
      maxConnections: values.max_connections ?? null,
      hint: null,
    })}\n`,
  );
}

function listNamespacedPods(namespace) {
  const raw = kubectl(['get', 'pods', '-n', namespace, '-o', 'json']);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function canonicalContainerName(pod) {
  const app = pod?.metadata?.labels?.['app.kubernetes.io/name'];
  return APP_TO_CONTAINER[app] || null;
}

function runningPod(pods, canonical) {
  return pods.find(
    (pod) => canonicalContainerName(pod) === canonical && pod.status?.phase === 'Running',
  );
}

function mainContainer(pod, canonical) {
  const expected = EXEC_CONTAINERS[canonical];
  const containers = pod.spec?.containers || [];
  return containers.find((container) => container.name === expected) || containers[0];
}

function containerLimits(pod, canonical) {
  const limits = mainContainer(pod, canonical)?.resources?.limits || {};
  return {
    nanoCpus: cpuToNanoCpus(limits.cpu),
    memoryBytes: memoryToBytes(limits.memory),
  };
}

function podInspect(pod, canonical) {
  const expected = EXEC_CONTAINERS[canonical];
  const statuses = pod.status?.containerStatuses || [];
  const status =
    statuses.find((item) => item.name === expected) || statuses[0] || {};
  const terminated = status.state?.terminated || status.lastState?.terminated || {};
  return {
    oomKilled: terminated.reason === 'OOMKilled',
    restartCount: Number.isFinite(Number(status.restartCount)) ? Number(status.restartCount) : 0,
    status: String(pod.status?.phase || '').toLowerCase(),
    startedAt: status.state?.running?.startedAt || '',
  };
}

function cpuToNanoCpus(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const text = String(value);
  if (text.endsWith('m')) {
    const millicores = Number(text.slice(0, -1));
    return Number.isFinite(millicores) ? millicores * 1e6 : 0;
  }
  const cores = Number(text);
  return Number.isFinite(cores) ? cores * 1e9 : 0;
}

function memoryToBytes(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const match = /^([0-9]+(?:\.[0-9]+)?)(Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|K)?$/.exec(String(value));
  if (!match) {
    return 0;
  }
  const quantity = Number(match[1]);
  const unit = match[2] || '';
  const binary = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
  const decimal = { K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4, P: 1000 ** 5, E: 1000 ** 6 };
  const multiplier = binary[unit] || decimal[unit] || 1;
  return Number.isFinite(quantity) ? quantity * multiplier : 0;
}

function cpuQuantityToPercent(value) {
  const text = String(value || '').trim();
  if (text.endsWith('m')) {
    const millicores = Number(text.slice(0, -1));
    return Number.isFinite(millicores) ? `${(millicores / 10).toFixed(2)}%` : '0.00%';
  }
  const cores = Number(text);
  return Number.isFinite(cores) ? `${(cores * 100).toFixed(2)}%` : '0.00%';
}

function normalizeTopMemory(value) {
  const text = String(value || '').trim();
  if (/i$/.test(text)) {
    return `${text}B`;
  }
  return text;
}

function docker(args) {
  return runCommand('docker', args);
}

function kubectl(args) {
  return runCommand('kubectl', args);
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function parseArgs(argv) {
  const paths = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--') || value === undefined) {
      continue;
    }
    paths[key.slice(2)] = value;
    index += 1;
  }
  return {
    runtime: paths.runtime || 'compose',
    namespace: paths.namespace || 'taxi-rio',
    stats: paths.stats,
    limits: paths.limits,
    inspect: paths.inspect,
    cgroup: paths.cgroup,
    rabbitmq: paths.rabbitmq,
    mysql: paths.mysql,
    rabbitmqUrl: paths['rabbitmq-url'],
    rabbitmqUser: paths['rabbitmq-user'],
    rabbitmqPassword: paths['rabbitmq-password'],
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith('host-sample.mjs');
if (isMain) {
  const paths = parseArgs(process.argv.slice(2));
  sampleOnce(paths).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
