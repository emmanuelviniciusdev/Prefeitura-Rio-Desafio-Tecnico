# Orientações para agentes

Este arquivo define convenções que agentes de IA devem seguir ao trabalhar neste repositório.

## Idioma

- **Código**: sempre em **en-US** — identificadores, comentários no código, mensagens de commit geradas a partir do código, strings de log técnico, nomes de variáveis/funções/classes, textos em testes automatizados e artefatos de implementação.
- **Documentação**: sempre em **pt-BR** — README, AGENTS.md, comentários em arquivos de documentação, guias, ADRs, descrições de PR quando forem documentação do projeto, e explicações ao usuário sobre o repositório.

Exceção prática: bibliotecas ou APIs externas que exijam outro idioma (por exemplo, chaves de i18n já definidas no produto) seguem o padrão do projeto de frontend/backend, mas código novo criado pelo agente continua com identificadores e comentários em en-US.

## Frontend

- **Não abrir o navegador** para validar alterações em aplicações frontend (inclui MCP de browser, automação visual e screenshots para “conferir se ficou certo”).
- Preferir: testes automatizados, lint/typecheck, build, leitura estática do código e saída de comandos no terminal (`npm test`, `npm run build`, etc.).
