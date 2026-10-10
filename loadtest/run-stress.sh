#!/usr/bin/env bash
# Runs the stress k6 ramp against Compose or k3d. Limits on the k6
# container are part of the experiment: if dropped_iterations rises or the
# achieved rate falls, the generator may be the bottleneck.
#
#   STRESS_TARGET=compose ./loadtest/run-stress.sh
#   STRESS_TARGET=k3d ./loadtest/run-stress.sh
#
# Prefer the Makefile targets, which check that the chosen stack is already
# running and then invoke this script:
#   make stress-with-dockercompose
#   make stress-with-k3d
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

STRESS_TARGET="${STRESS_TARGET:-compose}"
K8S_NAMESPACE="${K8S_NAMESPACE:-taxi-rio}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.3.0}"
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

RABBITMQ_USER="${RABBITMQ_USER:-admin}"
RABBITMQ_PASSWORD="${RABBITMQ_PASSWORD:-admin}"

prometheus_pf_pid=""
rabbitmq_pf_pid=""
sampler_pid=""

case "${STRESS_TARGET}" in
  compose|docker-compose)
    STRESS_TARGET="compose"
    HOST_BASE_URL="${HOST_BASE_URL:-http://localhost:3000}"
    PROMETHEUS_HOST_URL="${PROMETHEUS_HOST_URL:-http://localhost:9090}"
    RABBITMQ_MANAGEMENT_URL="${RABBITMQ_MANAGEMENT_URL:-http://localhost:15672}"
    K6_BASE_URL="${K6_BASE_URL:-http://taxi-rio-api:3000}"
    K6_PROMETHEUS_URL="${K6_PROMETHEUS_URL:-http://prometheus:9090}"
    HOST_SAMPLE_RUNTIME="compose"
    STACK_HINT="make start-infra-dockercompose"
    ;;
  k3d)
    HOST_BASE_URL="${HOST_BASE_URL:-http://api.taxi-rio.localhost:8080}"
    PROMETHEUS_HOST_URL="${PROMETHEUS_HOST_URL:-http://localhost:9090}"
    RABBITMQ_MANAGEMENT_URL="${RABBITMQ_MANAGEMENT_URL:-http://localhost:15672}"
    K6_BASE_URL="${K6_BASE_URL:-http://api.taxi-rio.localhost:8080}"
    K6_PROMETHEUS_URL="${K6_PROMETHEUS_URL:-http://prometheus.taxi-rio.localhost:8080}"
    HOST_SAMPLE_RUNTIME="k3d"
    STACK_HINT="make start-infra-k3d"
    ;;
  *)
    echo "STRESS_TARGET must be compose or k3d. Received: ${STRESS_TARGET}" >&2
    exit 1
    ;;
esac

export PROMETHEUS_HOST_URL

mkdir -p "${RESULTS_DIR}"
: > "${STATS_FILE}"
: > "${LIMITS_FILE}"
: > "${INSPECT_FILE}"
: > "${CGROUP_FILE}"
: > "${RABBITMQ_FILE}"
: > "${MYSQL_FILE}"

curl_host() {
  local url="$1"
  shift
  if [[ "${url}" == *api.taxi-rio.localhost:8080* ]]; then
    curl -sf --resolve api.taxi-rio.localhost:8080:127.0.0.1 "$@" "${url}"
  else
    curl -sf "$@" "${url}"
  fi
}

wait_http() {
  local url="$1"
  local attempts="$2"
  local i
  for i in $(seq 1 "${attempts}"); do
    if curl_host "${url}" >/dev/null; then
      return 0
    fi
    if [[ "${i}" -lt "${attempts}" ]]; then
      sleep 2
    fi
  done
  return 1
}

cleanup_sampler() {
  if [[ -n "${sampler_pid}" ]]; then
    kill "${sampler_pid}" >/dev/null 2>&1 || true
    wait "${sampler_pid}" >/dev/null 2>&1 || true
    sampler_pid=""
  fi
}

cleanup() {
  cleanup_sampler
  if [[ -n "${prometheus_pf_pid}" ]]; then
    kill "${prometheus_pf_pid}" >/dev/null 2>&1 || true
    wait "${prometheus_pf_pid}" >/dev/null 2>&1 || true
    prometheus_pf_pid=""
  fi
  if [[ -n "${rabbitmq_pf_pid}" ]]; then
    kill "${rabbitmq_pf_pid}" >/dev/null 2>&1 || true
    wait "${rabbitmq_pf_pid}" >/dev/null 2>&1 || true
    rabbitmq_pf_pid=""
  fi
}
trap cleanup EXIT

api_attempts=1
if [[ "${STRESS_TARGET}" == "k3d" ]]; then
  api_attempts=5
  command -v kubectl >/dev/null 2>&1 || {
    echo "kubectl is required when STRESS_TARGET=k3d." >&2
    exit 1
  }
fi

if ! wait_http "${HOST_BASE_URL}/" "${api_attempts}"; then
  echo "API is not healthy at ${HOST_BASE_URL}/. Start the stack with: ${STACK_HINT}" >&2
  exit 1
fi

if [[ "${STRESS_TARGET}" == "k3d" ]]; then
  kubectl -n "${K8S_NAMESPACE}" port-forward svc/prometheus 9090:9090 >/dev/null 2>&1 &
  prometheus_pf_pid=$!
  kubectl -n "${K8S_NAMESPACE}" port-forward svc/rabbitmq 15672:15672 >/dev/null 2>&1 &
  rabbitmq_pf_pid=$!
  wait_http "${PROMETHEUS_HOST_URL}/-/healthy" 15 || true
fi

if ! curl -sf "${PROMETHEUS_HOST_URL}/-/healthy" >/dev/null; then
  echo "Prometheus is not healthy at ${PROMETHEUS_HOST_URL}. Per-step 5xx, API p95, queue depth and worker lag will be missing." >&2
fi

fetch_token() {
  local actor="$1"
  local body
  body="$(curl_host "${HOST_BASE_URL}/auth/generate-token/${actor}" -X POST)" || {
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
    --runtime "${HOST_SAMPLE_RUNTIME}" \
    --namespace "${K8S_NAMESPACE}" \
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

run_k6() {
  if [[ "${STRESS_TARGET}" == "k3d" ]]; then
    docker rm -f k6 >/dev/null 2>&1 || true
    docker run --rm --name k6 \
      --user "${K6_UID}:${K6_GID}" \
      --cpus "${K6_CPUS}" \
      --memory "${K6_MEMORY}" \
      --memory-swap "${K6_MEMORY}" \
      -v "${ROOT}:/work" \
      -w /work \
      --add-host=api.taxi-rio.localhost:host-gateway \
      --add-host=prometheus.taxi-rio.localhost:host-gateway \
      -e TOKEN_PASSAGEIRO \
      -e TOKEN_MOTORISTA \
      -e STEPS \
      -e STEP_DURATION \
      -e WARMUP_RATE \
      -e PRE_ALLOCATED_VUS \
      -e MAX_VUS \
      -e K6_CPUS \
      -e K6_MEMORY \
      -e BASE_URL="${K6_BASE_URL}" \
      -e PROMETHEUS_URL="${K6_PROMETHEUS_URL}" \
      -e SUMMARY_PATH=loadtest/results/stress-summary.json \
      "${K6_IMAGE}" run "${K6_SCRIPT}"
    return
  fi

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
    -e BASE_URL="${K6_BASE_URL}" \
    -e PROMETHEUS_URL="${K6_PROMETHEUS_URL}" \
    -e SUMMARY_PATH=loadtest/results/stress-summary.json \
    k6
}

set +e
run_k6
k6_status=$?
set -e

cleanup_sampler

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
