import { defineArrayMember, defineField, defineType } from "sanity";

function createArticleCid() {
  const hexLength = 40;

  if (typeof globalThis.crypto !== "undefined" && "getRandomValues" in globalThis.crypto) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(hexLength / 2));
    const hash = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `cidv1-${hash}`;
  }

  const fallback = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(
    0,
    hexLength,
  );
  return `cidv1-${fallback.padEnd(hexLength, "0")}`;
}

export const articleType = defineType({
  name: "article",
  title: "Artigo",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Título",
      type: "string",
      validation: (rule) => rule.required().min(12).max(140),
    }),
    defineField({
      name: "frontMatter",
      title: "Abertura",
      type: "articleFrontMatter",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "sections",
      title: "Seções",
      type: "array",
      of: [defineArrayMember({ type: "articleSection" })],
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: "footnotes",
      title: "Notas",
      type: "array",
      of: [defineArrayMember({ type: "articleFootnote" })],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "references",
      title: "Referências",
      type: "array",
      of: [defineArrayMember({ type: "articleReference" })],
    }),
    defineField({
      name: "author",
      title: "Autor",
      type: "articleAuthor",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "coAuthors",
      title: "Coautores",
      type: "array",
      of: [defineArrayMember({ type: "articleAuthor" })],
      validation: (rule) => rule.max(4),
    }),
    defineField({
      name: "hero",
      title: "Capa e apresentação",
      type: "articleHero",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "seo",
      title: "Resumo e destaque",
      type: "articleSeo",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "taxonomy",
      title: "Temas do artigo",
      type: "articleTaxonomy",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "publication",
      title: "Dados de publicação",
      type: "articlePublication",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      description:
        "Parte do endereço que identifica o artigo. Use Generate para gerar a partir do título. Ex.: guarda-compartilhada. Alterar em um artigo já publicado pode mudar seu endereço.",
      type: "slug",
      options: {
        source: "title",
        maxLength: 96,
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "cid",
      title: "CID",
      type: "string",
      readOnly: true,
      description:
        "Código de identificação estável, gerado automaticamente. Mantenha o valor existente ao editar o artigo; este campo não é um link.",
      initialValue: () => createArticleCid(),
      validation: (rule) =>
        rule.regex(/^cidv1-[a-f0-9]{16,64}$/).warning("Formato esperado: cidv1-<hash>."),
    }),
  ],
  preview: {
    select: {
      title: "title",
      primaryAuthor: "author.name",
      displayMode: "hero.displayMode",
      media: "hero.coverImage",
    },
    prepare({ title, primaryAuthor, displayMode, media }) {
      const subtitleParts = [primaryAuthor, displayMode].filter(Boolean);

      return {
        title,
        subtitle: subtitleParts.join(" • "),
        media,
      };
    },
  },
});
