import path from "node:path";
import { root, json, saveJson, hash, localArticle, locked } from "./workspace.mjs";

const missing = (value) =>
  value === undefined || value === null || (typeof value === "string" && !value.trim());
const normalizedName = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const matchesName = (author, name) =>
  [author.name, ...(author.aliases ?? [])].some(
    (value) => normalizedName(value) === normalizedName(name),
  );

export async function getEditorialProfile() {
  const profile = await json(path.join(root, "config/editorial-profile.json"));
  if (profile.version !== 1 || !profile.authors || !profile.authors[profile.defaultAuthorId]) {
    throw new Error("config/editorial-profile.json: versão ou autoria padrão inválida.");
  }
  for (const [id, author] of Object.entries(profile.authors)) {
    if (
      typeof author.name !== "string" ||
      !author.name.trim() ||
      typeof author.description !== "string" ||
      author.description.trim().length < 40 ||
      author.description.length > 1200 ||
      (author.aliases &&
        (!Array.isArray(author.aliases) ||
          author.aliases.some((alias) => typeof alias !== "string")))
    ) {
      throw new Error(
        `config/editorial-profile.json: authors.${id} deve ter nome e descrição de 40 a 1.200 caracteres.`,
      );
    }
  }
  return profile;
}

export function mergeEditorialDefaults(
  input,
  profile,
  { authorId, titleNote, noteSource = "publisher-derived" } = {},
) {
  const document = structuredClone(input);
  const applied = [];
  let usedAuthorId;
  if (
    document.author !== undefined &&
    document.author !== null &&
    (typeof document.author !== "object" || Array.isArray(document.author))
  )
    throw new Error("author: esperado um objeto; corrija-o antes de aplicar o perfil.");
  const author = document.author ?? {};
  const named = typeof author.name === "string" && author.name.trim();
  let selectedId = authorId;
  if (selectedId && !profile.authors[selectedId])
    throw new Error(`Perfil de autoria inexistente: ${selectedId}.`);
  if (!selectedId)
    selectedId = named
      ? Object.keys(profile.authors).find((id) => matchesName(profile.authors[id], author.name))
      : profile.defaultAuthorId;
  const selected = profile.authors[selectedId];
  if (named && selected && !matchesName(selected, author.name))
    throw new Error(
      "author.name: a autoria informada difere do perfil selecionado; não será substituída.",
    );
  if ((!named || missing(author.description)) && !selected)
    throw new Error(
      "author: autoria diferente do padrão e sem perfil completo. Cadastre os dados corretos; não use a biografia da autora padrão.",
    );
  if (missing(author.name) && selected) {
    author.name = selected.name;
    applied.push("author.name");
    usedAuthorId = selectedId;
  }
  if (missing(author.description) && selected) {
    author.description = selected.description;
    applied.push("author.description");
    usedAuthorId = selectedId;
  }
  if (applied.length) document.author = { _type: "articleAuthor", ...author };

  const existingNote = document.frontMatter?.titleNote;
  let titleNoteSource = missing(existingNote) ? "missing" : "existing";
  if (missing(existingNote) && !missing(titleNote)) {
    if (!["publisher-derived", "document", "user"].includes(noteSource))
      throw new Error("Origem da nota inválida.");
    if (
      typeof titleNote !== "string" ||
      titleNote.trim().length < Math.max(24, profile.titleNote?.minimumCharacters ?? 24)
    )
      throw new Error("frontMatter.titleNote: a nota deve ter pelo menos 24 caracteres.");
    if (
      document.frontMatter !== undefined &&
      document.frontMatter !== null &&
      (typeof document.frontMatter !== "object" || Array.isArray(document.frontMatter))
    )
      throw new Error("frontMatter: esperado um objeto.");
    document.frontMatter = {
      _type: "articleFrontMatter",
      ...document.frontMatter,
      titleNote: titleNote.trim(),
    };
    applied.push("frontMatter.titleNote");
    titleNoteSource = noteSource;
  }
  return {
    document,
    applied,
    authorProfileId: usedAuthorId ?? null,
    titleNoteSource,
    needsTitleNote: missing(document.frontMatter?.titleNote),
    guidance:
      "Quando faltar a nota, redija uma frase neutra baseada no conteúdo e aplique como publisher-derived. Preserve notas fornecidas. Não invente origem, evento ou publicação.",
  };
}

export async function saveEditorialAudit(local, result) {
  if (!result.applied.length) return;
  const filename = path.join(local.folder, "editorial-metadata.json");
  const previous = await json(filename).catch(() => ({}));
  await saveJson(filename, {
    ...previous,
    profileFile: "config/editorial-profile.json",
    ...(result.authorProfileId ? { authorProfileId: result.authorProfileId } : {}),
    ...(result.applied.includes("frontMatter.titleNote")
      ? { titleNoteSource: result.titleNoteSource }
      : {}),
    lastAppliedFields: result.applied,
    contentHash: hash(result.document),
    updatedAt: new Date().toISOString(),
  });
}

export async function applyEditorialDefaults({ articlePath, ...options }) {
  return locked(articlePath, async () => {
    const local = await localArticle(articlePath);
    const result = mergeEditorialDefaults(local.document, await getEditorialProfile(), options);
    if (result.applied.length) {
      await saveJson(local.filename, result.document);
      await saveEditorialAudit(local, result);
    }
    const { document, ...report } = result;
    return {
      ...report,
      contentHash: hash(document),
      next: "Renove a revisão da conversão e valide o mesmo article.json antes de publicar.",
    };
  });
}
