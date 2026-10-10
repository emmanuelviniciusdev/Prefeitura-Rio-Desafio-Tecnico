.PHONY: help start-infra-dockercompose start-infra-k3d stop-infra-k3d stop-infra-dockercompose stress-with-dockercompose stress-with-k3d watch-taxi-rio-worker-k3d

.DEFAULT_GOAL := help

COMPOSE ?= docker compose
K3D_CLUSTER ?= taxi-rio
K3D_CONFIG ?= k8s/dev/k3d.yaml
K8S_OVERLAY ?= k8s/dev
K8S_KEDA_OVERLAY ?= k8s/keda
K8S_NAMESPACE ?= taxi-rio
KEDA_NAMESPACE ?= keda
API_IMAGE ?= taxi-rio-api:dev
APP_IMAGE ?= taxi-rio-app:dev
K8S_WAIT_TIMEOUT ?= 300s

help:
	@echo "Comandos disponiveis:"
	@echo "  make start-infra-dockercompose      Sobe a stack com Docker Compose"
	@echo "  make start-infra-k3d                Sobe a stack em um cluster k3d local"
	@echo "  make stop-infra-dockercompose    Encerra a stack do Docker Compose"
	@echo "  make stop-infra-k3d              Remove o cluster k3d local"
	@echo "  make stress-with-dockercompose   Roda o stress contra o Docker Compose (precisa estar no ar)"
	@echo "  make stress-with-k3d             Roda o stress contra o k3d (precisa estar no ar)"
	@echo "  make watch-taxi-rio-worker-k3d   Acompanha as replicas do taxi-rio-worker no k3d"

stop-infra-k3d:
	@if ! command -v k3d >/dev/null 2>&1; then \
		exit 0; \
	fi; \
	if k3d cluster list --no-headers 2>/dev/null | awk '{print $$1}' | grep -qx '$(K3D_CLUSTER)'; then \
		echo "Encerrando o cluster k3d '$(K3D_CLUSTER)'..."; \
		k3d cluster delete $(K3D_CLUSTER); \
	fi

stop-infra-dockercompose:
	@echo "Encerrando a stack do Docker Compose..."
	@$(COMPOSE) down

start-infra-dockercompose: stop-infra-k3d
	$(COMPOSE) up --build --force-recreate -d --wait
	@echo
	@echo "Stack pronta (Docker Compose):"
	@echo "  App:         http://localhost:5173"
	@echo "  API:         http://localhost:3000"
	@echo "  Prometheus:  http://localhost:9090"
	@echo "  Jaeger:      http://localhost:16686"
	@echo "  RabbitMQ UI: http://localhost:15672"

start-infra-k3d: stop-infra-dockercompose
	@set -e; \
	command -v k3d >/dev/null 2>&1 || { echo "Comando obrigatorio ausente: k3d" >&2; exit 1; }; \
	command -v kubectl >/dev/null 2>&1 || { echo "Comando obrigatorio ausente: kubectl" >&2; exit 1; }; \
	command -v docker >/dev/null 2>&1 || { echo "Comando obrigatorio ausente: docker" >&2; exit 1; }; \
	cluster_existed=0; \
	if k3d cluster list --no-headers 2>/dev/null | awk '{print $$1}' | grep -qx '$(K3D_CLUSTER)'; then \
		echo "Usando o cluster k3d existente '$(K3D_CLUSTER)'."; \
		cluster_existed=1; \
	else \
		k3d cluster create --config $(K3D_CONFIG); \
	fi; \
	k3d kubeconfig merge $(K3D_CLUSTER) --kubeconfig-switch-context; \
	docker build -t $(API_IMAGE) ./taxi-rio-api; \
	docker build -t $(APP_IMAGE) ./taxi-rio-app; \
	k3d image import $(API_IMAGE) $(APP_IMAGE) --cluster $(K3D_CLUSTER); \
	echo "Instalando o KEDA..."; \
	kubectl apply --server-side --force-conflicts -k $(K8S_KEDA_OVERLAY); \
	kubectl wait --for=condition=Established \
		crd/scaledobjects.keda.sh \
		crd/triggerauthentications.keda.sh \
		--timeout=$(K8S_WAIT_TIMEOUT); \
	keda_resources=$$(kubectl -n $(KEDA_NAMESPACE) get deploy -o name); \
	for resource in $$keda_resources; do \
		kubectl -n $(KEDA_NAMESPACE) rollout status "$$resource" --timeout=$(K8S_WAIT_TIMEOUT); \
	done; \
	kubectl apply -k $(K8S_OVERLAY); \
	if [ "$$cluster_existed" -eq 1 ]; then \
		echo "Recriando workloads do cluster k3d '$(K3D_CLUSTER)'..."; \
		kubectl -n $(K8S_NAMESPACE) rollout restart deployment --all; \
		kubectl -n $(K8S_NAMESPACE) rollout restart statefulset --all; \
	fi; \
	resources=$$(kubectl -n $(K8S_NAMESPACE) get deploy,sts -o name); \
	for resource in $$resources; do \
		kubectl -n $(K8S_NAMESPACE) rollout status "$$resource" --timeout=$(K8S_WAIT_TIMEOUT); \
	done; \
	echo; \
	echo "Stack pronta (k3d). Se ainda nao existirem, adicione ao /etc/hosts:"; \
	echo "  127.0.0.1 taxi-rio.localhost api.taxi-rio.localhost prometheus.taxi-rio.localhost jaeger.taxi-rio.localhost"; \
	echo; \
	echo "  App:        http://taxi-rio.localhost:8080"; \
	echo "  API:        http://api.taxi-rio.localhost:8080"; \
	echo "  Prometheus: http://prometheus.taxi-rio.localhost:8080"; \
	echo "  Jaeger:     http://jaeger.taxi-rio.localhost:8080"

stress-with-dockercompose:
	@if ! $(COMPOSE) ps --status running --services 2>/dev/null | grep -qx taxi-rio-api; then \
		echo "Docker Compose nao esta rodando. Suba a stack com: make start-infra-dockercompose" >&2; \
		exit 1; \
	fi
	STRESS_TARGET=compose ./loadtest/run-stress.sh

stress-with-k3d:
	@if ! command -v k3d >/dev/null 2>&1; then \
		echo "k3d nao encontrado. Suba a stack com: make start-infra-k3d" >&2; \
		exit 1; \
	fi; \
	if ! k3d cluster list --no-headers 2>/dev/null | awk '{print $$1}' | grep -qx '$(K3D_CLUSTER)'; then \
		echo "Cluster k3d '$(K3D_CLUSTER)' nao esta rodando. Suba a stack com: make start-infra-k3d" >&2; \
		exit 1; \
	fi
	STRESS_TARGET=k3d K8S_NAMESPACE=$(K8S_NAMESPACE) ./loadtest/run-stress.sh

watch-taxi-rio-worker-k3d:
	@if ! command -v k3d >/dev/null 2>&1; then \
		echo "k3d nao encontrado. Suba a stack com: make start-infra-k3d" >&2; \
		exit 1; \
	fi; \
	if ! k3d cluster list --no-headers 2>/dev/null | awk '{print $$1}' | grep -qx '$(K3D_CLUSTER)'; then \
		echo "Cluster k3d '$(K3D_CLUSTER)' nao esta rodando. Suba a stack com: make start-infra-k3d" >&2; \
		exit 1; \
	fi
	kubectl -n $(K8S_NAMESPACE) get deploy taxi-rio-worker --watch
