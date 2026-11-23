import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { docs, json, saveJson, hash, destination, articleFiles } from "../lib/workspace.mjs";
import {
  validateLocal,
  publishArticle,
  checkPage,
  adoptPanelIdentity,
  checkPanelReady,
  resetArticleDraft,
  chooseMode,
  expectedVisibleText,
} from "../lib/articles.mjs";

const config = {
  projectId: "offline",
  dataset: "test",
  token: "test-only",
  siteUrl: "https://example.test",
  studioUrl: "https://studio.test",
};
const example = await json(new URL("../examples/article.json", import.meta.url));
function mockSanity() {
  let documents = new Map();
  let sequence = 0;
  const api = {
    writes: 0,
    failAfterCommit: false,
    config: () => ({ projectId: "offline", dataset: "test" }),
    withConfig: () => api,
    getDocument: async (id) => structuredClone(documents.get(id)),
    fetch: async (_query, params, options) =>
      options?.tag === "articles.reset-drafts"
        ? [...documents.values()]
            .filter(
              (item) =>
                item._type === "article" &&
                item._id.startsWith("drafts.") &&
                (item._id === params.draft || item.slug?.current === params.slug),
            )
            .map((item) => structuredClone(item))
        : options?.tag === "validation.slug-is-unique"
          ? ![...documents.values()].some(
              (item) =>
                item.slug?.current === params.slug &&
                ![params.published, `drafts.${params.published}`].includes(item._id),
            )
          : [...documents.values()]
              .filter(
                (item) =>
                  item.slug?.current === params.slug &&
                  ![params.id, params.draft].includes(item._id),
              )
              .map(({ _id }) => ({ _id })),
    transaction() {
      const operations = [];
      const tx = {
        create(document) {
          operations.push({ kind: "create", document });
          return tx;
        },
        patch(id, callback) {
          const operation = { kind: "patch", id, set: {}, unset: [] };
          const patch = {
            ifRevisionId(revision) {
              operation.revision = revision;
              return patch;
            },
            set(fields) {
              operation.set = fields;
              return patch;
            },
            unset(fields) {
              operation.unset = fields;
              return patch;
            },
          };
          callback(patch);
          operations.push(operation);
          return tx;
        },
        delete(id) {
          operations.push({ kind: "delete", id });
          return tx;
        },
        async commit() {
          const next = structuredClone(documents);
          for (const operation of operations) {
            if (operation.kind === "create") {
              if (next.has(operation.document._id)) throw new Error("Already exists");
              next.set(operation.document._id, {
                ...structuredClone(operation.document),
                _rev: `r${++sequence}`,
              });
            } else if (operation.kind === "delete") next.delete(operation.id);
            else {
              const before = next.get(operation.id);
              if (!before || before._rev !== operation.revision)
                throw new Error("Revision conflict");
              const updated = { ...before, ...operation.set, _rev: `r${++sequence}` };
              operation.unset.forEach((key) => delete updated[key]);
              next.set(operation.id, updated);
            }
          }
          documents = next;
          api.writes++;
          if (api.failAfterCommit) {
            api.failAfterCommit = false;
            throw new Error("Simulated timeout after write");
          }
        },
      };
      return tx;
    },
    size: () => documents.size,
    seed(document) {
      documents.set(document._id, structuredClone(document));
    },
    externalEdit(id) {
      documents.set(id, {
        ...documents.get(id),
        title: "Título editado externamente",
        _rev: `r${++sequence}`,
      });
    },
  };
  return api;
}
async function fixture(run) {
  const slug = `test-${randomUUID()}`;
  const folder = path.join(docs, slug);
  await fs.mkdir(folder);
  const document = structuredClone(example);
  document._id = `article-${randomUUID()}`;
  document.slug.current = slug;
  const articlePath = `Docs/${slug}/article.json`;
  const state = {
    origin: "remote-import",
    id: document._id,
    cid: document.cid,
    mode: "direct",
    chosenHash: hash(document),
    destination: destination(config),
  };
  await saveJson(path.join(folder, "article.json"), document);
  await saveJson(path.join(folder, "publication-state.json"), state);
  try {
    await run({ document, articlePath, folder, api: mockSanity() });
  } finally {
    assert.equal(path.dirname(await fs.realpath(folder)), await fs.realpath(docs));
    for (const name of await fs.readdir(folder)) await fs.unlink(path.join(folder, name));
    await fs.rmdir(folder);
  }
}

test("create, retry and correction retain one published document", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    const result = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config, api },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal(api.size(), 1);
    assert.equal(
      (await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api }))
        .id,
      document._id,
    );
    assert.equal(api.writes, 1);
    document.sections[0].title = "Introdução corrigida";
    await saveJson(path.join(folder, "article.json"), document);
    const state = await json(path.join(folder, "publication-state.json"));
    await saveJson(path.join(folder, "publication-state.json"), {
      ...state,
      chosenHash: hash(document),
    });
    const corrected = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config, api },
    );
    assert.equal(corrected.id, result.id);
    assert.notEqual(corrected.revision, result.revision);
    assert.equal(api.size(), 1);
    assert.equal((await api.getDocument(document._id)).sections[0].title, "Introdução corrigida");
  }));
test("timeout after commit recovers without duplication", async () =>
  fixture(async ({ document, articlePath, api }) => {
    api.failAfterCommit = true;
    await assert.rejects(
      () => publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api }),
      /não confirmada/,
    );
    assert.equal(api.size(), 1);
    const recovered = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config, api },
    );
    assert.equal(recovered.sanityPublished, true);
    assert.equal(api.writes, 1);
  }));
test("hash, mode, invalid schema and remote revision block writes", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    await assert.rejects(
      () => publishArticle({ articlePath, expectedContentHash: "wrong" }, { config, api }),
      /JSON mudou/,
    );
    const filename = path.join(folder, "publication-state.json");
    const state = await json(filename);
    await saveJson(filename, { ...state, mode: "panel" });
    await assert.rejects(
      () => publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api }),
      /modo direto/,
    );
    await saveJson(filename, state);
    document.sections[0].content = null;
    await saveJson(path.join(folder, "article.json"), document);
    assert.equal((await validateLocal(articlePath)).valid, false);
    await assert.rejects(
      () => publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api }),
      /Publicação bloqueada/,
    );
    assert.equal(api.writes, 0);
  }));
test("external edit is preserved on correction", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    api.externalEdit(document._id);
    document.sections[0].title = "Correção local";
    await saveJson(path.join(folder, "article.json"), document);
    const state = await json(path.join(folder, "publication-state.json"));
    await saveJson(path.join(folder, "publication-state.json"), {
      ...state,
      chosenHash: hash(document),
    });
    await assert.rejects(
      () => publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api }),
      /Conflito de revisão/,
    );
    assert.equal((await api.getDocument(document._id)).title, "Título editado externamente");
  }));
test("HTTP 200 with missing visible content remains pending", async () =>
  fixture(async ({ document, articlePath, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    const result = await checkPage(
      { articlePath },
      {
        config,
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            `<article><h1>${document.title}</h1></article><script>${JSON.stringify(document)}</script>`,
        }),
      },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal(result.pageChecked, false);
    assert.ok(result.missing.length);
  }));
test("path escapes are refused", async () => {
  await assert.rejects(() => articleFiles("../article.json"), /somente Docs/);
});

const completeHtml = (document) =>
  `<article><h1>${document.title}</h1>${expectedVisibleText(document)
    .map((text) => `<p>${text}</p>`)
    .join("")}</article>`;
const streamHtml = (document) =>
  `<article><h1>${document.title}</h1><template id="P:1"></template></article><div hidden id="S:1">${expectedVisibleText(
    document,
  )
    .map((text) => `<p>${text}</p>`)
    .join("")}</div><script>$RS("S:1","P:1")</script>`;
const pageResponse = (html) => async () => ({ ok: true, status: 200, text: async () => html });

test("complete HTML passes while streamed HTML remains pending without false missing paragraphs", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    const staticResult = await checkPage(
      { articlePath },
      { config, fetch: pageResponse(completeHtml(document)) },
    );
    assert.equal(staticResult.pageChecked, true);
    assert.equal(staticResult.method, "http-static");
    const result = await checkPage(
      { articlePath },
      { config, fetch: pageResponse(streamHtml(document)) },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal(result.pageChecked, false);
    assert.equal(result.reasonCode, "streaming_requires_browser");
    assert.equal(result.nextTool, "articles_devtools.check_public_page_rendered");
    assert.deepEqual(result.missing, []);
    assert.equal(result.contentHash, hash(document));
    assert.ok(Date.parse(result.checkedAt));
    assert.equal(
      (await json(path.join(folder, "publication-state.json"))).pageCheck.status,
      "pending",
    );
  }));

test("rendered DOM completes a streamed check and records evidence in the same local state", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    const current = { ...config, siteUrl: "http://localhost:3000" };
    const result = await checkPage(
      { articlePath },
      {
        config: current,
        fetch: pageResponse(streamHtml(document)),
        renderPage: async (url) => ({
          url,
          settled: true,
          heading: document.title,
          text: expectedVisibleText(document).join("\n"),
          httpStatus: 200,
        }),
      },
    );
    assert.equal(result.pageChecked, true);
    assert.equal(result.method, "rendered-dom");
    assert.equal(result.status, "checked");
    assert.equal(result.reasonCode, undefined);
    assert.deepEqual(result.missing, []);
    assert.equal(result.renderedUrl, `http://localhost:3000/artigos/${document.slug.current}`);
    const state = await json(path.join(folder, "publication-state.json"));
    assert.equal(state.pageChecked, true);
    assert.equal(state.pageCheck.contentHash, hash(document));
  }));

test("a genuinely absent rendered paragraph fails even if the HTTP HTML contains it", async () =>
  fixture(async ({ document, articlePath, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    const expected = expectedVisibleText(document);
    const removed = expected.at(-1);
    const result = await checkPage(
      { articlePath },
      {
        config,
        fetch: pageResponse(completeHtml(document)),
        renderPage: async (url) => ({
          url,
          settled: true,
          heading: document.title,
          text: expected.filter((text) => text !== removed).join("\n"),
        }),
      },
    );
    assert.equal(result.pageChecked, false);
    assert.equal(result.reasonCode, "content_mismatch");
    assert.ok(result.missing.includes(removed));
  }));

test("browser failure, unfinished rendering, redirect, error page and stale content cannot confirm the page", async () =>
  fixture(async ({ document, articlePath, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    const snapshot = {
      settled: true,
      heading: document.title,
      text: expectedVisibleText(document).join("\n"),
      httpStatus: 200,
    };
    for (const [patch, reasonCode] of [
      [{ settled: false }, "render_pending"],
      [{ pendingStreaming: true }, "render_pending"],
      [{ url: "https://other.test/artigos/test" }, "unexpected_url"],
      [{ httpStatus: 404 }, "browser_http_error"],
      [{ text: "Conteúdo antigo no cache" }, "content_mismatch"],
    ]) {
      const result = await checkPage(
        { articlePath },
        {
          config,
          fetch: pageResponse(streamHtml(document)),
          renderPage: async (url) => ({ url, ...snapshot, ...patch }),
        },
      );
      assert.equal(result.sanityPublished, true);
      assert.equal(result.pageChecked, false);
      assert.equal(result.reasonCode, reasonCode);
      if (reasonCode !== "content_mismatch") assert.deepEqual(result.missing, []);
    }
    const result = await checkPage(
      { articlePath },
      {
        config,
        fetch: pageResponse(streamHtml(document)),
        renderPage: async () => {
          throw new Error("Chrome desconectado");
        },
      },
    );
    assert.equal(result.pageChecked, false);
    assert.equal(result.reasonCode, "browser_unavailable");
    assert.deepEqual(result.missing, []);
    assert.equal(result.sanityPublished, true);
  }));
test("page check follows current SITE_URL even when state recorded another viewing URL", async () =>
  fixture(async ({ document, articlePath, api }) => {
    await publishArticle({ articlePath, expectedContentHash: hash(document) }, { config, api });
    let requested;
    const current = { ...config, siteUrl: "http://localhost:3000" };
    const result = await checkPage(
      { articlePath },
      {
        config: current,
        fetch: async (url) => {
          requested = url;
          return {
            ok: false,
            status: 404,
            text: async () => "Not found at this configured endpoint",
          };
        },
      },
    );
    assert.equal(requested, `http://localhost:3000/artigos/${document.slug.current}`);
    assert.equal(result.url, requested);
    assert.equal(result.httpStatus, 404);
    assert.equal(result.sanityPublished, true);
    assert.equal(result.pageChecked, false);
  }));
test("UI disabled publishes directly with no prior mode choice or chosen hash", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    const statePath = path.join(folder, "publication-state.json");
    const state = await json(statePath);
    delete state.mode;
    delete state.chosenHash;
    await saveJson(statePath, state);
    const disabled = { ...config, allowUiPublication: false };
    const result = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config: disabled, api },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal((await json(statePath)).mode, "direct");
    assert.equal(api.size(), 1);
    await assert.rejects(
      () =>
        checkPanelReady(
          { articlePath, expectedContentHash: hash(document) },
          { config: disabled, api },
        ),
      /ALLOW_UI_PUBLICATION=false/,
    );
    await assert.rejects(
      () =>
        adoptPanelIdentity(
          { articlePath, draftId: `drafts.${document._id}` },
          { config: disabled, api },
        ),
      /ALLOW_UI_PUBLICATION=false/,
    );
  }));
test("different stale draft is discarded and direct publication restarts from canonical JSON", async () =>
  fixture(async ({ document, articlePath, api }) => {
    const draft = {
      ...structuredClone(document),
      _id: `drafts.${document._id}`,
      _rev: "stale-draft",
      title: "Rascunho antigo diferente",
    };
    api.seed(draft);
    const result = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config, api },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal(await api.getDocument(draft._id), undefined);
    assert.equal((await api.getDocument(document._id)).title, document.title);
    assert.equal(api.size(), 1);
  }));
test("timeout after draft deletion is reconciled and publication restarts without asking", async () =>
  fixture(async ({ document, articlePath, api }) => {
    const draftId = `drafts.${document._id}`;
    api.seed({ ...structuredClone(document), _id: draftId, _rev: "stale-r1", title: "Old draft" });
    api.failAfterCommit = true;
    const result = await publishArticle(
      { articlePath, expectedContentHash: hash(document) },
      { config, api },
    );
    assert.equal(result.sanityPublished, true);
    assert.equal(await api.getDocument(draftId), undefined);
    assert.equal(api.size(), 1);
  }));
test("selecting panel discards the previous draft before a new UI operation", async () =>
  fixture(async ({ document, articlePath, api }) => {
    const draftId = `drafts.${document._id}`;
    api.seed({
      ...structuredClone(document),
      _id: draftId,
      _rev: "previous-r1",
      title: "Abandoned UI",
    });
    const result = await chooseMode({ articlePath, mode: "panel" }, { config, api });
    assert.equal(result.mode, "panel");
    assert.equal(result.draftReset.restartRequired, true);
    assert.equal(await api.getDocument(draftId), undefined);
    assert.equal(api.size(), 0);
    await assert.rejects(
      () =>
        chooseMode(
          { articlePath, mode: "panel" },
          { config: { ...config, allowUiPublication: false }, api },
        ),
      /ALLOW_UI_PUBLICATION=false/,
    );
  }));
test("panel reset deletes an abandoned same-slug draft and preserves the published document", async () =>
  fixture(async ({ document, articlePath, api }) => {
    const published = { ...structuredClone(document), _rev: "published-r1" };
    const draft = {
      ...structuredClone(document),
      _id: "drafts.abandoned-other-id",
      _rev: "old-draft",
      title: "Inacabado",
    };
    api.seed(published);
    api.seed(draft);
    const result = await resetArticleDraft({ articlePath }, { config, api });
    assert.deepEqual(result.removedDraftIds, [draft._id]);
    assert.equal(result.restartRequired, true);
    assert.deepEqual(await api.getDocument(document._id), published);
    assert.equal(await api.getDocument(draft._id), undefined);
  }));
test("a draft belonging to another published document is not discarded as this article", async () =>
  fixture(async ({ document, articlePath, api }) => {
    const other = { ...structuredClone(document), _id: "other-published", _rev: "other-r1" };
    const draft = { ...other, _id: "drafts.other-published", _rev: "other-draft-r1" };
    api.seed(other);
    api.seed(draft);
    await assert.rejects(
      () => resetArticleDraft({ articlePath }, { config, api }),
      /outro documento publicado/,
    );
    assert.deepEqual(await api.getDocument(draft._id), draft);
    assert.equal(api.writes, 0);
  }));
test("panel reconciles only generated metadata and never writes by API", async () =>
  fixture(async ({ document, articlePath, folder, api }) => {
    const statePath = path.join(folder, "publication-state.json");
    await saveJson(statePath, { ...(await json(statePath)), mode: "panel" });
    const draft = structuredClone(document);
    draft._id = `drafts.article-${randomUUID()}`;
    draft._rev = "draft-r1";
    draft.cid = "cidv1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    draft.sections[0]._key = "studio-section-key";
    api.seed(draft);
    const adopted = await adoptPanelIdentity({ articlePath, draftId: draft._id }, { config, api });
    assert.equal(adopted.id, draft._id.slice(7));
    assert.equal(
      (await json(path.join(folder, "article.json"))).sections[0]._key,
      "studio-section-key",
    );
    const ready = await checkPanelReady(
      { articlePath, expectedContentHash: adopted.contentHash },
      { config, api },
    );
    assert.equal(ready.panelReady, true);
    assert.equal(api.writes, 0);
    await assert.rejects(
      () =>
        publishArticle({ articlePath, expectedContentHash: adopted.contentHash }, { config, api }),
      /modo direto/,
    );
  }));
