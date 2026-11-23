import fs from "node:fs/promises";
import path from "node:path";
import { root } from "../lib/workspace.mjs";

const target = path.join(root, "artifacts", `articles-portable-${Date.now()}`);
await fs.mkdir(target, { recursive: true });
for (const name of [
  "package.json",
  "package-lock.json",
  "AGENTS.md",
  "README.md",
  ".env.example",
  ".gitignore",
  "lib",
  "config",
  "scripts",
  "mcp",
  "schema",
  "guides",
  "examples",
  "tests",
]) {
  await fs.cp(path.join(root, name), path.join(target, name), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
await fs.mkdir(path.join(target, "Docs"));
await fs.mkdir(path.join(target, ".codex"));
await fs.copyFile(
  path.join(root, ".codex/config.example.toml"),
  path.join(target, ".codex/config.example.toml"),
);
console.log(`Pasta portátil: ${target}`);
console.log(
  "Sem .env, node_modules ou documentos de cliente. No destino: npm ci, npm run setup, configure .env e npm run doctor.",
);
