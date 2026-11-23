import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { load } from "cheerio";
import { validateArticleObject } from "../scripts/validate-article.mjs";
import { getEditorialProfile, mergeEditorialDefaults, saveEditorialAudit } from "./editorial.mjs";
import { searchArticles, publishedArticleId } from "./research.mjs";
import { deleteRemoteArticle } from "./remote-delete.mjs";
import {
  docs,
  hash,
  json,
  saveJson,
  canonical,
  equalContent,
  contentDifferences,
  settings,
  client,
  destination,
  assertDestination,
  assertSlug,
  localArticle,
  locked,
  confirmOriginal,
  getRemote,
  updateState,
  publicationPolicy,
  assertUiPublicationAllowed,
} from "./workspace.mjs";

const articleUrl = (config, slug) => `${config.siteUrl}/artigos/${encodeURIComponent(slug)}`;
async function discardPreviousDrafts(local, config, api) {
  const draftId = `drafts.${local.document._id}`;
  const removed = new Set();
  let lastError;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const drafts = await api.fetch(
      '*[_type == "article" && _id in path("drafts.**") && (_id == $draft || slug.current == $slug)]',
      { draft: draftId, slug: local.slug },
      { tag: "articles.reset-drafts" },
    );
    if (!Array.isArray(drafts)) throw new Error("Falha ao consultar rascunhos do artigo.");
    if (!drafts.length) {
      if (local.state.draftReset?.status === "discarding")
        for (const id of local.state.draftReset.draftIds ?? []) removed.add(id);
      if (removed.size || local.state.draftReset?.status === "discarding")
        local.state = await updateState(local, {
          draftRevision: null,
          draftReset: {
            status: "completed",
            removedDraftIds: [...removed],
            completedAt: new Date().toISOString(),
          },
        });
      return { removedDraftIds: [...removed], restartRequired: removed.size > 0 };
    }
    if (attempt === 3)
      throw new Error(
        `Não foi possível confirmar o descarte dos rascunhos após retomar a consulta. ${lastError?.message ?? "O rascunho reapareceu."}`,
      );
    if (!config.token)
      throw new Error(
        "Configure a credencial de escrita no .env para descartar o rascunho e reiniciar a operação.",
      );
    for (const draft of drafts) {
      if (
        draft._type !== "article" ||
        !draft._id?.startsWith("drafts.") ||
        (draft._id !== draftId && draft.slug?.current !== local.slug)
      )
        throw new Error(
          "A consulta retornou um documento que não é rascunho deste artigo; nenhum descarte será executado.",
        );
      if (draft._id !== draftId && (await getRemote(api, draft._id.slice(7))))
        throw new Error(
          "O slug também pertence a outro documento publicado. Seu rascunho não será tratado como o mesmo artigo.",
        );
    }
    local.state = await updateState(local, {
      draftReset: {
        status: "discarding",
        draftIds: drafts.map((draft) => draft._id),
        startedAt: new Date().toISOString(),
      },
    });
    let transaction = api.transaction();
    for (const draft of drafts)
      transaction = transaction
        .patch(draft._id, (patch) =>
          patch.ifRevisionId(draft._rev).set({ title: draft.title ?? "" }),
        )
        .delete(draft._id);
    try {
      await transaction.commit({ visibility: "sync" });
      for (const draft of drafts) removed.add(draft._id);
    } catch (error) {
      lastError = error; // Re-read first: a timeout may have happened after the deletion.
    }
  }
}

export async function resetArticleDraft({ articlePath }, testDependencies = {}) {
  return locked(articlePath, async () => {
    const local = await requireValid(articlePath);
    const config = testDependencies.config ?? settings();
    assertDestination(local.state, config);
    const result = await discardPreviousDrafts(
      local,
      config,
      testDependencies.api ?? client(config),
    );
    return {
      ...result,
      id: local.document._id,
      contentHash: hash(local.document),
      message:
        "Rascunhos anteriores conferidos/descartados. Reinicie a operação a partir do mesmo JSON e ID, preservando o modo permitido pela flag. Nenhuma confirmação de exclusão de draft é necessária.",
    };
  });
}
export async function validateLocal(articlePath) {
  const local = await localArticle(articlePath);
  const result = await validateArticleObject(local.document);
  if (!local.document._id || !/^[a-zA-Z0-9_-]+$/.test(local.document._id)) {
    result.errors.push({
      field: "_id",
      message: "Use prepare_article para gerar ou preservar o ID publicado.",
    });
  }
  if (!local.document.cid)
    result.errors.push({
      field: "cid",
      message: "Use prepare_article para gerar ou preservar o CID.",
    });
  if (local.state.cid && local.document.cid !== local.state.cid)
    result.errors.push({ field: "cid", message: "CID existente foi alterado." });
  try {
    await confirmOriginal(local);
  } catch (error) {
    result.errors.push({ field: "$original", message: error.message });
  }
  if (local.state.origin !== "remote-import") {
    const review = await json(path.join(local.folder, "conversion-review.json")).catch(() => null);
    const original = await json(path.join(local.folder, "original-word.json")).catch(() => null);
    if (
      review?.status !== "reviewed" ||
      review.contentHash !== hash(local.document) ||
      review.originalSha256 !== original?.sha256 ||
      !Array.isArray(review.unresolvedIssues) ||
      review.unresolvedIssues.length
    ) {
      result.errors.push({
        field: "$conversion",
        message:
          "Compare Word e JSON e execute record_conversion_review para esta versão. Resolva as omissões antes de publicar.",
      });
    }
  }
  result.valid = result.errors.length === 0;
  return {
    ...result,
    contentHash: hash(local.document),
    articlePath,
    publicationPolicy: publicationPolicy(settings()),
  };
}
export async function recordReview({ articlePath, notes, unresolvedIssues }) {
  if (
    !Array.isArray(notes) ||
    notes.length === 0 ||
    notes.some((note) => typeof note !== "string" || !note.trim())
  )
    throw new Error("Registre a conferência e o tratamento das limitações da conversão.");
  if (!Array.isArray(unresolvedIssues))
    throw new Error("Informe a lista de pendências, vazia apenas quando resolvidas.");
  return locked(articlePath, async () => {
    const local = await localArticle(articlePath);
    await confirmOriginal(local);
    const manifest = await json(path.join(local.folder, "original-word.json"));
    await saveJson(path.join(local.folder, "conversion-review.json"), {
      status: unresolvedIssues.length ? "pending" : "reviewed",
      originalSha256: manifest.sha256,
      contentHash: hash(local.document),
      notes,
      unresolvedIssues,
      reviewedAt: new Date().toISOString(),
    });
    return { publicationBlocked: unresolvedIssues.length > 0, contentHash: hash(local.document) };
  });
}
async function requireValid(articlePath, expectedContentHash) {
  const local = await localArticle(articlePath);
  const result = await validateLocal(articlePath);
  if (!result.valid) throw new Error(`Publicação bloqueada: ${JSON.stringify(result.errors)}`);
  if (expectedContentHash && result.contentHash !== expectedContentHash)
    throw new Error("O JSON mudou depois da validação. Valide novamente.");
  return local;
}
export async function prepareArticle({ articlePath }) {
  return locked(articlePath, async () => {
    const local = await localArticle(articlePath);
    const editorial = mergeEditorialDefaults(local.document, await getEditorialProfile());
    local.document = editorial.document;
    local.document._id ??= `article-${randomUUID()}`;
    local.document.cid ??= `cidv1-${randomBytes(20).toString("hex")}`;
    if (local.document._id.startsWith("drafts."))
      throw new Error("O JSON deve usar o ID publicado, sem drafts.");
    await saveJson(local.filename, local.document);
    await saveEditorialAudit(local, editorial);
    await updateState(local, {
      id: local.document._id,
      cid: local.document.cid,
      status: local.state.status ?? "prepared",
    });
    const result = await validateLocal(articlePath);
    const config = settings();
    return {
      ...result,
      editorial: {
        applied: editorial.applied,
        needsTitleNote: editorial.needsTitleNote,
        guidance: editorial.guidance,
      },
      id: local.document._id,
      url: articleUrl(config, local.slug),
      publicationPolicy: publicationPolicy(config),
      ...(publicationPolicy(config).allowUiPublication
        ? {
            studioCreateUrl: `${config.studioUrl}/intent/create/type=article;id=${encodeURIComponent(local.document._id)}`,
            studioEditUrl: `${config.studioUrl}/intent/edit/id=${encodeURIComponent(local.document._id)};type=article`,
          }
        : {}),
    };
  });
}
export async function lookupArticle({ slug, id } = {}, dependencies = {}) {
  if (!slug && !id) return searchArticles({}, dependencies);
  const config = dependencies.config ?? settings();
  const api = dependencies.api ?? client(config);
  if (id) id = publishedArticleId(id);
  if (id)
    return {
      document: await getRemote(api, id),
      draft: await getRemote(api, `drafts.${id}`),
      destination: destination(config),
    };
  assertSlug(slug);
  const documents = await api.fetch('*[_type == "article" && slug.current == $slug]{...}', {
    slug,
  });
  return { documents, destination: destination(config) };
}
export async function importArticle({ slug }) {
  assertSlug(slug);
  const config = settings();
  const api = client(config);
  const documents = await api.fetch(
    '*[_type == "article" && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && slug.current == $slug]',
    { slug },
  );
  if (documents.length !== 1)
    throw new Error("Esperado exatamente um artigo publicado com esse slug.");
  const folder = path.join(docs, slug);
  await fs.mkdir(folder); // Fail on collision, never overwrite a local article.
  const document = canonical(documents[0]);
  await saveJson(path.join(folder, "article.json"), document);
  await saveJson(path.join(folder, "publication-state.json"), {
    origin: "remote-import",
    id: document._id,
    cid: document.cid,
    revision: documents[0]._rev,
    status: "published",
    sanityPublished: true,
    pageChecked: false,
    destination: destination(config),
    confirmedHash: hash(document),
    updatedAt: new Date().toISOString(),
  });
  return {
    articlePath: `Docs/${slug}/article.json`,
    id: document._id,
    url: articleUrl(config, slug),
    pageChecked: false,
  };
}
export async function chooseMode({ articlePath, mode }, testDependencies = {}) {
  if (!["direct", "panel"].includes(mode)) throw new Error("Escolha direct ou panel.");
  if (mode === "panel") assertUiPublicationAllowed(testDependencies.config ?? settings());
  return locked(articlePath, async () => {
    const local = await requireValid(articlePath);
    const config = testDependencies.config ?? settings();
    assertDestination(local.state, config);
    const api = testDependencies.api ?? client(config);
    const remote = await getRemote(api, local.document._id);
    if (remote && local.state.revision && local.state.revision !== remote._rev) {
      throw new Error("Artigo foi alterado remotamente. Compare com o JSON antes de continuar.");
    }
    if (remote && !local.state.revision && !equalContent(remote, local.document))
      throw new Error("O ID já existe com outro conteúdo. Importe ou reconcilie o documento.");
    const draftReset = mode === "panel" ? await discardPreviousDrafts(local, config, api) : null;
    await updateState(local, {
      mode,
      chosenHash: hash(local.document),
      destination: destination(config),
      ...(remote ? { revision: remote._rev } : {}),
    });
    return {
      mode,
      contentHash: hash(local.document),
      destination: destination(config),
      draftReset,
    };
  });
}
async function verifyRemote(local, config, api) {
  const remote = await getRemote(api, local.document._id);
  if (!remote || !equalContent(remote, local.document)) {
    await updateState(local, { status: "uncertain", sanityPublished: false, pageChecked: false });
    return {
      sanityPublished: false,
      pageChecked: false,
      differences: remote
        ? contentDifferences(canonical(local.document), canonical(remote))
        : ["$missing"],
      url: articleUrl(config, local.slug),
    };
  }
  await updateState(local, {
    status: "published",
    sanityPublished: true,
    pageChecked: false,
    revision: remote._rev,
    confirmedHash: hash(local.document),
    destination: destination(config),
    id: remote._id,
    cid: remote.cid,
  });
  return {
    sanityPublished: true,
    pageChecked: false,
    id: remote._id,
    revision: remote._rev,
    url: articleUrl(config, local.slug),
  };
}
export async function verifyPublication({ articlePath }) {
  return locked(articlePath, async () => {
    const local = await requireValid(articlePath);
    const config = settings();
    assertDestination(local.state, config);
    return verifyRemote(local, config, client(config));
  });
}
export async function publishArticle({ articlePath, expectedContentHash }, testDependencies = {}) {
  if (!expectedContentHash) throw new Error("Informe o hash retornado pela validação.");
  return locked(articlePath, async () => {
    const local = await requireValid(articlePath, expectedContentHash);
    const config = testDependencies.config ?? settings({ tokenRequired: true });
    assertDestination(local.state, config);
    if (!publicationPolicy(config).allowUiPublication) {
      local.state = await updateState(local, {
        mode: "direct",
        chosenHash: expectedContentHash,
        modeSource: "ALLOW_UI_PUBLICATION=false",
      });
    } else if (local.state.mode !== "direct" || local.state.chosenHash !== expectedContentHash)
      throw new Error(
        "Aguarde a escolha da cliente e registre o modo direto para este JSON validado.",
      );
    if (local.state.status === "deleted")
      throw new Error("Artigo excluído. Republicação exige preparação explícita.");
    const api = testDependencies.api ?? client(config);
    await discardPreviousDrafts(local, config, api);
    const remoteValidation = await validateArticleObject(local.document, {
      getClient: () => api,
      getDocumentExists: async ({ id }) => Boolean(await api.getDocument(id)),
    });
    if (!remoteValidation.valid)
      throw new Error(
        `Validação remota bloqueou a publicação: ${JSON.stringify(remoteValidation.errors)}`,
      );
    let [remote, draft, collisions] = await Promise.all([
      getRemote(api, local.document._id),
      getRemote(api, `drafts.${local.document._id}`),
      api.fetch('*[_type == "article" && slug.current == $slug && !(_id in [$id, $draft])]{_id}', {
        slug: local.slug,
        id: local.document._id,
        draft: `drafts.${local.document._id}`,
      }),
    ]);
    // If a stale draft appeared during preparation, discard it and restart the read.
    if (draft) {
      await discardPreviousDrafts(local, config, api);
      [remote, draft, collisions] = await Promise.all([
        getRemote(api, local.document._id),
        getRemote(api, `drafts.${local.document._id}`),
        api.fetch(
          '*[_type == "article" && slug.current == $slug && !(_id in [$id, $draft])]{_id}',
          { slug: local.slug, id: local.document._id, draft: `drafts.${local.document._id}` },
        ),
      ]);
    }
    if (collisions.length)
      throw new Error("Slug já usado por outro documento. Publicação bloqueada.");
    if (draft)
      throw new Error(
        "Um novo rascunho reapareceu durante a operação. Reinicie a publicação; o descarte é automático e não requer confirmação.",
      );
    if (remote && equalContent(remote, local.document) && !draft)
      return verifyRemote(local, config, api);
    if (remote && (!local.state.revision || remote._rev !== local.state.revision))
      throw new Error("Conflito de revisão. A versão remota mudou; compare antes de sobrescrever.");
    if (!remote && local.state.revision)
      throw new Error("O documento remoto foi removido. Não será recriado implicitamente.");
    await updateState(local, {
      status: "publishing",
      attemptHash: expectedContentHash,
      destination: destination(config),
      sanityPublished: false,
      pageChecked: false,
    });
    try {
      let transaction = api.transaction();
      if (remote) {
        const fields = { ...canonical(local.document) };
        delete fields._id;
        delete fields._type;
        const unset = Object.keys(remote).filter((key) => !key.startsWith("_") && !(key in fields));
        transaction = transaction.patch(local.document._id, (patch) =>
          patch.ifRevisionId(local.state.revision).set(fields).unset(unset),
        );
      } else transaction = transaction.create(canonical(local.document));
      await transaction.commit({ visibility: "sync" });
      return await verifyRemote(await localArticle(articlePath), config, api);
    } catch (error) {
      await updateState(await localArticle(articlePath), {
        status: "uncertain",
        sanityPublished: false,
        pageChecked: false,
      });
      throw new Error(
        `Gravação não confirmada. Use verify_publication antes de repetir. ${error.message}`,
      );
    }
  });
}
export async function adoptPanelIdentity({ articlePath, draftId }, testDependencies = {}) {
  assertUiPublicationAllowed(testDependencies.config ?? settings());
  return locked(articlePath, async () => {
    const local = await localArticle(articlePath);
    if (local.state.mode !== "panel")
      throw new Error("Reconciliação do painel exige modo panel escolhido.");
    if (typeof draftId !== "string" || !draftId.startsWith("drafts."))
      throw new Error("Informe o ID do rascunho do painel.");
    const config = testDependencies.config ?? settings();
    assertDestination(local.state, config);
    const api = testDependencies.api ?? client(config);
    const draft = await getRemote(api, draftId);
    if (!draft || draft.slug?.current !== local.slug)
      throw new Error("O rascunho não corresponde ao slug local.");
    if (
      local.state.revision &&
      (draftId !== `drafts.${local.document._id}` || draft.cid !== local.document.cid)
    )
      throw new Error("Uma edição deve preservar o mesmo ID e CID.");
    const published = await getRemote(api, draftId.slice(7));
    if (published && published._rev !== local.state.revision)
      throw new Error("A versão publicada mudou. Reconcilie antes de continuar pelo painel.");
    const adopted = canonical({ ...draft, _id: draftId.slice(7) });
    const semantic = (value, top = true) => {
      if (Array.isArray(value)) return value.map((item) => semantic(item, false));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(canonical(value))
            .filter(([key]) => key !== "_key" && !(top && ["_id", "cid"].includes(key)))
            .map(([key, child]) => [key, semantic(child, false)]),
        );
      return value;
    };
    const differences = contentDifferences(semantic(local.document), semantic(adopted));
    if (differences.length)
      throw new Error(
        `Preencha o painel conforme o JSON antes de adotar a identidade: ${differences.join(", ")}`,
      );
    const validation = await validateArticleObject(adopted);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    await saveJson(local.filename, adopted);
    await updateState(local, {
      id: adopted._id,
      cid: adopted.cid,
      chosenHash: hash(adopted),
      draftRevision: draft._rev,
    });
    return {
      id: adopted._id,
      contentHash: hash(adopted),
      message:
        "Conteúdo conferido; ID/CID e chaves geradas pelo painel reconciliados no mesmo JSON. Renove a revisão da conversão, valide e execute check_panel_ready antes de Publish.",
    };
  });
}
export async function checkPanelReady({ articlePath, expectedContentHash }, testDependencies = {}) {
  assertUiPublicationAllowed(testDependencies.config ?? settings());
  const local = await requireValid(articlePath, expectedContentHash);
  if (
    !expectedContentHash ||
    local.state.mode !== "panel" ||
    local.state.chosenHash !== expectedContentHash
  )
    throw new Error("Modo panel e hash validado são obrigatórios.");
  const config = testDependencies.config ?? settings();
  assertDestination(local.state, config);
  const api = testDependencies.api ?? client(config);
  const remoteValidation = await validateArticleObject(local.document, {
    getClient: () => api,
    getDocumentExists: async ({ id }) => Boolean(await api.getDocument(id)),
  });
  if (!remoteValidation.valid)
    throw new Error(
      `Validação remota bloqueou o painel: ${JSON.stringify(remoteValidation.errors)}`,
    );
  const [published, draft] = await Promise.all([
    getRemote(api, local.document._id),
    getRemote(api, `drafts.${local.document._id}`),
  ]);
  if (published && published._rev !== local.state.revision)
    throw new Error("Versão publicada foi alterada externamente.");
  if (!published && local.state.revision)
    throw new Error("A versão publicada foi removida externamente.");
  if (!draft || !equalContent({ ...draft, _id: local.document._id }, local.document))
    throw new Error("Rascunho e JSON diferem. Reconcile pelo painel antes de Publish.");
  const collisions = await api.fetch(
    '*[_type == "article" && slug.current == $slug && !(_id in [$id, $draft])]{_id}',
    { slug: local.slug, id: local.document._id, draft: draft._id },
  );
  if (collisions.length) throw new Error("Slug duplicado em outro documento.");
  return {
    panelReady: true,
    contentHash: expectedContentHash,
    draftRevision: draft._rev,
    warning:
      "Confirmação somente de leitura. A interface não fornece a mesma garantia atômica de revisão do modo direto.",
  };
}
export async function deleteArticle({
  articlePath,
  expectedContentHash,
  confirmDelete,
  removeLocalFiles,
  expectedLocalFilesToken,
}) {
  if (confirmDelete !== true) throw new Error("Exclusão depende de pedido explícito da cliente.");
  const local = await localArticle(articlePath);
  if (!expectedContentHash || hash(local.document) !== expectedContentHash)
    throw new Error("Confirme a versão local antes de excluir.");
  const config = settings({ tokenRequired: true });
  assertDestination(local.state, config);
  return deleteRemoteArticle({
    id: local.document._id,
    expectedPublishedRevision: local.state.revision ?? null,
    confirmDelete: true,
    removeLocalFiles,
    expectedLocalFilesToken,
  });
}
export function expectedVisibleText(document) {
  const rich = (blocks) =>
    (blocks ?? []).map((block) => (block.children ?? []).map((span) => span.text).join(""));
  return [
    document.title,
    document.author?.name,
    document.author?.description,
    ...(document.coAuthors ?? []).flatMap((author) => [author.name, author.description]),
    ...(document.sections ?? []).flatMap((section) => [
      section.title,
      ...(section.content ?? []).flatMap((block) => {
        if (block._type === "articleRichTextBlock") return rich(block.content);
        if (block._type === "articleCalloutBlock") return rich(block.body);
        if (block._type === "articlePullQuoteBlock") return [block.quote, block.attribution];
        if (block._type === "articleLegalExcerptBlock") return [block.excerpt, block.citation];
        return [];
      }),
    ]),
    ...(document.footnotes ?? []).flatMap((note) => rich(note.content)),
    ...(document.references ?? []).map((reference) => reference.text),
  ].filter((text) => typeof text === "string" && text.trim());
}
export const normalizeVisible = (text) =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export async function checkPage({ articlePath }, testDependencies = {}) {
  return locked(articlePath, async () => {
    const local = await requireValid(articlePath);
    const config = testDependencies.config ?? settings();
    assertDestination(local.state, config);
    if (!local.state.sanityPublished || local.state.confirmedHash !== hash(local.document))
      throw new Error("Confirme primeiro o documento publicado com verify_publication.");
    const url = articleUrl(config, local.slug);
    let result;
    try {
      const response = await (testDependencies.fetch ?? fetch)(url, {
        signal: AbortSignal.timeout(20000),
        redirect: "error",
        headers: { "Cache-Control": "no-cache" },
      });
      const $ = load(await response.text());
      const streamingDetected =
        $('template[id^="B:"],template[id^="P:"],[hidden][id^="S:"]').length > 0;
      $("script,style,noscript,template").remove();
      $("[hidden]").remove();
      const visible = normalizeVisible($("article").text());
      const missing = expectedVisibleText(local.document).filter(
        (text) => !visible.includes(normalizeVisible(text)),
      );
      result = {
        sanityPublished: true,
        pageChecked: response.ok && $("article h1").length > 0 && missing.length === 0,
        httpStatus: response.status,
        missing,
        url,
        method: "http-static",
        streamingDetected,
      };
      if (streamingDetected && response.ok) {
        result.pageChecked = false;
        result.missing = [];
        result.reasonCode = "streaming_requires_browser";
        result.reason =
          "HTML em streaming: confira o DOM renderizado com articles_devtools.check_public_page_rendered. Os blocos temporários não comprovam ausência de conteúdo.";
        result.nextTool = "articles_devtools.check_public_page_rendered";
      }
      if (testDependencies.renderPage && response.ok) {
        result.method = "rendered-dom";
        const rendered = await testDependencies.renderPage(url);
        result.renderedUrl = rendered.url;
        result.renderedHttpStatus = rendered.httpStatus ?? null;
        result.pageChecked = false;
        result.missing = [];
        delete result.nextTool;
        if (rendered.url !== url) {
          result.reasonCode = "unexpected_url";
          result.reason =
            "O navegador exibiu uma URL diferente do endereço configurado; conferência pendente.";
        } else if (!rendered.settled || rendered.pendingStreaming) {
          result.reasonCode = "render_pending";
          result.reason = "O artigo ainda não terminou de renderizar; conferência pendente.";
        } else if (
          rendered.httpStatus &&
          (rendered.httpStatus < 200 || rendered.httpStatus >= 300)
        ) {
          result.reasonCode = "browser_http_error";
          result.reason = `O navegador recebeu HTTP ${rendered.httpStatus}; conferência pendente.`;
        } else {
          const text = normalizeVisible(rendered.text ?? "");
          result.missing = expectedVisibleText(local.document).filter(
            (value) => !text.includes(normalizeVisible(value)),
          );
          result.pageChecked = Boolean(rendered.heading?.trim()) && result.missing.length === 0;
          delete result.reason;
          delete result.reasonCode;
        }
      }
      if (!result.pageChecked && !result.reason) {
        result.reasonCode = !response.ok ? "http_error" : "content_mismatch";
        result.reason = !response.ok
          ? `HTTP ${response.status} no endereço configurado.`
          : result.method === "rendered-dom"
            ? "O artigo renderizado ou seu conteúdo não corresponde ao JSON confirmado."
            : "O HTML não corresponde ao JSON confirmado; confirme a divergência no DOM renderizado.";
        if (response.ok && result.method === "http-static")
          result.nextTool = "articles_devtools.check_public_page_rendered";
      }
    } catch (error) {
      result = {
        ...result,
        sanityPublished: true,
        pageChecked: false,
        missing: [],
        method: result?.method ?? "http-static",
        reasonCode: result?.method === "rendered-dom" ? "browser_unavailable" : "http_unavailable",
        reason: error.message,
        url,
      };
    }
    result.status = result.pageChecked ? "checked" : "pending";
    result.checkedAt = new Date().toISOString();
    result.contentHash = hash(local.document);
    await updateState(local, { pageChecked: result.pageChecked, pageCheck: result });
    return result;
  });
}
