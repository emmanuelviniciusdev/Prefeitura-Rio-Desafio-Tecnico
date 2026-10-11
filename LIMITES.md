# LIMITES

## O que não fiz

- **Transactional Outbox.** A API grava no MySQL e publica no broker em dois passos (dual write). Se o processo da API cair entre os dois, o evento se perde e o histórico no Mongo fica sem o registro.
- **DLX/DLQ + limite de tentativas no worker.** Um status que chega antes do `create` sofre `nack` com requeue, sem limite. Se o `create` nunca chegar, por exemplo, a mensagem circula indefinidamente (poison message).
- **Gateway em frente à API.** Sob sobrecarga a API degrada em latência e não emite erro 5xx. Sem um gateway, não reproduzi 504 nem demonstrei o alerta de erros durante o teste de carga (ele só cobre erros produzidos pela própria aplicação). Optei por não implementá-lo, dado o deadline do desafio e a complexidade mais elevada.
  - *O* nginx, que seria o gateway mais simples, só expõe conexões e total de requisições `stub_status`), sem a distribuição por status code. Ver o 504 no Prometheus exigiria um exportador baseado em logs ou trocar por um proxy que exporte isso nativamente (Traefik, HAProxy), ou seja, mais uma peça para configurar e testar.

## O que faria com mais tempo

- Implementar o outbox e um publisher em background, para desacoplar a publicação da mensagem pela endpoint e aumentar performance sob alta volumetria de requisições.
- Implementação/configuração de DLX/DLQ + limite de tentativas.
- Implementação de um gateway em frente ao taxi-rio-api, que possibilitaria a exportação de métricas por status da API e elaboração de novos tipos de alertas.
- Estender o stress até achar o teto de vazão (parei em 200 it/s) e repetir cada degrau para medir a variação entre execuções.
- Armazenamento persistente de traces (o Jaeger usa memória).

## Riscos conhecidos em aberto

- **Idempotência em** `POST /corridas`**:** a chave é **global** (`UNIQUE` em `corridas.idempotency_key`). Mesma `Idempotency-Key` com **corpo idêntico** → **200** e a corrida já gravada (replay seguro). Mesma `Idempotency-Key` com **corpo diferente** → também **200** com a corrida **original**; o novo corpo é ignorado (não há comparação de payload nem **409/422**).

