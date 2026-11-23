import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListRootsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { root, settings } from "../../lib/workspace.mjs";
import { createStudioNavigation, pagesFrom } from "../../lib/studio-navigation.mjs";
import { checkPage } from "../../lib/articles.mjs";
import { readRenderedPage } from "../../lib/rendered-page.mjs";

const renderedCheckTool = {
  name: "check_public_page_rendered",
  description:
    "Confere e registra o texto visível do artigo no navegador após concluir streaming/renderização. Use após check_public_page pendente ou para confirmar o DOM. Lê SITE_URL atual do .env, inclusive localhost, sem aceitar URL/texto fornecido pelo agente. Não publica nem altera o artigo. Chrome indisponível mantém conferência pendente.",
  inputSchema: {
    type: "object",
    properties: { articlePath: { type: "string", minLength: 1 } },
    required: ["articlePath"],
    additionalProperties: false,
  },
};

export const allowedTools = new Set([
  "list_pages",
  "new_page",
  "select_page",
  "navigate_page",
  "close_page",
  "take_snapshot",
  "take_screenshot",
  "click",
  "fill",
  "fill_form",
  "type_text",
  "press_key",
  "wait_for",
  "handle_dialog",
  "evaluate_script",
  "upload_file",
  "hover",
  "drag",
]);
const config = settings();
const manifestPath = path.join(root, "node_modules/chrome-devtools-mcp/package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const executable = path.resolve(path.dirname(manifestPath), manifest.bin["chrome-devtools-mcp"]);
const chrome = new Client(
  { name: "articles-devtools-bridge", version: "1.0.0" },
  { capabilities: { roots: {} } },
);
chrome.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: pathToFileURL(root).href, name: "articles" }],
}));
await chrome.connect(
  new StdioClientTransport({
    command: process.execPath,
    cwd: root,
    stderr: "inherit",
    args: [
      executable,
      ...(config.chromeAutoConnect ? ["--autoConnect"] : []),
      "--no-usage-statistics",
      "--no-performance-crux",
      "--categoryPerformance=false",
      "--categoryEmulation=false",
      "--categoryNetwork=false",
      "--categoryMemory=false",
      "--categoryExtensions=false",
      "--filesystemRoot",
      root,
    ],
  }),
);

const server = new Server(
  { name: "articles-devtools", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Respeite o .env a cada chamada. ALLOW_UI_PUBLICATION=false desativa cadastro pela UI e a pergunta de modo: publique diretamente pelas tools Sanity; use o navegador apenas para conferir SITE_URL. true permite o modo panel escolhido. No painel desconectado, peça login e aguarde pronto. Não altere flags/destinos. Use SITE_URL, inclusive localhost, sem substituição ou confirmação. Não opere abas alheias.",
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await chrome.listTools();
  return {
    tools: [...result.tools.filter((tool) => allowedTools.has(tool.name)), renderedCheckTool],
  };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    if (params.name === renderedCheckTool.name) {
      const result = await checkPage(params.arguments ?? {}, {
        renderPage: (url) => readRenderedPage(chrome, url),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (!allowedTools.has(params.name)) throw new Error("Ferramenta fora do fluxo de artigos.");
    const { allowedUrl, assertCall } = createStudioNavigation(settings());
    const args = params.arguments ?? {};
    const pages = pagesFrom(await chrome.callTool({ name: "list_pages", arguments: {} }));
    assertCall(params.name, args, pages);
    if (params.name === "list_pages")
      return {
        content: [
          {
            type: "text",
            text:
              pages
                .filter((page) => allowedUrl(page.url))
                .map((page) => `${page.id}: ${page.url}${page.selected ? " [selected]" : ""}`)
                .join("\n") || "Nenhuma aba do Studio/site. Abra a URL configurada com new_page.",
          },
        ],
      };
    return await chrome.callTool(params);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
process.once("SIGTERM", () => void chrome.close());
process.once("SIGINT", () => void chrome.close());
