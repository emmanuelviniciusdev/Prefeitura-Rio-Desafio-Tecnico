# Desafio Técnico

---

## 1. Guia Rápido de Execução (Para o Avaliador)

Para facilitar a validação, todo o ciclo de vida da infraestrutura e dos testes foi automatizado via `Makefile`. O projeto suporta dois ambientes de execução: **Docker Compose** e **Kubernetes local via k3d**.

---

### Ambiente 1: Docker Compose

Sobe todos os serviços da aplicação, bancos de dados, broker e pilha de observabilidade com limites de recursos fixados para reproduzir o ambiente de estresse.

#### Subir a aplicação

```bash
make start-infra-dockercompose
```

Após a inicialização (os containers aguardam as dependências ficarem saudáveis via *healthchecks*):


| Serviço                 | URL / Acesso                                             | Descrição                                                     |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| **Frontend Web**        | [http://localhost:5173](http://localhost:5173)           | Painel com login 1-click para Passageiro e Motorista          |
| **API Backend**         | [http://localhost:3000](http://localhost:3000)           | Endpoints REST de autenticação e corridas                     |
| **Swagger / OpenAPI**   | [http://localhost:3000/docs](http://localhost:3000/docs) | Documentação interativa dos endpoints da API                  |
| **Prometheus**          | [http://localhost:9090](http://localhost:9090)           | Métricas de sistema, filas, latência e regras de alerta       |
| **Jaeger UI**           | [http://localhost:16686](http://localhost:16686)         | Tracing distribuído ponta a ponta (API, DB, RabbitMQ, Worker) |
| **RabbitMQ Management** | [http://localhost:15672](http://localhost:15672)         | Gestão do broker (login: `admin` / senha: `admin`)            |




#### Rodar o teste de estresse e carga

Com a stack rodando, execute em outro terminal:

```bash
make stress-with-dockercompose
```

> O teste executa uma rampa k6 de 10 a 200 iterações/s (com 1 `POST`, 2 `PATCH` e 4 `GET` por iteração), gerando relatórios consolidados em `loadtest/results/`.



#### Encerrar a stack

```bash
make stop-infra-dockercompose
```

---



### Ambiente 2: Kubernetes Local (k3d + KEDA Autoscaling)

Executa a solução em um cluster Kubernetes local gerenciado pelo `k3d`, com **autoscaling do worker orientado ao tamanho da fila do RabbitMQ** via KEDA (*ScaledObject*).

#### Pré-requisitos

- `docker`
- `k3d`
- `kubectl`



#### Configuração de DNS local (`/etc/hosts`)

Adicione a seguinte linha ao seu `/etc/hosts` para resolução dos domínios do Ingress:

```text
127.0.0.1 taxi-rio.localhost api.taxi-rio.localhost prometheus.taxi-rio.localhost jaeger.taxi-rio.localhost
```



#### Subir a infraestrutura no k3d

```bash
make start-infra-k3d
```

O comando cria o cluster `taxi-rio`, compila as imagens locais, instala os CRDs e componentes do KEDA, aplica os manifestos de `k8s/dev` e aguarda o *rollout* de todos os pods.


| Serviço               | URL (Porta 8080 do Ingress)                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| **Frontend Web**      | [http://taxi-rio.localhost:8080](http://taxi-rio.localhost:8080)                       |
| **API Backend**       | [http://api.taxi-rio.localhost:8080](http://api.taxi-rio.localhost:8080)               |
| **Swagger / OpenAPI** | [http://api.taxi-rio.localhost:8080/docs](http://api.taxi-rio.localhost:8080/docs)     |
| **Prometheus**        | [http://prometheus.taxi-rio.localhost:8080](http://prometheus.taxi-rio.localhost:8080) |
| **Jaeger UI**         | [http://jaeger.taxi-rio.localhost:8080](http://jaeger.taxi-rio.localhost:8080)         |




#### Acompanhar o Autoscaling do Worker em tempo real

Para observar o KEDA escalando o Deployment `taxi-rio-worker` conforme o volume de mensagens na fila:

```bash
make watch-taxi-rio-worker-k3d
```



#### Rodar o teste de estresse e carga no k3d

```bash
make stress-with-k3d
```



#### Encerrar e remover o cluster k3d

```bash
make stop-infra-k3d
```

---



## 2. Ferramentas, Uso de IA e Decisões Práticas

> **Em poucas linhas: quais ferramentas usou, para quê, e um exemplo de uma sugestão que você rejeitou ou corrigiu e por quê.**



### Ferramentas Utilizadas

- **Cursor**: Utilizado como IDE e ambiente principal de desenvolvimento, geração de testes e scripts utilitários.
- **Docker & Docker Compose**: Criação de ambientes multicontêiner reproduzíveis com controle estrito de cgroups (CPU e memória).
- **k3d & Kubernetes + KEDA**: Simulação de cluster Kubernetes de desenvolvimento com autoscaling baseado em métricas de mensageria.
- **k6**: Execução e parametrização dos testes de carga e estresse por degraus.
- **OpenTelemetry, Jaeger e Prometheus**: Instrumentação de métricas RED, spans de banco/mensageria e observabilidade distribuída.
- **Não utilização de SDD (Spec-Driven Development)**: Optei por **não** utilizar a abordagem de SDD em função das restrições de prazo (*deadline*) do desafio e com o objetivo de manter o repositório enxuto e estruturado exatamente de acordo com as entregas solicitadas no enunciado.



### Correção de Problemas Gerados pela IA, Identificados nos Testes de Carga

Durante a execução inicial dos testes de carga com k6 e análise dos traces, identifiquei **dois problemas introduzidos pelo código inicial gerado pela IA**:

1. **Chamada de** `assertQueue` **síncrona a cada** `publish` **na API**:
  - *O problema:* A IA colocou a declaração da topologia AMQP (`assertQueue`) dentro do fluxo crítico do método de publicação de cada mensagem.
  - *O impacto:* As requisições `POST` e `PATCH` apresentaram p95 de latência de até **24 segundos** a 100 it/s (com o Jaeger apontando 17,47 s gastos exclusivamente no span `assertQueue`), enquanto `GET` respondia em milissegundos.
  - *A correção:* A declaração das filas foi movida para o ciclo de *bootstrap* da aplicação. A 100 it/s, o p95 despencou de **20 s para 6,4 ms**.
2. `prefetch: 1` **fixado no Worker assíncrono**:
  - *O problema:* A IA inicializou o consumidor AMQP com `prefetch` fixado em 1, forçando o RabbitMQ a esperar o `ack` de cada mensagem pela rede antes de despachar a próxima.
  - *O impacto:* A fila `corrida.status_alterado` acumulou **10.792 mensagens** a 100 it/s, com lag de entrega chegando a **59 segundos**.
  - *A correção:* O prefetch foi parametrizado via variável de ambiente (`RABBITMQ_PREFETCH`) com padrão de 10. O acúmulo de fila foi zerado e o lag caiu para **~48 ms**.

---



## 3. Documentação Complementar

Toda a documentação técnica, investigações e decisões do projeto foram organizadas nos seguintes arquivos:

- **[REPORT_STRESS_LOADTEST.md](REPORT_STRESS_LOADTEST.md)**: Relatório completo do teste de carga e estresse com k6. Detalha os gargalos encontrados, evidências no Jaeger/Prometheus e o comparativo antes e depois das correções.
- **[REPORT_K8S_RESOURCES.md](REPORT_K8S_RESOURCES.md)**: Justificativa técnica do dimensionamento de recursos de contêiner (`requests` e `limits` de CPU/memória) e configuração das sondas (`startupProbe`, `readinessProbe`, `livenessProbe`) para o Kubernetes, calibrados a partir dos dados do teste de estresse.
- **[DECISIONS.md](DECISIONS.md)**: Registro de decisões arquiteturais fundamentadas.
- **[LIMITES.md](LIMITES.md)**: Mapeamento transparente de escopo: o que não foi implementado devido ao prazo do desafio, o que seria feito com mais tempo e riscos conhecidos em aberto.
- **[DIARIO.md](DIARIO.md)**: Diário de bordo registrando as investigações, formulação de hipóteses e aprendizados ao longo da construção da solução.
- **[AGENTS.md](AGENTS.md)**: Convenções de idioma e diretrizes de desenvolvimento para agentes de inteligência artificial neste repositório.

---



## 4. Componentes Principais

- `taxi-rio-api`: Backend em NestJS com endpoints autenticados via JWT com chave assimétrica RSA. Gerencia os estados das corridas (`requested` → `accepted` → `finished`).
- `taxi-rio-worker`: Serviço desacoplado que consome eventos do RabbitMQ e consolida o histórico de auditoria e transições no MongoDB de forma segura contra duplicidades (idempotente).
- `taxi-rio-app`: Aplicação React utilizando Tailwind CSS e Vite, com telas para Passageiro e Motorista realizarem a jornada de corrida.
- **Observabilidade**: OpenTelemetry exportando traces para o Jaeger e métricas HTTP/mensageria expostas nativamente para scraping do Prometheus.

