import { defineArrayMember, defineField, defineType } from "sanity";

const richTextOf = [
  defineArrayMember({
    type: "block",
    styles: [
      { title: "Paragrafo", value: "normal" },
      { title: "Titulo 2", value: "h2" },
      { title: "Titulo 3", value: "h3" },
      { title: "Citacao", value: "blockquote" },
    ],
    marks: {
      decorators: [
        { title: "Negrito", value: "strong" },
        { title: "Italico", value: "em" },
      ],
      annotations: [
        {
          name: "link",
          title: "Link",
          type: "object",
          fields: [
            defineField({
              name: "href",
              title: "URL",
              type: "url",
              validation: (rule) =>
                rule.required().uri({ allowRelative: true, scheme: ["http", "https"] }),
            }),
          ],
        },
      ],
    },
  }),
];

export const articleAuthorType = defineType({
  name: "articleAuthor",
  title: "Autor do artigo",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "name",
      title: "Nome",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      title: "Descrição editorial",
      description:
        "Breve apresentação do autor: formação, atuação e experiência. Use de 40 a 1.200 caracteres.",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required().min(40).max(1200),
    }),
  ],
});

export const articleReferenceMatchType = defineType({
  name: "articleReferenceMatch",
  title: "Match de referencia",
  type: "object",
  fields: [
    defineField({
      name: "pattern",
      title: "Padrao",
      type: "string",
      description: "Texto literal ou regex para localizar o trecho linkavel.",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "url",
      title: "URL",
      type: "url",
      validation: (rule) =>
        rule.required().uri({ allowRelative: false, scheme: ["http", "https"] }),
    }),
    defineField({
      name: "isRegex",
      title: "Usar regex",
      type: "boolean",
      initialValue: false,
    }),
  ],
});

export const articleTaxonomyType = defineType({
  name: "articleTaxonomy",
  title: "Taxonomia",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "topics",
      title: "Temas",
      description:
        "Assuntos usados para classificar o artigo. Adicione de 1 a 6 temas, um por item. Ex.: Direito de Família; Guarda compartilhada.",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      validation: (rule) => rule.required().min(1).max(6),
    }),
  ],
});

export const articlePublicationType = defineType({
  name: "articlePublication",
  title: "Publicacao",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "publishedAt",
      title: "Publicado em",
      description:
        "Data e hora atribuídas à publicação do artigo no site. Preencher este campo não substitui o botão Publish.",
      type: "datetime",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "originalPublication",
      title: "Nome da publicação original",
      description:
        "Texto com o nome da revista, jornal ou portal em que o artigo foi publicado primeiro. Ex.: Revista de Direito de Família. Opcional: deixe vazio se não houver publicação anterior. O endereço da página vai no campo Link abaixo.",
      type: "string",
    }),
    defineField({
      name: "publicationLink",
      title: "Link da publicação de origem",
      description:
        "Opcional. Para indicar uma publicação externa, preencha o texto do link e o endereço da página do artigo.",
      type: "object",
      fields: [
        defineField({
          name: "title",
          title: "Texto do link",
          description:
            "Texto clicável que identifica a publicação. Ex.: Leia na Revista de Direito de Família.",
          type: "string",
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: "href",
          title: "Link",
          description:
            "Endereço completo da página do artigo na publicação de origem, começando com https://.",
          type: "url",
          validation: (rule) =>
            rule.required().uri({ allowRelative: false, scheme: ["http", "https"] }),
        }),
      ],
    }),
    defineField({
      name: "edition",
      title: "Edição",
      description:
        "Número ou identificação da edição da revista ou periódico de origem. Ex.: n. 42. Opcional; deixe vazio quando não se aplicar.",
      type: "string",
    }),
    defineField({
      name: "volume",
      title: "Volume",
      description:
        "Volume da revista ou periódico de origem. Ex.: v. 12. Opcional; deixe vazio quando não se aplicar.",
      type: "string",
    }),
    defineField({
      name: "pages",
      title: "Páginas",
      description:
        "Páginas ocupadas pelo artigo na publicação de origem. Ex.: 25–38. Opcional; deixe vazio quando não se aplicar.",
      type: "string",
    }),
  ],
});

export const articleSeoType = defineType({
  name: "articleSeo",
  title: "SEO",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "excerpt",
      title: "Resumo curto para listagens",
      description:
        "Apresentação curta do artigo para as listagens do site, com 60 a 260 caracteres. Destaque o assunto e o interesse para o leitor; o resumo acadêmico é preenchido na Abertura.",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required().min(60).max(260),
    }),
    defineField({
      name: "featured",
      title: "Destaque",
      description: "Marca o artigo como destaque para as áreas do site que usam essa seleção.",
      type: "boolean",
      initialValue: false,
    }),
  ],
});

export const articleHeroType = defineType({
  name: "articleHero",
  title: "Hero",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "coverImage",
      title: "Imagem de capa",
      description:
        "Envie ou selecione a imagem de apresentação do artigo. Preencha também o texto alternativo abaixo.",
      type: "image",
      options: {
        hotspot: true,
      },
    }),
    defineField({
      name: "coverImageAlt",
      title: "Texto alternativo da capa",
      description:
        "Descreva brevemente o que a imagem mostra para quem usa leitor de tela. Ex.: Família caminhando de mãos dadas em um parque. Obrigatório quando houver capa.",
      type: "string",
      validation: (rule) =>
        rule.custom((value, context) => {
          const hasImage = Boolean(
            (context.parent as { coverImage?: unknown } | undefined)?.coverImage,
          );
          if (hasImage && !value) {
            return "Informe o texto alternativo quando houver imagem de capa.";
          }
          return true;
        }),
    }),
    defineField({
      name: "displayMode",
      title: "Modo de exibição",
      description:
        "Seleciona a variante de apresentação do artigo: Capa, Cabeçalho editorial ou Minimal. Não altera o texto do artigo.",
      type: "string",
      initialValue: "editorial-header",
      options: {
        list: [
          { title: "Capa", value: "cover" },
          { title: "Cabeçalho editorial", value: "editorial-header" },
          { title: "Minimal", value: "minimal" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
  ],
});

export const articleFrontMatterType = defineType({
  name: "articleFrontMatter",
  title: "Abertura",
  type: "object",
  options: { collapsible: false },
  fields: [
    defineField({
      name: "kicker",
      title: "Etiqueta",
      description:
        "Texto curto acima do título para contextualizar o artigo. Ex.: Direito de Família. Opcional; os temas usados na classificação são preenchidos em Autoria e temas.",
      type: "string",
    }),
    defineField({
      name: "subtitle",
      title: "Subtítulo",
      description: "Frase que complementa o título e apresenta o recorte do artigo. Opcional.",
      type: "text",
      rows: 2,
    }),
    defineField({
      name: "abstract",
      title: "Resumo acadêmico",
      description:
        "Síntese do objetivo, da abordagem e das principais conclusões do artigo. Mínimo de 80 caracteres. O resumo curto das listagens é preenchido em Divulgação.",
      type: "text",
      rows: 4,
      validation: (rule) => rule.required().min(80),
    }),
    defineField({
      name: "titleNote",
      title: "Nota de título",
      description:
        "Observação ligada ao título, como origem do trabalho, evento em que foi apresentado ou contexto de elaboração. Ex.: Artigo adaptado de palestra apresentada em congresso. Mínimo de 24 caracteres.",
      type: "text",
      rows: 2,
      validation: (rule) => rule.required().min(24),
    }),
    defineField({
      name: "summaryItems",
      title: "Itens de sumário",
      description:
        "Lista dos principais tópicos do artigo, na ordem de leitura. Insira de 2 a 6 itens, um por tópico. O texto das seções é editado em Corpo.",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      validation: (rule) => rule.required().min(2).max(6),
    }),
    defineField({
      name: "lead",
      title: "Parágrafo de abertura",
      description:
        "Introdução que apresenta o problema ou a pergunta do artigo e conduz o leitor ao desenvolvimento. Mínimo de 80 caracteres.",
      type: "text",
      rows: 4,
      validation: (rule) => rule.required().min(80),
    }),
  ],
});

export const articleRichTextBlockType = defineType({
  name: "articleRichTextBlock",
  title: "Bloco de texto",
  type: "object",
  fields: [
    defineField({
      name: "content",
      title: "Conteudo",
      type: "array",
      of: richTextOf,
      validation: (rule) => rule.required().min(1),
    }),
  ],
  preview: {
    prepare() {
      return { title: "Texto corrido" };
    },
  },
});

export const articlePullQuoteBlockType = defineType({
  name: "articlePullQuoteBlock",
  title: "Pull quote",
  type: "object",
  fields: [
    defineField({
      name: "quote",
      title: "Citacao",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required().min(20),
    }),
    defineField({
      name: "attribution",
      title: "Atribuicao",
      type: "string",
    }),
  ],
});

export const articleLegalExcerptBlockType = defineType({
  name: "articleLegalExcerptBlock",
  title: "Trecho legal",
  type: "object",
  fields: [
    defineField({
      name: "source",
      title: "Fonte",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "citation",
      title: "Citacao",
      type: "string",
    }),
    defineField({
      name: "excerpt",
      title: "Trecho",
      type: "text",
      rows: 5,
      validation: (rule) => rule.required().min(20),
    }),
  ],
});

export const articleCalloutBlockType = defineType({
  name: "articleCalloutBlock",
  title: "Callout",
  type: "object",
  fields: [
    defineField({
      name: "tone",
      title: "Tom",
      type: "string",
      initialValue: "note",
      options: {
        list: [
          { title: "Nota", value: "note" },
          { title: "Atencao", value: "warning" },
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "title",
      title: "Titulo",
      type: "string",
    }),
    defineField({
      name: "body",
      title: "Conteudo",
      type: "array",
      of: richTextOf,
      validation: (rule) => rule.required().min(1),
    }),
  ],
});

export const articleSectionType = defineType({
  name: "articleSection",
  title: "Secao editorial",
  type: "object",
  fields: [
    defineField({
      name: "id",
      title: "ID",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "number",
      title: "Numero",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "title",
      title: "Titulo",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "content",
      title: "Conteudo",
      type: "array",
      of: [
        defineArrayMember({ type: "articleRichTextBlock" }),
        defineArrayMember({ type: "articlePullQuoteBlock" }),
        defineArrayMember({ type: "articleLegalExcerptBlock" }),
        defineArrayMember({ type: "articleCalloutBlock" }),
      ],
      validation: (rule) => rule.required().min(1),
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "number",
    },
    prepare({ title, subtitle }) {
      return {
        title,
        subtitle: subtitle ? `Secao ${subtitle}` : "Secao editorial",
      };
    },
  },
});

export const articleFootnoteType = defineType({
  name: "articleFootnote",
  title: "Nota",
  type: "object",
  fields: [
    defineField({
      name: "label",
      title: "Identificador",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "content",
      title: "Conteudo",
      type: "array",
      of: richTextOf,
      validation: (rule) => rule.required().min(1),
    }),
  ],
});

export const articleReferenceType = defineType({
  name: "articleReference",
  title: "Referencia",
  type: "object",
  fields: [
    defineField({
      name: "label",
      title: "Rotulo",
      type: "string",
    }),
    defineField({
      name: "text",
      title: "Texto",
      type: "text",
      rows: 4,
      validation: (rule) => rule.min(20),
    }),
    defineField({
      name: "matches",
      title: "Matches",
      type: "array",
      of: [defineArrayMember({ type: "articleReferenceMatch" })],
      validation: (rule) => rule.max(8),
    }),
  ],
});
