# DECISÕES

## 1. Se você fosse desenvolver esse sistema do zero, sem tecnologias definidas, manteria o RabbitMQ ou optaria por outro broker? Justifique sua resposta.

Se eu fosse desenvolver esse sistema do zero, pensando na evolução de um aplicativo de corridas (como o Taxi Rio), **optaria pelo Apache Kafka** em vez do RabbitMQ.

Embora o RabbitMQ atenda perfeitamente ao escopo restrito do desafio atual (dois eventos e um consumidor), a arquitetura do Kafka é mais aderente às necessidades reais de um sistema de mobilidade em escala:

1. **Retenção de Eventos (Log Base):** O RabbitMQ remove a mensagem logo após o consumo. O Kafka, por ser baseado em log, mantém o histórico. Em um app de corridas, isso permite plugar um novo serviço (como auditoria ou *Data Lake*) que processe todas as corridas do passado sem exigir que a API republique os dados.
2. **Escalabilidade com Múltiplos Consumidores:** Eventos como `corrida.criada` interessam a vários domínios simultaneamente (*matching*, faturamento, notificações). No RabbitMQ, o padrão *fan-out* resolve isso, mas duplica fisicamente a mensagem em uma fila para cada serviço, multiplicando o consumo de recursos do broker. No Kafka, a mensagem é gravada uma única vez, e os *Consumer Groups* permitem que dezenas de serviços a leiam de forma independente, mantendo altíssima vazão sem sobrecarregar a infraestrutura.
3. **Ecossistema Voltado para Dados:** O Kafka possui ferramentas nativas (como Kafka Streams e Connect) que facilitam integrações vitais para mobilidade, como agregar métricas de corridas em tempo real para calcular preço dinâmico, reduzindo a necessidade de desenvolver código customizado para essas operações.

**Conclusão:** O *trade-off* do Kafka é exigir uma operação mais complexa. Se a premissa fosse apenas a criação de um MVP, ou manter o sistema pequeno, o RabbitMQ bastaria. Porém, como desenvolver "do zero" geralmente visa preparar a arquitetura para o crescimento do produto, o Kafka é a escolha mais robusta e eficiente para as demandas de roteamento e volume desse domínio.

## 2. Topologia do RabbitMQ

**Contexto.** Dois eventos (`corrida.criada` e `corrida.status_alterado`), um produtor (API) e um consumidor (worker), sem necessidade de entregar o mesmo evento a mais de um destino.

**Decisão.** Exchange padrão com uma fila durável por evento, sem DLQ.

**Alternativas.** Topic Exchange com filas ligadas por routing key (o que permite fan-out) e DLX + DLQ para direcionar mensagens problemáticas.

**Trade-offs.** 

- A API fica acoplada aos nomes das filas, e a implementação de uma futura arquitetura fan-out exigiria alterações no publisher da API. Sem DLQ, há a possibilidade de mensagens problemáticas caírem em loop infinito (poison messages).

**Evolução.** Migrar para Topic Exchange (a mesma mensagem alimentando, por exemplo, uma fila de negócio e uma de auditoria) e adicionar DLX + DLQ com limite de tentativas.

## 3. Onde garantir idempotência: banco, aplicação ou ambos?

**Contexto.** O `POST /corridas` pode ser reenviado com a mesma `Idempotency-Key`, e não pode criar uma corrida duplicada.

**Decisão.** Ambos, com papéis diferentes. O banco tem uma constraint única em `corridas.idempotency_key`, que é a garantia real: é atômica, mesmo com concorrência. A API captura o erro de chave duplicada e responde com sucesso (status 201 se criado, ou status 200 se já existir) em vez de erro, de modo que o retry do cliente é seguro.

**Alternativas.**

- *Só na aplicação:* consultar a chave antes de inserir. Sob requisições concorrentes haveria uma janela entre a consulta e o insert em que dois pedidos passam.
- *Só no banco:* a constraint impede o duplicado, mas o erro de chave duplicada chegaria ao cliente como falha (status 4xx).

**Trade-offs.** O tratamento depende do código de erro do driver do banco (pequeno acoplamento). A constraint acrescenta um índice, com custo pequeno de escrita e de espaço. A aplicação sozinha não bastaria, e o banco sozinho tornaria o retry visível como erro 4xx para o cliente.