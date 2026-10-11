## 1. Broker de mensagens: manter o RabbitMQ ou optar por outro?

**Contexto.** Hoje o fluxo tem dois eventos e um consumidor, e o RabbitMQ atende bem. Partindo do zero, para um app de corridas em escala, eventos neste tipo de contexto tendem a ter vários consumidores e uma alta volumetria.

**Decisão.** Kafka, por três motivos principais:

- **Retenção e replay:** o evento fica no log por um período configurável, e um novo consumidor (exemplo: auditoria) lê o histórico sem o produtor republicar nada.
- **Vários consumidores e alta vazão:** consumer groups independentes leem o mesmo tópico, o que serve para possíveis eventos frequentes, como a localização dos motoristas e passageiros.
- **Ecossistema:** Kafka Connect, Streams e Schema Registry cobrem integrações (data lake, métricas em tempo real, contratos de evento) que de outra forma seriam código próprio.

**Alternativas.** RabbitMQ (fila de tarefas com roteamento flexível, retry, TTL e DLQ nativos, operação simples) e Kafka (log distribuído, particionado e retido em disco).

**Trade-offs.**

- Ecossistema mais pesado de manter (cluster, partições, schemas).
- Retry com atraso, TTL por mensagem e DLQ não são nativos e exigem tópicos de retry construídos à mão.

## 2. Topologia do RabbitMQ

**Contexto.** Dois eventos (`corrida.criada` e `corrida.status_alterado`), um produtor (API) e um consumidor (worker), sem necessidade de entregar o mesmo evento a mais de um destino.

**Decisão.** Exchange padrão com uma fila durável por evento, sem DLQ.

**Alternativas.** Topic Exchange com filas ligadas por routing key (permite fan-out, como uma fila de auditoria) e DLX + DLQ para mensagens problemáticas.

**Trade-offs.** 

- A API fica acoplada ao nome das filas, e a implementação de uma futura arquitetura fan-out exigiria mudar o publisher. Sem DLQ, há a possibilidade de mensagens problemáticas caírem em loop infinito (poison messages).

**Evolução.** Migrar para Topic Exchange (a mesma mensagem alimentando, por exemplo, uma fila de negócio e uma de auditoria) e adicionar DLX + DLQ com limite de tentativas.

## 3. Onde garantir idempotência: banco, aplicação ou ambos?

**Contexto.** O `POST /corridas` pode ser reenviado com a mesma `Idempotency-Key`, e não pode criar uma corrida duplicada.

**Decisão.** Ambos, com papéis diferentes. O banco tem uma constraint única em `corridas.idempotency_key`, que é a garantia real: é atômica, mesmo com concorrência. A API captura o erro de chave duplicada e responde com sucesso (status 201 se criado, ou status 200 se já existir) em vez de erro, de modo que o retry do cliente é seguro.

**Alternativas.**

- *Só na aplicação:* consultar a chave antes de inserir. Sob requisições concorrentes haveria uma janela entre a consulta e o insert em que dois pedidos passam.
- *Só no banco:* a constraint impede o duplicado, mas o erro de chave duplicada chegaria ao cliente como falha (status 4xx).

**Trade-offs.** O tratamento depende do código de erro do driver do banco (pequeno acoplamento). A constraint acrescenta um índice, com custo pequeno de escrita e de espaço. A aplicação sozinha não bastaria, e o banco sozinho tornaria o retry visível como erro 4xx para o cliente.