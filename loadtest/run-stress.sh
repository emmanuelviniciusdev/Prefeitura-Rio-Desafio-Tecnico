#!/usr/bin/env bash
# Runs the stress k6 ramp inside the compose network. Limits on the k6
# container are part of the experiment: if dropped_iterations rises or the
# achieved rate falls, the generator may be the bottleneck.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

HOST_BASE_URL="${HOST_BASE_URL:-http://localhost:3000}"
PROMETHEUS_HOST_URL="${PROMETHEUS_HOST_URL:-http://localhost:9090}"
RABBITMQ_MANAGEMENT_URL="${RABBITMQ_MANAGEMENT_URL:-http://localhost:15672}"
RABBITMQ_USER="${RABBITMQ_USER:-admin}"
RABBITMQ_PASSWORD="${RABBITMQ_PASSWORD:-admin}"
RESULTS_DIR="${ROOT}/loadtest/results"
STATS_FILE="${RESULTS_DIR}/docker-stats.jsonl"
LIMITS_FILE="${RESULTS_DIR}/docker-limits.jsonl"
INSPECT_FILE="${RESULTS_DIR}/docker-inspect.jsonl"
CGROUP_FILE="${RESULTS_DIR}/cgroup-cpu.jsonl"
RABBITMQ_FILE="${RESULTS_DIR}/rabbitmq.jsonl"
MYSQL_FILE="${RESULTS_DIR}/mysql.jsonl"
SUMMARY_FILE="${RESULTS_DIR}/stress-summary.json"

export STEPS="${STEPS:-10,25,50,75,100,150,200}"
export STEP_DURATION="${STEP_DURATION:-1m}"
export WARMUP_RATE="${WARMUP_RATE:-5}"
export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-200}"
export MAX_VUS="${MAX_VUS:-800}"
export K6_CPUS="${K6_CPUS:-1.0}"
export K6_MEMORY="${K6_MEMORY:-1g}"
export K6_SCRIPT="loadtest/stress.js"
export SUMMARY_PATH="loadtest/results/stress-summary.json"
export K6_UID="$(id -u)"
export K6_GID="$(id -g)"
export PROMETHEUS_HOST_URL

mkdir -p "${RESULTS_DIR}"
: > "${STATS_FILE}"
: > "${LIMITS_FILE}"
: > "${INSPECT_FILE}"
: > "${CGROUP_FILE}"
: > "${RABBITMQ_FILE}"
: > "${MYSQL_FILE}"

if ! curl -sf "${HOST_BASE_URL}/" >/dev/null; then
  echo "API is not healthy at ${HOST_BASE_URL}/. Start the stack with: docker compose up -d" >&2
  exit 1
fi

if ! curl -sf "${PROMETHEUS_HOST_URL}/-/healthy" >/dev/null; then
  echo "Prometheus is not healthy at ${PROMETHEUS_HOST_URL}. Per-step 5xx, API p95, queue depth and worker lag will be missing." >&2
fi

fetch_token() {
  local actor="$1"
  local body
  body="$(curl -sf -X POST "${HOST_BASE_URL}/auth/generate-token/${actor}")" || {
    echo "Failed to generate a ${actor} token at ${HOST_BASE_URL}." >&2
    exit 1
  }
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const parsed = JSON.parse(raw);
      if (typeof parsed.accessToken !== "string" || parsed.accessToken.length < 20) {
        process.exit(1);
      }
      process.stdout.write(parsed.accessToken);
    });
  ' <<<"${body}" || {
    echo "Token response for ${actor} did not include accessToken." >&2
    exit 1
  }
}

if [[ -z "${TOKEN_PASSAGEIRO:-}" || -z "${TOKEN_MOTORISTA:-}" ]]; then
  TOKEN_PASSAGEIRO="$(fetch_token passageiro)"
  TOKEN_MOTORISTA="$(fetch_token motorista)"
  export TOKEN_PASSAGEIRO TOKEN_MOTORISTA
fi

sample_once() {
  node "${ROOT}/loadtest/lib/host-sample.mjs" \
    --stats "${STATS_FILE}" \
    --limits "${LIMITS_FILE}" \
    --inspect "${INSPECT_FILE}" \
    --cgroup "${CGROUP_FILE}" \
    --rabbitmq "${RABBITMQ_FILE}" \
    --mysql "${MYSQL_FILE}" \
    --rabbitmq-url "${RABBITMQ_MANAGEMENT_URL}" \
    --rabbitmq-user "${RABBITMQ_USER}" \
    --rabbitmq-password "${RABBITMQ_PASSWORD}" \
    || true
}

(
  while true; do
    sample_once
    sleep 5
  done
) &
sampler_pid=$!

cleanup() {
  if [[ -n "${sampler_pid:-}" ]]; then
    kill "${sampler_pid}" >/dev/null 2>&1 || true
    wait "${sampler_pid}" >/dev/null 2>&1 || true
    sampler_pid=""
  fi
}
trap cleanup EXIT

set +e
docker compose --profile loadtest run --rm --no-deps \
  -e TOKEN_PASSAGEIRO \
  -e TOKEN_MOTORISTA \
  -e STEPS \
  -e STEP_DURATION \
  -e WARMUP_RATE \
  -e PRE_ALLOCATED_VUS \
  -e MAX_VUS \
  -e K6_CPUS \
  -e K6_MEMORY \
  -e BASE_URL=http://taxi-rio-api:3000 \
  -e PROMETHEUS_URL=http://prometheus:9090 \
  -e SUMMARY_PATH=loadtest/results/stress-summary.json \
  k6
k6_status=$?
set -e

cleanup
trap - EXIT

merge_args=(
  "${SUMMARY_FILE}"
  "${STATS_FILE}"
  "${LIMITS_FILE}"
  "${INSPECT_FILE}"
  "${CGROUP_FILE}"
  "${RABBITMQ_FILE}"
  "${MYSQL_FILE}"
)

if [[ -f "${SUMMARY_FILE}" ]]; then
  node "${ROOT}/loadtest/merge-observations.mjs" "${merge_args[@]}"
else
  echo "k6 did not write ${SUMMARY_FILE} (exit ${k6_status}). Building a partial report from host samples. Exit 137 usually means the k6 container was OOM-killed." >&2
  node "${ROOT}/loadtest/merge-observations.mjs" --partial "${merge_args[@]}"
fi

exit "${k6_status}"
