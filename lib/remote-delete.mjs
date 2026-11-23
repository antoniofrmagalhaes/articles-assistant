import fs from "node:fs/promises";
import path from "node:path";
import {
  root,
  docs,
  settings,
  client,
  destination,
  getRemote,
  saveJson,
  localArticle,
  assertDestination,
  updateState,
} from "./workspace.mjs";
import { publishedArticleId } from "./research.mjs";
import {
  localSourcePlan,
  localSourceOffer,
  lockLocalSources,
  removeApprovedSources,
} from "./local-sources.mjs";

export async function prepareArticleDeletion({ ids }, dependencies = {}) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50)
    throw new Error("Informe de 1 a 50 IDs identificados pela pesquisa.");
  const config = dependencies.config ?? settings();
  const api = dependencies.api ?? client(config);
  const deletions = [];
  for (const id of [...new Set(ids.map(publishedArticleId))]) {
    const [published, draft, plan] = await Promise.all([
      getRemote(api, id),
      getRemote(api, `drafts.${id}`),
      localSourcePlan([id], config),
    ]);
    deletions.push({
      id,
      expectedPublishedRevision: published?._rev ?? null,
      publishedExists: Boolean(published),
      draftExists: Boolean(draft),
      ...localSourceOffer(plan),
    });
  }
  const folders = deletions.flatMap((item) =>
    item.localSourceFolders.map((folder) => folder.folder),
  );
  return {
    deletions,
    requiresLocalFilesDecision: folders.length > 0,
    destination: destination(config),
    ...(folders.length
      ? {
          question: `Deseja remover também os arquivos de origem em ${folders.join(", ")} (Word, JSON e auxiliares)?`,
        }
      : {}),
    deletionStarted: false,
  };
}

export async function deleteRemoteArticle(
  { id, expectedPublishedRevision, confirmDelete, removeLocalFiles, expectedLocalFilesToken },
  dependencies = {},
) {
  if (confirmDelete !== true)
    throw new Error("É necessário um pedido explícito de exclusão da pessoa.");
  const publishedId = publishedArticleId(id);
  if (expectedPublishedRevision !== null && typeof expectedPublishedRevision !== "string")
    throw new Error(
      "Use a revisão publicada retornada pela pesquisa; null somente se não houver versão publicada.",
    );
  const config = dependencies.config ?? settings({ tokenRequired: true });
  const api = dependencies.api ?? client(config);
  if (removeLocalFiles !== undefined && typeof removeLocalFiles !== "boolean")
    throw new Error("removeLocalFiles deve refletir a resposta sim/não da pessoa.");
  const plan = await localSourcePlan([publishedId], config);
  if (plan.folders.length && removeLocalFiles === undefined)
    return { deleted: false, id: publishedId, deletionStarted: false, ...localSourceOffer(plan) };
  if (removeLocalFiles === true && plan.folders.length && expectedLocalFilesToken !== plan.token)
    throw new Error(
      "Confira as pastas e obtenha a resposta sobre remover os arquivos antes de excluir. O escopo mudou ou o token da conferência está ausente.",
    );
  const locks = await lockLocalSources(plan);
  try {
    if (
      removeLocalFiles === true &&
      (await localSourcePlan([publishedId], config)).token !== plan.token
    )
      throw new Error(
        "Os arquivos locais mudaram antes da operação; nenhuma exclusão foi iniciada.",
      );
    const folder = path.join(root, "operations", "deletions");
    await fs.mkdir(folder, { recursive: true });
    if (
      (await fs.realpath(folder)) !== path.join(await fs.realpath(root), "operations", "deletions")
    )
      throw new Error("Diretório de operações fora do app.");
    const receiptPath = path.join(folder, `${publishedId}.json`);
    const saveReceipt = (status, extra = {}) =>
      saveJson(receiptPath, {
        id: publishedId,
        status,
        destination: destination(config),
        removeLocalFiles: removeLocalFiles ?? null,
        updatedAt: new Date().toISOString(),
        ...extra,
      });
    let lastError;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const [published, draft] = await Promise.all([
        getRemote(api, publishedId),
        getRemote(api, `drafts.${publishedId}`),
      ]);
      if (!published && !draft) {
        let removedLocalFolders = [],
          localCleanupError;
        if (removeLocalFiles === true && plan.folders.length) {
          await locks.closeHandles();
          try {
            await (dependencies.removeSources ?? removeApprovedSources)(
              plan,
              [publishedId],
              config,
              (folder) => removedLocalFolders.push(folder),
            );
          } catch (error) {
            localCleanupError = error.message;
          }
        }
        let localRecordUpdated = false;
        for (const entry of await fs.readdir(docs, { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory()) continue;
          const local = await localArticle(`Docs/${entry.name}/article.json`).catch(() => null);
          if (local?.document._id !== publishedId) continue;
          try {
            assertDestination(local.state, config);
          } catch {
            continue;
          }
          await updateState(local, {
            status: "deleted",
            sanityPublished: false,
            pageChecked: false,
          });
          localRecordUpdated = true;
        }
        await saveReceipt("deleted", {
          removeLocalFiles: removeLocalFiles ?? false,
          removedLocalFolders,
          localCleanupPending: Boolean(localCleanupError),
          ...(localCleanupError ? { localCleanupError } : {}),
        });
        return {
          deleted: true,
          id: publishedId,
          publishedAbsent: true,
          draftAbsent: true,
          localFilesPreserved: removedLocalFolders.length === 0 && !localCleanupError,
          localFilesRemoved:
            plan.folders.length > 0 &&
            removedLocalFolders.length === plan.folders.length &&
            !localCleanupError,
          removedLocalFolders,
          localCleanupPending: Boolean(localCleanupError),
          ...(localCleanupError ? { localCleanupError } : {}),
          localRecordUpdated,
          receipt: path.relative(root, receiptPath),
          destination: destination(config),
        };
      }
      if (published && published._rev !== expectedPublishedRevision)
        throw new Error(
          "A revisão publicada mudou desde a pesquisa. Pesquise novamente o mesmo ID antes de retomar a exclusão já solicitada.",
        );
      if (attempt === 3)
        throw new Error(
          `Exclusão ainda não confirmada. Consulte novamente o mesmo ID antes de retomar. ${lastError?.message ?? "Documento ainda encontrado."}`,
        );
      await saveReceipt("deleting", {
        publishedRevision: published?._rev ?? null,
        draftRevision: draft?._rev ?? null,
      });
      let transaction = api.transaction();
      for (const document of [published, draft].filter(Boolean))
        transaction = transaction
          .patch(document._id, (patch) =>
            patch.ifRevisionId(document._rev).set({ title: document.title ?? "" }),
          )
          .delete(document._id);
      try {
        await transaction.commit({ visibility: "sync" });
      } catch (error) {
        lastError = error;
        await saveReceipt("uncertain", { reason: error.message });
      }
    }
  } finally {
    await locks.release();
  }
}
