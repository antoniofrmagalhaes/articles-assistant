import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, docs, json, hash, assertDestination } from "./workspace.mjs";
import { publishedArticleId } from "./research.mjs";

const digest = async (filename) =>
  createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");

export async function localSourcePlan(ids, config) {
  const wanted = new Set(ids.map(publishedArticleId));
  const realRoot = await fs.realpath(root);
  const realDocs = await fs.realpath(docs).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!realDocs) return { folders: [], token: hash([]) };
  if (realDocs !== path.join(realRoot, "Docs"))
    throw new Error("Docs aponta para fora da pasta do app.");
  const folders = [];
  for (const entry of await fs.readdir(realDocs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(realDocs, entry.name);
    if ((await fs.realpath(folder)) !== folder)
      throw new Error("Pasta de artigo redirecionada para outro local.");
    const document = await json(path.join(folder, "article.json")).catch(() => null);
    const state = await json(path.join(folder, "publication-state.json")).catch(() => ({}));
    const identities = [document?._id, state.id].filter(Boolean).map((id) => {
      try {
        return publishedArticleId(id);
      } catch {
        return null;
      }
    });
    if (
      !identities.length ||
      identities.some((id) => !id || id !== identities[0]) ||
      !wanted.has(identities[0])
    )
      continue;
    try {
      assertDestination(state, config);
    } catch {
      continue;
    }
    const files = [],
      directories = [];
    async function inspect(directory) {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, item.name);
        if (filename === path.join(folder, ".operation.lock")) continue;
        if (item.isSymbolicLink())
          throw new Error(
            "A pasta contém links. Nenhum arquivo local será removido automaticamente.",
          );
        if (item.isDirectory()) {
          directories.push(filename);
          await inspect(filename);
        } else if (item.isFile())
          files.push({
            path: filename,
            relativePath: path.relative(root, filename),
            sha256: await digest(filename),
          });
        else throw new Error("Tipo de arquivo local não suportado para remoção.");
      }
    }
    await inspect(folder);
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    folders.push({
      id: identities[0],
      path: folder,
      relativePath: path.relative(root, folder),
      files,
      directories,
    });
  }
  folders.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    folders,
    token: hash({
      projectId: config.projectId,
      dataset: config.dataset,
      folders: folders.map((folder) => ({
        id: folder.id,
        path: folder.relativePath,
        files: folder.files.map(({ relativePath, sha256 }) => ({ path: relativePath, sha256 })),
      })),
    }),
  };
}

export function localSourceOffer(plan) {
  return {
    localSourceFolders: plan.folders.map((folder) => ({
      id: folder.id,
      folder: folder.relativePath,
      files: folder.files.map((file) => file.relativePath),
    })),
    requiresLocalFilesDecision: plan.folders.length > 0,
    localFilesToken: plan.token,
    ...(plan.folders.length
      ? {
          question: `Deseja remover também os arquivos de origem em ${plan.folders.map((folder) => folder.relativePath).join(", ")} (Word, JSON e auxiliares)?`,
        }
      : {}),
  };
}

export async function lockLocalSources(plan) {
  const locks = [];
  try {
    for (const folder of plan.folders) {
      const filename = path.join(folder.path, ".operation.lock");
      const handle = await fs.open(filename, "wx");
      locks.push({ filename, handle });
    }
  } catch (error) {
    for (const lock of locks) {
      await lock.handle.close();
      await fs.unlink(lock.filename);
    }
    throw new Error(
      `Arquivos locais em uso; nenhuma exclusão foi iniciada. ${error.code ?? error.message}`,
    );
  }
  return {
    async closeHandles() {
      for (const lock of locks) {
        if (lock.handle) {
          await lock.handle.close();
          lock.handle = null;
        }
      }
    },
    async release() {
      for (const lock of locks) {
        if (lock.handle) await lock.handle.close();
        await fs.unlink(lock.filename).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

export async function removeApprovedSources(plan, ids, config, onFolderRemoved = () => {}) {
  const current = await localSourcePlan(ids, config);
  if (current.token !== plan.token)
    throw new Error(
      "Os arquivos locais mudaram após a autorização; eles foram preservados para nova conferência.",
    );
  const realDocs = await fs.realpath(docs);
  const removed = [];
  for (const folder of plan.folders) {
    // Resolve and check every target before removing anything. No recursive rm or link traversal.
    if (path.dirname(await fs.realpath(folder.path)) !== realDocs)
      throw new Error("Destino de remoção fora de Docs.");
    const metadata = new Set(["article.json", "publication-state.json"]);
    const files = [...folder.files].sort(
      (a, b) =>
        Number(metadata.has(path.basename(a.path))) - Number(metadata.has(path.basename(b.path))),
    );
    for (const file of files) {
      const realFile = await fs.realpath(file.path);
      const relative = path.relative(folder.path, realFile);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        (await fs.lstat(file.path)).isSymbolicLink() ||
        (await digest(realFile)) !== file.sha256
      )
        throw new Error("Arquivo local mudou ou saiu da pasta autorizada. Remoção interrompida.");
      await fs.unlink(realFile);
    }
    for (const directory of [...folder.directories].sort((a, b) => b.length - a.length)) {
      if (
        (await fs.realpath(directory)) !== directory ||
        !directory.startsWith(`${folder.path}${path.sep}`)
      )
        throw new Error("Subpasta fora do destino autorizado.");
      await fs.rmdir(directory);
    }
    await fs.unlink(path.join(folder.path, ".operation.lock")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await fs.rmdir(folder.path);
    removed.push(folder.relativePath);
    onFolderRemoved(folder.relativePath);
  }
  return removed;
}
