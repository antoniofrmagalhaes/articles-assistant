import test from "node:test";
import assert from "node:assert/strict";
import { parse, evaluate } from "groq-js";
import { searchArticles } from "../lib/research.mjs";
import { lookupArticle } from "../lib/articles.mjs";

const config = { projectId: "offline", dataset: "production", siteUrl: "http://localhost:3000" };
const published = {
  _id: "article-one",
  _type: "article",
  _rev: "published-r1",
  title: "O cônjuge vai deixar de ser herdeiro?",
  slug: { current: "o-conjuge-vai-deixar-de-ser-herdeiro" },
};
const draft = { ...published, _id: "drafts.article-one", _rev: "draft-r2" };
const apiFor = (dataset) => ({
  fetch: async (query, params) => (await evaluate(parse(query), { dataset, params })).get(),
  getDocument: async (id) => dataset.find((document) => document._id === id),
});
test("no filter finds one logical article with published and draft, not two articles", async () => {
  const result = await searchArticles(
    {},
    {
      config,
      api: apiFor([
        published,
        draft,
        { ...published, _id: "versions.release.article-one" },
        { ...published, _id: "media", _type: "mediaAppearance" },
      ]),
    },
  );
  assert.equal(result.totalArticles, 1);
  assert.equal(result.totalMatchingRecords, 2);
  assert.equal(result.singleArticleId, published._id);
  assert.equal(result.articles[0].published.revision, published._rev);
  assert.equal(result.articles[0].draft.revision, draft._rev);
  assert.equal(result.articles[0].recordCount, 2);
});
test("title, unaccented slug term, ID and article URL use the same read-only research", async () => {
  for (const query of [
    "cônjuge",
    "conjuge",
    published._id,
    "http://localhost:3000/artigos/o-conjuge-vai-deixar-de-ser-herdeiro",
  ]) {
    const result = await searchArticles({ query }, { config, api: apiFor([published, draft]) });
    assert.equal(result.singleArticleId, published._id, query);
  }
});
test("logical pagination keeps both versions together and does not imply an unambiguous selection", async () => {
  const second = {
    ...published,
    _id: "article-two",
    title: "Outro artigo",
    slug: { current: "outro-artigo" },
  };
  const result = await searchArticles(
    { pageSize: 1 },
    { config, api: apiFor([published, draft, second]) },
  );
  assert.equal(result.totalArticles, 2);
  assert.equal(result.singleArticleId, null);
  assert.equal(result.articles[0].recordCount, 2);
  assert.equal(result.hasMore, true);
});
test("lookup without an identifier lists remotely; a draft ID resolves its published counterpart", async () => {
  const dependencies = { config, api: apiFor([published, draft]) };
  assert.equal((await lookupArticle({}, dependencies)).singleArticleId, published._id);
  const found = await lookupArticle({ id: draft._id }, dependencies);
  assert.equal(found.document._id, published._id);
  assert.equal(found.draft._id, draft._id);
});
