import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse, evaluate } from "groq-js";
import { root, docs, saveJson, json, destination } from "../lib/workspace.mjs";
import { searchArticles } from "../lib/research.mjs";
import { deleteRemoteArticle, prepareArticleDeletion } from "../lib/remote-delete.mjs";

const config = {
  projectId: "offline",
  dataset: "test",
  siteUrl: "http://localhost:3000",
  token: "test",
};
async function fixture(run) {
  const id = `test-delete-${randomUUID()}`;
  const published = {
    _id: id,
    _type: "article",
    _rev: "published-r1",
    title: "Artigo remoto sem cadastro local",
  };
  const draft = {
    ...published,
    _id: `drafts.${id}`,
    _rev: "draft-r1",
    title: "Rascunho divergente",
  };
  let documents = new Map([published, draft].map((document) => [document._id, document]));
  const api = {
    writes: 0,
    loseResponse: false,
    rejectCommit: false,
    getDocument: async (key) => structuredClone(documents.get(key)),
    fetch: async (query, params) =>
      (await evaluate(parse(query), { dataset: [...documents.values()], params })).get(),
    transaction() {
      const guards = [],
        deletions = [];
      const tx = {
        patch(key, callback) {
          const guard = { id: key };
          const patch = {
            ifRevisionId(revision) {
              guard.revision = revision;
              return patch;
            },
            set() {
              return patch;
            },
          };
          callback(patch);
          guards.push(guard);
          return tx;
        },
        delete(key) {
          deletions.push(key);
          return tx;
        },
        async commit() {
          if (api.beforeCommit) await api.beforeCommit();
          if (api.rejectCommit) throw new Error("Simulated permission error");
          for (const guard of guards) assert.equal(documents.get(guard.id)?._rev, guard.revision);
          documents = new Map(documents);
          deletions.forEach((key) => documents.delete(key));
          api.writes++;
          if (api.loseResponse) {
            api.loseResponse = false;
            throw new Error("Timeout after commit");
          }
        },
      };
      return tx;
    },
  };
  try {
    await run({ id, published, draft, api });
  } finally {
    await fs.unlink(path.join(root, "operations/deletions", `${id}.json`)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
test("remote research and deletion work without Docs, Word, valid article schema or Chrome", async () =>
  fixture(async ({ published, draft, api }) => {
    const found = await searchArticles({}, { config, api });
    assert.equal(found.totalArticles, 1);
    assert.equal(found.totalMatchingRecords, 2);
    const result = await deleteRemoteArticle(
      {
        id: found.singleArticleId,
        expectedPublishedRevision: found.articles[0].published.revision,
        confirmDelete: true,
      },
      { config, api },
    );
    assert.equal(result.publishedAbsent, true);
    assert.equal(result.draftAbsent, true);
    assert.equal(await api.getDocument(published._id), undefined);
    assert.equal(await api.getDocument(draft._id), undefined);
    assert.equal(result.localRecordUpdated, false);
  }));

async function withSources(id, run) {
  const slug = `local-sources-${randomUUID()}`;
  const folder = path.join(docs, slug);
  await fs.mkdir(folder);
  await saveJson(path.join(folder, "article.json"), {
    _id: id,
    _type: "article",
    slug: { current: slug },
  });
  await saveJson(path.join(folder, "publication-state.json"), {
    id,
    status: "published",
    destination: destination(config),
  });
  await fs.writeFile(
    path.join(folder, "original.docx"),
    "Original preserved until explicit approval",
  );
  try {
    await run({ folder, word: path.join(folder, "original.docx") });
  } finally {
    const entries = await fs.readdir(folder).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (entries.length)
      assert.equal(path.dirname(await fs.realpath(folder)), await fs.realpath(docs));
    for (const name of entries) await fs.unlink(path.join(folder, name));
    await fs.rmdir(folder).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
test("source files require a decision BEFORE any Sanity deletion; no preserves local files", async () =>
  fixture(async ({ id, published, api }) =>
    withSources(id, async ({ folder, word }) => {
      const prepared = await prepareArticleDeletion({ ids: [id] }, { config, api });
      assert.equal(prepared.requiresLocalFilesDecision, true);
      assert.equal(api.writes, 0);
      const paused = await deleteRemoteArticle(
        { id, expectedPublishedRevision: published._rev, confirmDelete: true },
        { config, api },
      );
      assert.equal(paused.requiresLocalFilesDecision, true);
      assert.equal(paused.deleted, false);
      assert.equal(api.writes, 0);
      await fs.access(word);
      const result = await deleteRemoteArticle(
        {
          id,
          expectedPublishedRevision: published._rev,
          confirmDelete: true,
          removeLocalFiles: false,
        },
        { config, api },
      );
      assert.equal(result.deleted, true);
      assert.equal(result.localFilesPreserved, true);
      assert.equal((await json(path.join(folder, "publication-state.json"))).status, "deleted");
      await fs.access(word);
    }),
  ));
test("yes deletes Sanity first, then only the approved article folder", async () =>
  fixture(async ({ id, published, api }) =>
    withSources(id, async ({ folder, word }) =>
      withSources(`unrelated-${randomUUID()}`, async ({ word: unrelatedWord }) => {
        const prepared = await prepareArticleDeletion({ ids: [id] }, { config, api });
        api.beforeCommit = async () => {
          await fs.access(word);
          await fs.access(unrelatedWord);
        };
        const result = await deleteRemoteArticle(
          {
            id,
            expectedPublishedRevision: published._rev,
            confirmDelete: true,
            removeLocalFiles: true,
            expectedLocalFilesToken: prepared.deletions[0].localFilesToken,
          },
          { config, api },
        );
        assert.equal(result.publishedAbsent, true);
        assert.equal(result.draftAbsent, true);
        assert.equal(result.localFilesRemoved, true);
        assert.equal(result.localCleanupPending, false);
        await assert.rejects(() => fs.access(folder), { code: "ENOENT" });
        await fs.access(unrelatedWord);
      }),
    ),
  ));
test("a Sanity failure leaves all physical source files intact", async () =>
  fixture(async ({ id, published, api }) =>
    withSources(id, async ({ folder, word }) => {
      const prepared = await prepareArticleDeletion({ ids: [id] }, { config, api });
      api.rejectCommit = true;
      await assert.rejects(
        () =>
          deleteRemoteArticle(
            {
              id,
              expectedPublishedRevision: published._rev,
              confirmDelete: true,
              removeLocalFiles: true,
              expectedLocalFilesToken: prepared.deletions[0].localFilesToken,
            },
            { config, api },
          ),
        /Exclusão ainda não confirmada/,
      );
      await fs.access(word);
      await fs.access(path.join(folder, "article.json"));
      assert.equal((await json(path.join(folder, "publication-state.json"))).status, "published");
      await assert.rejects(() => fs.access(path.join(folder, ".operation.lock")), {
        code: "ENOENT",
      });
    }),
  ));
test("physical cleanup failure is reported separately after remote deletion", async () =>
  fixture(async ({ id, published, api }) =>
    withSources(id, async ({ word }) => {
      const prepared = await prepareArticleDeletion({ ids: [id] }, { config, api });
      const result = await deleteRemoteArticle(
        {
          id,
          expectedPublishedRevision: published._rev,
          confirmDelete: true,
          removeLocalFiles: true,
          expectedLocalFilesToken: prepared.deletions[0].localFilesToken,
        },
        {
          config,
          api,
          removeSources: async () => {
            assert.equal(await api.getDocument(id), undefined);
            assert.equal(await api.getDocument(`drafts.${id}`), undefined);
            throw new Error("Word is open; close it before retrying cleanup");
          },
        },
      );
      assert.equal(result.deleted, true);
      assert.equal(result.localFilesRemoved, false);
      assert.equal(result.localCleanupPending, true);
      assert.match(result.localCleanupError, /Word is open/);
      await fs.access(word);
    }),
  ));

test("changed local scope is rejected before any remote or physical deletion", async () =>
  fixture(async ({ id, published, api }) =>
    withSources(id, async ({ folder, word }) => {
      const prepared = await prepareArticleDeletion({ ids: [id] }, { config, api });
      await fs.writeFile(path.join(folder, "new-file.txt"), "Not part of the approved scope");
      await assert.rejects(
        () =>
          deleteRemoteArticle(
            {
              id,
              expectedPublishedRevision: published._rev,
              confirmDelete: true,
              removeLocalFiles: true,
              expectedLocalFilesToken: prepared.deletions[0].localFilesToken,
            },
            { config, api },
          ),
        /escopo mudou/,
      );
      assert.equal(api.writes, 0);
      await fs.access(word);
    }),
  ));
test("deletion timeout is reconciled by reading both versions before any repeat", async () =>
  fixture(async ({ id, published, api }) => {
    api.loseResponse = true;
    const result = await deleteRemoteArticle(
      { id, expectedPublishedRevision: published._rev, confirmDelete: true },
      { config, api },
    );
    assert.equal(result.deleted, true);
    assert.equal(api.writes, 1);
  }));
test("an altered published revision blocks deletion while draft differences do not", async () =>
  fixture(async ({ id, api }) => {
    await assert.rejects(
      () =>
        deleteRemoteArticle(
          { id, expectedPublishedRevision: "stale-revision", confirmDelete: true },
          { config, api },
        ),
      /revisão publicada mudou/,
    );
    assert.equal(api.writes, 0);
    await assert.rejects(
      () =>
        deleteRemoteArticle(
          { id, expectedPublishedRevision: null, confirmDelete: false },
          { config, api },
        ),
      /pedido explícito/,
    );
  }));
