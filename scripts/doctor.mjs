import fs from "node:fs/promises";
import path from "node:path";
import { root, settings, destination, client } from "../lib/workspace.mjs";
import { getEditorialProfile } from "../lib/editorial.mjs";
import { createStudioNavigation } from "../lib/studio-navigation.mjs";
try {
  const config = settings();
  const { allowedUrl } = createStudioNavigation(config);
  const editorialProfile = await getEditorialProfile();
  for (const filename of [
    "AGENTS.md",
    "schema/article.schema.json",
    "schema/source/index.ts",
    "scripts/validate-article.mjs",
    ".codex/config.toml",
  ])
    await fs.access(path.join(root, filename));
  console.log(
    JSON.stringify(
      {
        node: process.versions.node,
        ...destination(config),
        studioUrl: config.studioUrl,
        studioAliases: config.studioAliases,
        tokenConfigured: Boolean(config.token),
        defaultAuthor: editorialProfile.authors[editorialProfile.defaultAuthorId].name,
        chromeAutoConnect: config.chromeAutoConnect,
        allowUiPublication: config.allowUiPublication,
      },
      null,
      2,
    ),
  );
  if (!config.token) {
    console.error("PENDENTE: configure SANITY_API_TOKEN no .env. Não cole o token no chat.");
    process.exitCode = 1;
  }
  if (process.argv.includes("--remote")) {
    try {
      await client(config).fetch('count(*[_type == "article"])');
      console.log("Consulta de leitura ao dataset concluída. Nenhum documento foi alterado.");
    } catch (error) {
      console.error(`Sanity: ${error.message}`);
      process.exitCode = 1;
    }
    for (const url of [config.siteUrl, ...(config.allowUiPublication ? [config.studioUrl] : [])]) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        console.log(
          `HTTP ${response.status}: ${url}${response.url !== url ? ` → ${response.url}` : ""}`,
        );
        if (!response.ok) process.exitCode = 1;
        if (url === config.studioUrl && !allowedUrl(response.url)) {
          console.error(
            "O destino final do Studio está fora das rotas configuradas. Confira STUDIO_URL e STUDIO_ALIASES.",
          );
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(`HTTP: ${url}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
