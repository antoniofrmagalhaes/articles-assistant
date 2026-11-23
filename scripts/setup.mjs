import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { root } from "../lib/workspace.mjs";

if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error("Instale Node.js 22.12 ou superior.");
await fs.mkdir(path.join(root, "Docs"), { recursive: true });
await fs.mkdir(path.join(root, ".codex"), { recursive: true });
if (!existsSync(path.join(root, ".env")))
  await fs.copyFile(path.join(root, ".env.example"), path.join(root, ".env"));
const quote = (value) => JSON.stringify(value);
const block = (name, entry) =>
  `[mcp_servers.${name}]\ncommand = ${quote(process.execPath)}\nargs = [${quote(path.join(root, entry))}]\ncwd = ${quote(root)}\nenabled = true\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\n`;
await fs.writeFile(
  path.join(root, ".codex/config.toml"),
  `# Gerado para esta cópia. Execute npm run setup novamente após mover a pasta.\n\n${block("articles_sanity", "mcp/sanity/server.mjs")}\n${block("articles_devtools", "mcp/devtools/server.mjs")}`,
  "utf8",
);
console.log("Configuração local dos dois MCPs criada. Nenhuma configuração global foi alterada.");
console.log(
  "Confira .env, execute npm run doctor e abra Codex nesta pasta. Após mudar a configuração, reinicie a sessão do Codex e confie no workspace quando solicitado.",
);
