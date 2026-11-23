import assert from "node:assert/strict";
import { validateArticleObject } from "../scripts/validate-article.mjs";

export const validArticle = {
  _type: "article",
  title: "Artigo local para validação",
  slug: { _type: "slug", current: "artigo-local-validacao" },
  frontMatter: {
    abstract: "Resumo acadêmico. ".repeat(8),
    titleNote: "Nota editorial baseada no documento original.",
    lead: "Parágrafo de abertura. ".repeat(8),
    summaryItems: ["Introdução", "Conclusão"],
  },
  author: {
    name: "Autora de teste",
    description: "Descrição editorial de teste com mais de quarenta caracteres.",
  },
  hero: { displayMode: "editorial-header" },
  seo: {
    excerpt: "Resumo da listagem com mais de sessenta caracteres, criado para validação local.",
  },
  taxonomy: { topics: ["Família"] },
  publication: { publishedAt: "2026-11-23T12:00:00Z" },
  footnotes: [],
  sections: [
    {
      _type: "articleSection",
      _key: "section1",
      id: "introducao",
      number: "1",
      title: "Introdução",
      content: [
        {
          _type: "articleRichTextBlock",
          _key: "rich1",
          content: [
            {
              _type: "block",
              _key: "block1",
              style: "normal",
              children: [
                { _type: "span", _key: "span1", text: "Texto de teste preservado.", marks: [] },
              ],
              markDefs: [],
            },
          ],
        },
      ],
    },
  ],
};

const original = structuredClone(validArticle);
assert.equal((await validateArticleObject(validArticle)).valid, true);
assert.deepEqual(validArticle, original);
for (const [name, mutate, field] of [
  [
    "missing author",
    (x) => {
      delete x.author;
    },
    "author",
  ],
  [
    "wrong type",
    (x) => {
      x.sections = {};
    },
    "sections",
  ],
  [
    "missing content",
    (x) => {
      x.sections[0].content[0].content = null;
    },
    "sections",
  ],
  [
    "unknown block",
    (x) => {
      x.sections[0].content.push({ _type: "unknownBlock", _key: "unknown" });
    },
    "sections",
  ],
  [
    "null span",
    (x) => {
      x.sections[0].content[0].content[0].children.push(null);
    },
    "sections",
  ],
  [
    "invalid date",
    (x) => {
      x.publication.publishedAt = "not-a-date";
    },
    "publication",
  ],
  [
    "invalid slug",
    (x) => {
      x.slug.current = "../escape";
    },
    "slug",
  ],
  [
    "conditional alt",
    (x) => {
      x.hero.coverImage = {
        _type: "image",
        asset: { _type: "reference", _ref: "image-test-100x100-png" },
      };
    },
    "hero",
  ],
]) {
  const input = structuredClone(validArticle);
  mutate(input);
  const result = await validateArticleObject(input);
  assert.equal(result.valid, false, `${name}: ${JSON.stringify(result)}`);
  assert.ok(
    result.errors.some((issue) => issue.field.startsWith(field)),
    name,
  );
  console.log(`PASS ${name}`);
}
console.log("PASS current Studio schema, local minimum and source preservation");
