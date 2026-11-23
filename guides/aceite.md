# Teste com os três artigos reais

O usuário conduzirá este aceite após abrir o terminal nesta pasta. Os testes automatizados usam dados sintéticos e não substituem esta etapa. Não declare que o aceite real já ocorreu.

Para cada arquivo, registre em `Docs/<slug>/acceptance.json`: nome do Word, hash original, modo escolhido, `_id`, slug, resultado da validação, resultado da comparação Word/JSON, confirmação no Sanity, URL e conferência visual da página. Não guarde token. Use `pending`, `passed` ou `failed`, com a pendência concreta.

Para cobrir os dois modos, configure `ALLOW_UI_PUBLICATION=true` antes do aceite: distribua pelo menos um diretamente e um pelo painel. A escolha deve ser confirmada após o respectivo JSON ficar válido; uma distribuição explicitamente escolhida pode ser respeitada sem perguntar de novo. Com `false`, não pergunte o modo nem tente o painel: os três seguem diretamente e a cobertura do painel fica pendente até a flag ser habilitada explicitamente. Todos percorrem importação, revisão, validação, publicação efetiva, comparação remota e página.

Compare título, autoria, parágrafos, citações, links, negrito/itálico, listas adaptadas, notas e referências. Registre qualquer campo guardado no Sanity que não apareça no site e como o conteúdo essencial foi preservado. Uma limitação não resolvida impede marcar o artigo como aprovado.

Em um artigo, faça uma correção solicitada: registre o `_id` e a contagem de documentos com o slug antes; atualize o mesmo `article.json`; valide; publique no mesmo ID; confirme nova revisão, trecho atualizado na página e ausência de novo documento com o slug. Preserve o Word original e seu hash.

Não instale remotamente nesta etapa. Depois do aceite, a pasta de transferência poderá ser instalada no PC da cliente, com Node, credencial local, setup dos MCPs, login do Studio e validação acompanhada no VS Code com Codex.
