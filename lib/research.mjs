import { settings, client, destination } from "./workspace.mjs";

export function publishedArticleId(id) {
  if (typeof id !== "string") throw new Error("Informe o ID do artigo retornado pela pesquisa.");
  const normalized = id.startsWith("drafts.") ? id.slice(7) : id;
  if (
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/.test(normalized) ||
    normalized.startsWith("versions.") ||
    normalized.startsWith("drafts.")
  )
    throw new Error("ID de artigo inválido.");
  return normalized;
}

export async function searchArticles(
  { query = "", state = "all", page = 1, pageSize = 20 } = {},
  dependencies = {},
) {
  if (typeof query !== "string" || !["all", "published", "draft"].includes(state))
    throw new Error("Use texto de pesquisa e state all, published ou draft.");
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50 ||
    !Number.isSafeInteger(page * pageSize)
  )
    throw new Error("Use page >= 1 e pageSize de 1 a 50.");
  const config = dependencies.config ?? settings();
  const api = dependencies.api ?? client(config);
  let text = query.trim();
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    text = decodeURIComponent(url.pathname.replace(/\/$/, "").split("/").pop() ?? "");
  }
  const terms = text
    .toLowerCase()
    .replace(/[*?\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const pattern = terms.length ? `*${terms.join("*")}*` : "";
  const slugPattern = pattern.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filter = `_type == "article" && !(_id in path("versions.**")) &&
    ($state == "all" || ($state == "draft" && _id in path("drafts.**")) || ($state == "published" && !(_id in path("drafts.**")))) &&
    ($pattern == "" || lower(title) match $pattern || lower(slug.current) match $slugPattern || lower(_id) match $slugPattern)`;
  const logicalIds = `array::unique((*[${filter}] | order(coalesce(title, _id) asc, _id asc) {"id": select(_id in path("drafts.**") => string::split(_id, "drafts.")[1], _id)})[].id)`;
  const index = await api.fetch(
    `{"ids": ${logicalIds}[${(page - 1) * pageSize}...${page * pageSize}], "totalArticles": count(${logicalIds}), "totalMatchingRecords": count(*[${filter}])}`,
    { state, pattern, slugPattern },
    { tag: "articles.search-index" },
  );
  if (
    !index ||
    !Array.isArray(index.ids) ||
    !Number.isInteger(index.totalArticles) ||
    !Number.isInteger(index.totalMatchingRecords)
  )
    throw new Error("Resposta inválida na pesquisa de artigos.");
  const ids = index.ids.map(publishedArticleId);
  const versions = ids.length
    ? await api.fetch(
        '*[_type == "article" && _id in $ids]{_id,_rev,title,"slug":slug.current,_updatedAt}',
        { ids: ids.flatMap((id) => [id, `drafts.${id}`]) },
        { tag: "articles.search-versions" },
      )
    : [];
  if (!Array.isArray(versions)) throw new Error("Resposta inválida na consulta de versões.");
  const summary = (record) =>
    record
      ? {
          id: record._id,
          revision: record._rev,
          title: record.title ?? "",
          slug: record.slug ?? null,
          updatedAt: record._updatedAt,
        }
      : null;
  const articles = ids.map((id) => {
    const published = versions.find((record) => record._id === id);
    const draft = versions.find((record) => record._id === `drafts.${id}`);
    return {
      id,
      title: published?.title || draft?.title || "(sem título)",
      slug: published?.slug || draft?.slug || null,
      published: summary(published),
      draft: summary(draft),
      recordCount: Number(Boolean(published)) + Number(Boolean(draft)),
    };
  });
  return {
    articles,
    totalArticles: index.totalArticles,
    totalMatchingRecords: index.totalMatchingRecords,
    singleArticleId: index.totalArticles === 1 ? (articles[0]?.id ?? null) : null,
    page,
    pageSize,
    hasMore: page * pageSize < index.totalArticles,
    destination: destination(config),
    note: "Publicado e drafts.<mesmo ID> são versões do mesmo artigo, não dois artigos. Esta consulta é somente de leitura e não depende de Docs nem Chrome.",
  };
}
