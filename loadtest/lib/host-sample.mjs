import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const CGROUP_CONTAINERS = ['taxi-rio-api', 'taxi-rio-worker'];
const CGROUP_PATHS = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu/cpu.stat'];

export async function sampleOnce(paths) {
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
  const raw = docker([
    'exec',
    'taxi-rio-mysql',
    'mysql',
    '-N',
    '-uroot',
    '-proot',
    '-e',
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Aborted_connects'); SHOW GLOBAL VARIABLES WHERE Variable_name='max_connections';",
  ]);
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

function docker(args) {
  try {
    return execFileSync('docker', args, {
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
