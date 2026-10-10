# Dimensionamento de Recursos e Probes no Kubernetes (`k8s/dev`)

Este documento detalha as decisões arquiteturais e os critérios técnicos que fundamentaram a escolha dos valores de **recursos (**`requests` **e** `limits`**)** e **sondas de integridade (**`probes`**)** nos manifestos deste diretório.

Todos os parâmetros foram calibrados com base nos dados que foram coletados durante a execução do **teste de carga com k6** (cenário de estresse em degraus de 10 a 200 iterações/s, realizado em 10/10/2026), registrado em `[REPORT_STRESS_LOADTEST.md](../../REPORT_STRESS_LOADTEST.md)`.

---

## 1. Diretrizes Gerais de Dimensionamento



### Resources (`requests` e `limits`)

1. **Memória (**`limits` **e RSS):** O teto (`limits`) de cada container foi definido a partir do pico de **RSS (Resident Set Size)** observado no teste de carga somado a uma margem operacional de segurança. Além disso, os limites de memória da aplicação e das engines foram calibrados para jamais competirem com o teto do cgroup:
  - Node.js (V8 heap) configurado via `--max-old-space-size` abaixo do limite de memória do container, evitando disparos involuntários do *OOM Killer*.
  - WiredTiger (MongoDB) e `--maxmemory` (Redis) fixados em patamares compatíveis com os limites estipulados.
2. **Memória (**`requests`**):** Dimensionados com base na média operacional sustentada em carga nominal (degraus médios), garantindo que o `kube-scheduler` aloque os pods apenas em nós com capacidade garantida e enquadre as cargas na classe de QoS **Burstable** (evitando *BestEffort*).
3. **CPU (**`requests` **e** `limits`**):** O limite superior (`limits`) reflete a capacidade de processamento comprovada no teste para conter a latência p95 sem sofrer *throttling* destrutivo de cgroups. A requisição (`requests`) garante a reserva mínima para manter a vazão esperada em momentos de alta concorrência.



### Probes (`startup`, `readiness`, `liveness`)

- `startupProbe` **(Tolerância de Boot):** Utiliza limites generosos (`failureThreshold: 24` a `30`, cobrindo de 120s a 300s). Evita que containers com inicialização lenta (subida do framework NestJS, verificações de drivers, migrações de banco ou inicialização de storage engines como InnoDB e WiredTiger) sejam terminados prematuramente por falhas de liveness.
- `readinessProbe` **(Controle de Tráfego):** Configurada para atuar rapidamente (`failureThreshold: 3`, `periodSeconds: 10`), desanexando o Pod dos endpoints do `Service` caso a aplicação enfrente degradação ou saturação passageira. Isso impede que novas requisições continuem sendo enviadas a uma instância incapaz de responder (evitando requisições presas e *timeouts* no backend) e dá fôlego para o processo se recuperar sem ser reiniciado. *(Nota: com apenas 1 réplica ativa no ambiente dev, a indisponibilidade do Pod fará o Ingress/proxy responder erro como 503 por ausência de upstream saudável; em ambientes multi-réplica, o tráfego é redistribuído automaticamente para as réplicas sadias).*
- `livenessProbe` **(Prevenção de Deadlock):** Possui tolerância superior à de prontidão (`failureThreshold: 6`, `periodSeconds: 10`). Garante que um Pod só seja reiniciado em caso de pane irreversível ou travamento do event loop, dando margem temporal para o processo se recuperar antes de uma intervenção drástica.

---



## 2. Parâmetros por Serviço



### 2.1. API Backend (`taxi-rio-api`)


| Parâmetro                    | Valor                     | Justificativa Baseada no Teste de Carga                                                                                                                                                       |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU Requests / Limits**    | `650m` / `1000m`          | Em 150 it/s, o consumo médio de CPU foi de **646m**, com picos atingindo **973m**. O teto de 1000m (1 core inteiro) segurou o p95 abaixo de 2s até o degrau de 200 it/s.                      |
| **Memory Requests / Limits** | `128Mi` / `256Mi`         | O RSS atingiu pico de **111MiB** sob estresse. O limite de 256Mi acomoda confortavelmente a heap do V8 limitada em **192MB** (`--max-old-space-size=192`), eliminando o risco de `OOMKilled`. |
| **startupProbe**             | HTTP `/` (5s × 24 = 120s) | Garante tempo para a resolução de módulos NestJS, compilação de rotas e conexões de pool sem falso positivo de liveness.                                                                      |
| **readinessProbe**           | HTTP `/` (10s × 3 = 30s)  | Remove o Pod dos endpoints do Service em caso de indisponibilidade momentânea sem matar o processo.                                                                                           |
| **livenessProbe**            | HTTP `/` (10s × 6 = 60s)  | Reinicia o pod somente após 60s contínuos sem resposta na porta HTTP principal.                                                                                                               |




### 2.2. Worker Assíncrono (`taxi-rio-worker`)


| Parâmetro                    | Valor                 | Justificativa Baseada no Teste de Carga                                                                                                                                                                       |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU Requests / Limits**    | `200m` / `250m`       | Com o `prefetch` ajustado em 10, o worker apresentou média de **158m** e pico de **221m** de CPU, mantendo a profundidade de fila em 0 e lag p95 abaixo de 70ms. O teto de 250m (0,25 core) atende com folga. |
| **Memory Requests / Limits** | `64Mi` / `128Mi`      | O RSS registrou pico de **64MiB**. O limite de 128Mi comporta com segurança a heap do Node.js fixada em **96MB** (`--max-old-space-size=96`).                                                                 |
| **Probes**                   | HTTP `/metrics` :9464 | O worker não expõe rotas de negócio, mas serve `/metrics` logo após inicializar seu contexto e conectar aos drivers (MongoDB e RabbitMQ).                                                                     |




### 2.3. MySQL (`mysql`)


| Parâmetro                    | Valor                               | Justificativa Baseada no Teste de Carga                                                                                                    |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **CPU Requests / Limits**    | `250m` / `1000m`                    | Consumo médio de **243m** com pico de **388m** no pico de concorrência de escritas e leituras transacionais.                               |
| **Memory Requests / Limits** | `640Mi` / `1Gi`                     | O RSS atingiu **598MiB** sob carga contínua. O teto de 1Gi protege o host de sobrecargas de buffer pool e memória de conexões temporárias. |
| **startupProbe**             | `mysqladmin ping` (10s × 30 = 300s) | Dá margem de até 5 minutos para inicialização de tabelas, InnoDB buffer pool initialization e replay de logs transacionais.                |




### 2.4. MongoDB (`mongodb`)


| Parâmetro                    | Valor                                               | Justificativa Baseada no Teste de Carga                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CPU Requests / Limits**    | `150m` / `500m`                                     | Média de **141m** de CPU; amostras instantâneas com pico de **521m** justificam a reserva e o teto em 500m.                                                                                |
| **Memory Requests / Limits** | `320Mi` / `512Mi`                                   | O RSS atingiu **310MiB**. O cache interno do WiredTiger foi explicitamente travado em **0.25GB** (`--wiredTigerCacheSizeGB 0.25`), garantindo que a pegada total caiba no cgroup de 512Mi. |
| **startupProbe**             | `mongosh db.adminCommand('ping')` (10s × 30 = 300s) | Tolerância para alocação de journals e validação de storage no boot.                                                                                                                       |




### 2.5. RabbitMQ (`rabbitmq`)


| Parâmetro                    | Valor                                            | Justificativa Baseada no Teste de Carga                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU Requests / Limits**    | `250m` / `750m`                                  | Apresentou média de **227m** e pico de **770m** de CPU durante os degraus de 150–200 it/s. O limite em 750m suporta rajadas de publicação e despacho sem causar bloqueio de sockets AMQP. |
| **Memory Requests / Limits** | `192Mi` / `256Mi`                                | RSS medido em **181MiB**, estável e sem acionamento de alarme de memória (`vm_memory_high_watermark`).                                                                                    |
| **startupProbe**             | `rabbitmq-diagnostics -q ping` (10s × 30 = 300s) | Evita reinicializações prematuras durante a subida de aplicações OTP e inicialização do cluster interno do Mnesia.                                                                        |




### 2.6. Redis (`redis`)


| Parâmetro                    | Valor           | Justificativa Baseada no Teste de Carga                                                                                                                                           |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU Requests / Limits**    | `50m` / `250m`  | Consumo médio de **34m** e pico de **69m**. O overhead de comandos em memória é muito baixo.                                                                                      |
| **Memory Requests / Limits** | `32Mi` / `64Mi` | O RSS estabilizou em **29MiB**. O container possui diretiva `--maxmemory 48mb` com política de despejo `allkeys-lru`, garantindo que o dataset nunca ultrapasse o limite de 64Mi. |




### 2.7. Frontend Web (`taxi-rio-app`)


| Parâmetro                    | Valor                    | Justificativa                                                                                                                                                            |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CPU Requests / Limits**    | `10m` / `250m`           | Servidor Nginx servindo assets estáticos compilados. Na ausência de processamento dinâmico em teste de carga de API, consome <1% de CPU.                                 |
| **Memory Requests / Limits** | `16Mi` / `64Mi`          | RSS aferido em **8.3MiB**. Request reduzido de 16Mi evita que o Pod caia em classe de prioridade vulnerável (*BestEffort*).                                              |
| **initContainer**            | `wait-for-api` (busybox) | Bloqueia a inicialização do Nginx até que a API backend responda HTTP 200, evitando que o frontend atenda usuários antes da disponibilidade dos serviços de dependência. |




### 2.8. Observabilidade (Prometheus & Jaeger)


| Serviço        | CPU (Req / Lim) | Memória (Req / Lim) | Observações e Métricas do Teste                                                                                                         |
| -------------- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Prometheus** | `50m` / `500m`  | `64Mi` / `256Mi`    | Consumo médio de **4m** (pico de **14m**) e RSS de **37MiB**. Retenção de TSDB limitada em 24h para ambiente de desenvolvimento local.  |
| **Jaeger**     | `50m` / `500m`  | `160Mi` / `256Mi`   | CPU com média de **44m** (pico de **98m**) e RSS estável em **152MiB** devido ao teto em memória de traces (`MEMORY_MAX_TRACES=10000`). |
