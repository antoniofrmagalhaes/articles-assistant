# Mapeamento para a página atual

O documento é sempre `_type: article`, tanto para textos simples quanto acadêmicos. Use `schema/article.schema.json` para estrutura e limites, `schema/source` para regras customizadas e `examples/article.json` como exemplo fictício. Execute o validador; não presuma que mutações diretas aplicam validações ou valores iniciais do Studio.

Preserve título, autoria, ordem, parágrafos, notas e referências do Word. Título tem 12–140 caracteres, resumo de listagem 60–260, descrição do autor 40–1.200, temas 1–6. Abertura exige resumo e parágrafo inicial de pelo menos 80 caracteres, nota de título de pelo menos 24 e sumário com 2–6 itens. Para autoria ausente, consulte `config/editorial-profile.json` antes de perguntar. Uma nota fornecida tem prioridade; quando faltar, o agente deve redigir uma frase neutra a partir do próprio conteúdo, sem inventar origem nem pedir uma nota só para completar o campo. Exemplo de contexto, quando sustentado pelo texto: “Reflexões sobre a sucessão do cônjuge e as mudanças discutidas na reforma do Código Civil.” Outras ausências factuais sem fonte continuam exigindo esclarecimento.

Cada seção requer `id`, `number`, `title` e uma lista `content`. Tipos aceitos: `articleRichTextBlock` com Portable Text em `content`; `articlePullQuoteBlock` com `quote`; `articleLegalExcerptBlock` com `source` e `excerpt`; `articleCalloutBlock` com `body`. Objetos de listas exigem `_type` correto e `_key` única. Blocos de Portable Text têm `_type: block`, `children` de spans e `markDefs`; marcas suportadas: `strong`, `em` e links HTTP/HTTPS/relativos válidos.

| Campo ou formato          | Conferência necessária                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sumário público           | Vem das seções, não de `frontMatter.summaryItems`. Confira títulos, ordem e âncoras.                                                                                           |
| Abertura/subtítulo        | Parte dos campos de abertura não aparece no corpo da página individual. Uma introdução essencial deve continuar representada no corpo.                                         |
| Citações e trechos legais | Corpo e citação aparecem; o campo separado `source` não tem apresentação própria. Não deixe atribuição essencial apenas nele.                                                  |
| Callout                   | O texto do body aparece; título e tom não têm apresentação própria. Planeje a representação visível de avisos essenciais.                                                      |
| Notas                     | Aparecem como texto simples. Não dependa exclusivamente de link ou estilo oculto para passar informação essencial.                                                             |
| Listas, tabelas e imagens | A página não tem renderização própria completa desses formatos. Registre uma adaptação fiel em texto quando viável e acordada; se houver perda relevante, bloqueie e explique. |
| Capa/modo de apresentação | Não mudam a página individual atual. Referências de imagem precisam apontar para asset real do Sanity.                                                                         |
| Resumo e destaque         | Afetam a listagem. Destaque fica false por padrão, sem inferir pelo gênero do artigo.                                                                                          |

Em correções, preserve IDs, CID e slug. Modificar o título não exige outra URL. Compare Word, JSON e página; igualdade de armazenamento não garante que todo o conteúdo essencial seja visível. Nunca altere o site/schema a partir deste workspace para contornar uma limitação de conversão.
