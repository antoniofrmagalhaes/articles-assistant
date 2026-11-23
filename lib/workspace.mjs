import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@sanity/client";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const docs = path.join(root, "Docs");
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(canonical(value)))
    .digest("hex");
export const json = async (filename) =>
  JSON.parse((await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, ""));
export async function saveJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, filename);
}
export function canonical(value, top = true) {
  if (Array.isArray(value)) return value.map((item) => canonical(item, false));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => !(top && ["_rev", "_createdAt", "_updatedAt"].includes(key)))
        .map((key) => [key, canonical(value[key], false)]),
    );
  return value;
}
export const equalContent = (a, b) => isDeepStrictEqual(canonical(a), canonical(b));
export function contentDifferences(a, b, prefix = "") {
  if (isDeepStrictEqual(a, b)) return [];
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return [prefix || "$"];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
    contentDifferences(
      a[key],
      b[key],
      Array.isArray(a) ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : key,
    ),
  );
}
export function settings({ tokenRequired = false } = {}) {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath))
    throw new Error("O .env do app está ausente. Execute setup e configure esse arquivo.");
  return settingsFromEnv(readFileSync(envPath, "utf8"), { tokenRequired });
}
export function settingsFromEnv(text, { tokenRequired = false } = {}) {
  const local = parseEnv(text);
  const get = (key) => (local[key] ?? "").trim();
  const allowUi = get("ALLOW_UI_PUBLICATION") || "true";
  if (!["true", "false"].includes(allowUi))
    throw new Error("ALLOW_UI_PUBLICATION deve ser true ou false.");
  const config = {
    allowUiPublication: allowUi === "true",
    projectId: get("SANITY_PROJECT_ID"),
    dataset: get("SANITY_DATASET"),
    apiVersion: get("SANITY_API_VERSION") || "2025-03-01",
    token: get("SANITY_API_TOKEN"),
    siteUrl: get("SITE_URL").replace(/\/$/, ""),
    studioUrl: get("STUDIO_URL").replace(/\/$/, ""),
    studioAliases: get("STUDIO_ALIASES")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    chromeAutoConnect: get("CHROME_AUTO_CONNECT") !== "false",
  };
  const missing = [
    !config.projectId && "SANITY_PROJECT_ID",
    !config.dataset && "SANITY_DATASET",
    !config.siteUrl && "SITE_URL",
    config.allowUiPublication && !config.studioUrl && "STUDIO_URL",
    tokenRequired && !config.token && "SANITY_API_TOKEN",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Configure o .env local: ${missing.join(", ")}.`);
  for (const value of [config.siteUrl, config.studioUrl, ...config.studioAliases].filter(Boolean)) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("URL inválida na configuração.");
  }
  return config;
}
export function publicationPolicy(config) {
  const allowUiPublication = config.allowUiPublication !== false;
  return {
    allowUiPublication,
    askPublicationMode: allowUiPublication,
    availableModes: allowUiPublication ? ["direct", "panel"] : ["direct"],
    automaticMode: allowUiPublication ? null : "direct",
  };
}
export function assertUiPublicationAllowed(config) {
  if (!publicationPolicy(config).allowUiPublication)
    throw new Error(
      "Cadastro pela UI desativado por ALLOW_UI_PUBLICATION=false. Publique diretamente após validar, sem perguntar o modo.",
    );
}
export const destination = (config) => ({
  projectId: config.projectId,
  dataset: config.dataset,
  siteUrl: config.siteUrl,
});
export function client(config) {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: false,
    perspective: "raw",
    timeout: 20000,
  });
}
export function assertDestination(state, config) {
  // SITE_URL is the viewing endpoint, not the identity of the Sanity destination.
  if (
    state.destination &&
    (state.destination.projectId !== config.projectId ||
      state.destination.dataset !== config.dataset)
  ) {
    throw new Error(
      "O projeto/dataset do Sanity difere do registrado para este documento. Reconcilie sua identidade antes de gravar nesse destino.",
    );
  }
}
export function assertSlug(slug) {
  if (typeof slug !== "string" || slug.length > 96 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Slug inválido.");
}
export async function articleFiles(articlePath) {
  if (typeof articlePath !== "string") throw new Error("Informe Docs/<slug>/article.json.");
  const filename = path.resolve(root, articlePath);
  const relative = path.relative(docs, filename);
  const parts = relative.split(path.sep);
  if (parts.length !== 2 || parts[1] !== "article.json")
    throw new Error("Use somente Docs/<slug>/article.json.");
  assertSlug(parts[0]);
  const [realDocs, realFile] = await Promise.all([fs.realpath(docs), fs.realpath(filename)]);
  if (path.relative(realDocs, realFile).split(path.sep).join("/") !== `${parts[0]}/article.json`)
    throw new Error("Links e caminhos fora de Docs não são permitidos.");
  const folder = path.dirname(realFile);
  const statePath = path.join(folder, "publication-state.json");
  // Auxiliary files must not escape through symlinks either.
  for (const candidate of [statePath, path.join(folder, "original-word.json")]) {
    if (existsSync(candidate) && path.dirname(await fs.realpath(candidate)) !== folder)
      throw new Error("Arquivo auxiliar fora da pasta do artigo.");
  }
  return { filename: realFile, folder, statePath, slug: parts[0] };
}
export async function localArticle(articlePath) {
  const files = await articleFiles(articlePath);
  const document = await json(files.filename);
  if (document.slug?.current !== files.slug)
    throw new Error("slug.current deve corresponder à pasta em Docs.");
  const state = existsSync(files.statePath) ? await json(files.statePath) : {};
  if (state.id && state.id !== document._id)
    throw new Error("O _id foi alterado. Preserve a identidade do documento existente.");
  return { ...files, document, state };
}
export async function locked(articlePath, operation) {
  const files = await articleFiles(articlePath);
  const lockPath = path.join(files.folder, ".operation.lock");
  const lock = await fs.open(lockPath, "wx").catch(() => {
    throw new Error(
      "Artigo em operação. Se houve interrupção, confira o estado remoto antes de remover .operation.lock.",
    );
  });
  try {
    return await operation();
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
export async function confirmOriginal(local) {
  if (local.state.origin === "remote-import") return;
  const manifest = await json(path.join(local.folder, "original-word.json")).catch(() => {
    throw new Error("Importe e preserve o Word original antes de publicar.");
  });
  if (path.basename(manifest.filename) !== manifest.filename)
    throw new Error("Manifesto do Word inválido.");
  const filename = path.join(local.folder, manifest.filename);
  if (path.dirname(await fs.realpath(filename)) !== local.folder)
    throw new Error("Word original fora da pasta do artigo.");
  const digest = createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
  if (digest !== manifest.sha256)
    throw new Error("O Word original foi alterado. Preserve o original sem edições.");
}
export async function getRemote(api, id) {
  const document = await api.getDocument(id);
  if (document && document._type !== "article")
    throw new Error("Identidade remota pertence a outro tipo de documento.");
  return document;
}
export async function updateState(local, patch) {
  const next = { ...local.state, ...patch, updatedAt: new Date().toISOString() };
  await saveJson(local.statePath, next);
  return next;
}
