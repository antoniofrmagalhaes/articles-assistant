import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { load } from "cheerio";
import { root, docs, assertSlug, json, saveJson } from "./workspace.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function resolveWordSourcePath(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath.trim())
    throw new Error("Informe sourcePath. Use list_word_files para obter o caminho exato do Word.");
  const supplied = sourcePath.trim();
  if (process.platform !== "win32" && path.win32.isAbsolute(supplied))
    throw new Error(
      "Esse caminho Windows não pertence ao sistema da tool. Use o sourcePath retornado por list_word_files nesta sessão.",
    );
  const resolved = path.resolve(root, supplied);
  const relative = path.relative(root, resolved);
  if (!path.isAbsolute(supplied) && (relative === ".." || relative.startsWith(`..${path.sep}`)))
    throw new Error(
      "Caminho relativo deve ficar dentro do app. Para Word externo fornecido pela pessoa, use seu caminho absoluto.",
    );
  return resolved;
}

export async function listWordFiles({ includeRegistered = true } = {}) {
  if (typeof includeRegistered !== "boolean")
    throw new Error("includeRegistered deve ser booleano.");
  const files = [];
  async function inspect(folder, registeredSlug = null) {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || ![".docx", ".doc"].includes(path.extname(entry.name).toLowerCase()))
        continue;
      const sourcePath = path.join(folder, entry.name);
      const info = await fs.stat(sourcePath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info?.isFile()) continue;
      files.push({
        name: entry.name,
        sourcePath,
        relativePath: path.relative(root, sourcePath),
        size: info.size,
        supported: path.extname(entry.name).toLowerCase() === ".docx",
        location: registeredSlug ? "registered" : "app-root",
        ...(registeredSlug
          ? {
              registeredSlug,
              articlePath: existsSync(path.join(folder, "article.json"))
                ? `Docs/${registeredSlug}/article.json`
                : null,
            }
          : {}),
      });
    }
  }
  await inspect(root);
  if (includeRegistered && existsSync(docs)) {
    if ((await fs.realpath(docs)) !== path.join(await fs.realpath(root), "Docs"))
      throw new Error("Docs aponta para fora da pasta do app.");
    for (const entry of await fs.readdir(docs, { withFileTypes: true }))
      if (entry.isDirectory()) await inspect(path.join(docs, entry.name), entry.name);
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    files,
    appRoot: root,
    count: files.length,
    guidance:
      "Use sourcePath exatamente como retornado. Arquivos já registrados podem ser retomados pelo articlePath; não adivinhe caminhos nem repita chamadas inválidas.",
  };
}

async function registeredWord(slug) {
  const [realRoot, realDocs] = await Promise.all([fs.realpath(root), fs.realpath(docs)]);
  const folder = await fs.realpath(path.join(docs, slug));
  if (realDocs !== path.join(realRoot, "Docs") || folder !== path.join(realDocs, slug))
    throw new Error("Destino do Word fora da pasta Docs do app.");
  const manifest = await json(path.join(folder, "original-word.json"));
  if (
    typeof manifest.filename !== "string" ||
    path.basename(manifest.filename) !== manifest.filename
  )
    throw new Error("Nome do Word inválido no registro.");
  const filename = path.join(folder, manifest.filename);
  if (
    (await fs.lstat(filename)).isSymbolicLink() ||
    (await fs.realpath(filename)) !== filename ||
    digest(await fs.readFile(filename)) !== manifest.sha256
  )
    throw new Error(
      "O Word registrado não confere com o SHA-256 do original. A origem será preservada.",
    );
  return { folder, manifest, filename, realRoot };
}

async function extractionComplete(registration) {
  const extraction = await json(path.join(registration.folder, "extraction.json")).catch(
    () => null,
  );
  if (extraction?.originalSha256 !== registration.manifest.sha256) return false;
  try {
    await Promise.all(
      ["extracted.html", "extracted.txt", "conversion-review.json"].map((name) =>
        fs.access(path.join(registration.folder, name)),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

async function finalizeRegistration(sourcePath, registration) {
  if (!(await extractionComplete(registration)))
    throw new Error(
      "Registro e extração precisam estar completos antes de remover o Word da raiz.",
    );
  const source = await fs.realpath(sourcePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const sourceWasAtRoot = path.dirname(path.resolve(sourcePath)) === path.resolve(root);
  if (!source) {
    if (!sourceWasAtRoot || path.basename(sourcePath) !== registration.manifest.filename)
      throw new Error("Origem ausente sem registro correspondente.");
    return { rootSourceRemoved: true, originalPreserved: true };
  }
  const sourceInfo = await fs.lstat(sourcePath);
  if (path.dirname(source) !== registration.realRoot || sourceInfo.isSymbolicLink())
    return { rootSourceRemoved: false, originalPreserved: true };
  if (!sourceInfo.isFile() || digest(await fs.readFile(source)) !== registration.manifest.sha256)
    throw new Error("O arquivo da raiz mudou ou difere do Word registrado. Ele não será removido.");
  // Only this exact root file is removed, after its intact backup and extraction exist.
  await fs.unlink(source);
  return { rootSourceRemoved: true, originalPreserved: true };
}

export async function importWord({ sourcePath, slug }) {
  assertSlug(slug);
  sourcePath = resolveWordSourcePath(sourcePath);
  if (path.extname(sourcePath).toLowerCase() !== ".docx")
    throw new Error(
      "Este conversor aceita .docx. Para .doc legado, obtenha uma cópia .docx sem modificar o original.",
    );
  const original = await fs.readFile(sourcePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!original) {
    const registration = await registeredWord(slug).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!registration)
      throw new Error(
        `Word não encontrado em ${sourcePath}. Consulte list_word_files e use o caminho retornado; não repita o mesmo argumento inválido.`,
      );
    if (!(await extractionComplete(registration)))
      throw new Error(
        "Registro incompleto: mantenha ou restaure a origem antes de retomar a importação.",
      );
    return {
      articlePath: `Docs/${slug}/article.json`,
      alreadyImported: true,
      ...(await finalizeRegistration(sourcePath, registration)),
    };
  }
  const sha256 = digest(original);
  const folder = path.join(docs, slug);
  const filename = path.basename(sourcePath);
  await fs.mkdir(docs, { recursive: true });
  if (existsSync(folder)) {
    const manifest = await json(path.join(folder, "original-word.json")).catch(() => null);
    if (manifest?.sha256 !== sha256)
      throw new Error("Pasta já existe com outra origem. Não será sobrescrita.");
    const registration = await registeredWord(slug);
    if (await extractionComplete(registration))
      return {
        articlePath: `Docs/${slug}/article.json`,
        alreadyImported: true,
        ...(await finalizeRegistration(sourcePath, registration)),
      };
  } else {
    const realDocs = await fs.realpath(docs);
    if (realDocs !== path.join(await fs.realpath(root), "Docs"))
      throw new Error("Destino fora da pasta Docs do app.");
    await fs.mkdir(folder);
    await fs.copyFile(sourcePath, path.join(folder, filename), fs.constants.COPYFILE_EXCL);
    await saveJson(path.join(folder, "original-word.json"), {
      filename,
      sha256,
      importedAt: new Date().toISOString(),
    });
  }
  const imageWarnings = [];
  const converted = await mammoth.convertToHtml(
    { buffer: original },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        imageWarnings.push(
          `Imagem embutida (${image.contentType}) exige revisão e representação explícita antes de publicar.`,
        );
        return { src: "about:blank", alt: "Imagem original requer tratamento" };
      }),
    },
  );
  const $ = load(converted.value);
  const blocks = $("p,h1,h2,h3,h4,h5,h6,li,table")
    .toArray()
    .map((element, index) => ({
      index,
      tag: element.tagName,
      text: $(element).text(),
      html: $.html(element),
    }));
  const warnings = [...converted.messages.map((message) => message.message), ...imageWarnings];
  await fs.writeFile(path.join(folder, "extracted.html"), converted.value, "utf8");
  await fs.writeFile(path.join(folder, "extracted.txt"), $("body").text(), "utf8");
  await saveJson(path.join(folder, "extraction.json"), {
    blocks,
    warnings,
    originalSha256: sha256,
  });
  if (!existsSync(path.join(folder, "conversion-review.json")))
    await saveJson(path.join(folder, "conversion-review.json"), {
      status: "pending",
      originalSha256: sha256,
      unresolvedIssues: warnings.length
        ? warnings
        : ["Comparar o Word e o JSON antes da publicação."],
    });
  return {
    articlePath: `Docs/${slug}/article.json`,
    ...(await finalizeRegistration(sourcePath, await registeredWord(slug))),
    originalSha256: sha256,
    extraction: `Docs/${slug}/extraction.json`,
    warnings,
    next: "Leia extracted.html e extraction.json, crie o article.json fiel ao Word e revise a conversão.",
  };
}
