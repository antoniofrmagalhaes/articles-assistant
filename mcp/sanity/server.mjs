import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { importWord, listWordFiles } from "../../lib/word.mjs";
import {
  settings,
  destination,
  publicationPolicy,
  assertUiPublicationAllowed,
} from "../../lib/workspace.mjs";
import { getEditorialProfile, applyEditorialDefaults } from "../../lib/editorial.mjs";
import { searchArticles } from "../../lib/research.mjs";
import { deleteRemoteArticle, prepareArticleDeletion } from "../../lib/remote-delete.mjs";
import {
  prepareArticle,
  validateLocal,
  recordReview,
  chooseMode,
  lookupArticle,
  importArticle,
  publishArticle,
  adoptPanelIdentity,
  checkPanelReady,
  verifyPublication,
  checkPage,
  deleteArticle,
  resetArticleDraft,
} from "../../lib/articles.mjs";

const string = { type: "string", minLength: 1 };
const articlePath = {
  ...string,
  description: "Caminho canônico Docs/<slug>/article.json, relativo a esta pasta portátil.",
};
const spec = (name, description, properties, required, execute) => ({
  name,
  description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  execute,
});
const tools = [
  spec(
    "prepare_article_deletion",
    "ANTES de excluir, consulta versões e arquivos correspondentes em Docs para os IDs escolhidos. Se houver arquivos, devolve a pergunta de removê-los também; aguarde sim/não ANTES de qualquer exclusão. Não altera nada. Uma pergunta pode cobrir vários artigos.",
    { ids: { type: "array", minItems: 1, maxItems: 50, items: string } },
    ["ids"],
    prepareArticleDeletion,
  ),
  spec(
    "list_word_files",
    "Antes de importar, lista os Words na raiz do app e em Docs, com sourcePath absoluto válido nesta máquina. Evita adivinhar caminhos ou repetir import_word inválido. Somente leitura. Arquivo registrado informa articlePath para retomar sem importar de novo.",
    { includeRegistered: { type: "boolean" } },
    [],
    listWordFiles,
  ),
  spec(
    "search_articles",
    "PRIMEIRA tool para localizar/listar artigos. Sem argumentos lista o acervo do Sanity no destino do .env, mesmo com Docs vazio. Pesquisa título, slug, ID ou link; agrupa publicado e draft do mesmo ID em UM artigo. Retorna IDs, revisões e contagens reais. Somente leitura; não use Chrome.",
    {
      query: { type: "string" },
      state: { enum: ["all", "published", "draft"] },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 50 },
    },
    [],
    searchArticles,
  ),
  spec(
    "delete_remote_article",
    "Após pedido explícito e identificação, exclui publicado/draft e confirma ausência. Se houver arquivos em Docs, exige PRIMEIRO a resposta sobre removê-los também. Omitir removeLocalFiles retorna a pergunta sem excluir nada. Sim: removeLocalFiles=true + token do preparo; exclui Sanity primeiro e só então os arquivos aprovados. Não: false preserva os arquivos. Falha no Sanity preserva os arquivos. Sem Docs não faz a pergunta.",
    {
      id: string,
      expectedPublishedRevision: { type: ["string", "null"] },
      confirmDelete: { const: true },
      removeLocalFiles: {
        type: "boolean",
        description:
          "Somente a resposta da pessoa à pergunta sobre os arquivos, feita antes de excluir. Não presuma false ou true.",
      },
      expectedLocalFilesToken: string,
    },
    ["id", "expectedPublishedRevision", "confirmDelete"],
    deleteRemoteArticle,
  ),
  spec(
    "reset_article_draft",
    "Ao iniciar ou retomar a publicação, descarta rascunhos anteriores do mesmo artigo e reinicia a operação a partir do JSON/ID preservados, sem perguntar sobre excluir draft. Não exclui o documento publicado. No painel, execute antes de preencher, nunca sobre o novo draft da tentativa atual.",
    { articlePath },
    ["articlePath"],
    resetArticleDraft,
  ),
  spec(
    "get_editorial_profile",
    "Leia antes de perguntar autoria: dados compartilhados dos autores e autorização para derivar uma nota de título neutra do artigo quando ausente.",
    {},
    [],
    getEditorialProfile,
  ),
  spec(
    "apply_editorial_defaults",
    "Preenche somente campos ausentes da autoria com o perfil compartilhado e aplica uma nota redigida pelo publicador a partir do artigo. Preserva valores fornecidos e o mesmo JSON; não publica.",
    {
      articlePath,
      authorId: string,
      titleNote: string,
      noteSource: { enum: ["publisher-derived", "document", "user"] },
    },
    ["articlePath"],
    applyEditorialDefaults,
  ),
  spec(
    "workspace_status",
    "Lê os destinos atuais exclusivamente do .env do app. Use estes valores nas chamadas: SITE_URL pode ser localhost ou outro host e independe do projeto/dataset Sanity. Não proponha substituição. Não expõe token nem publica.",
    {},
    [],
    async () => {
      const config = settings();
      return {
        ...destination(config),
        studioUrl: config.studioUrl,
        studioAliases: config.studioAliases,
        tokenConfigured: Boolean(config.token),
        publicationPolicy: publicationPolicy(config),
      };
    },
  ),
  spec(
    "import_word",
    "Registra o Word .docx íntegro em Docs/<slug> e extrai texto/HTML. Se a origem está na raiz do app, confere cópia/SHA-256/extração e remove a entrada da raiz; informa rootSourceRemoved. Preserva origens externas. Retomadas conferem o registro existente sem sobrescrever o artigo. Não publica.",
    {
      sourcePath: {
        ...string,
        description:
          "Use o sourcePath de list_word_files. Aceita caminho absoluto, ou relativo à raiz do app (nunca ao cwd do terminal). Word externo exige caminho absoluto fornecido pela pessoa.",
      },
      slug: string,
    },
    ["sourcePath", "slug"],
    importWord,
  ),
  spec(
    "prepare_article",
    "Gera ID/CID e aplica autoria compartilhada somente aos campos ausentes. Se faltar nota de título, redija-a a partir do artigo conforme get_editorial_profile e aplique com apply_editorial_defaults. Preserva dados existentes.",
    { articlePath },
    ["articlePath"],
    prepareArticle,
  ),
  spec(
    "record_conversion_review",
    "Registra a comparação Word/JSON para o hash atual. Pendências impedem publicar.",
    {
      articlePath,
      notes: { type: "array", minItems: 1, items: string },
      unresolvedIssues: { type: "array", items: string },
    },
    ["articlePath", "notes", "unresolvedIssues"],
    recordReview,
  ),
  spec(
    "validate_article",
    "Obrigatório antes de publicar: valida schema local atual, estrutura, identidade, original e revisão da conversão. Retorna erros por campo e hash.",
    { articlePath },
    ["articlePath"],
    ({ articlePath }) => validateLocal(articlePath),
  ),
  spec(
    "set_publication_mode",
    "Se ALLOW_UI_PUBLICATION=true, registra a escolha da cliente. Se false, não pergunte: o modo direto é automático e panel é bloqueado.",
    { articlePath, mode: { enum: ["direct", "panel"] } },
    ["articlePath", "mode"],
    chooseMode,
  ),
  spec(
    "lookup_article",
    "Consulta publicado/draft por ID ou slug. Sem argumentos, lista artigos como search_articles; não exige que a pessoa informe slug nem que Docs contenha arquivos. Somente leitura, sem navegador.",
    { id: string, slug: string },
    [],
    lookupArticle,
  ),
  spec(
    "import_existing_article",
    "Importa um único artigo publicado para o JSON canônico, sem exigir Word inexistente. Falha se a pasta já existir.",
    { slug: string },
    ["slug"],
    importArticle,
  ),
  spec(
    "publish_article",
    "Cria ou corrige o MESMO documento diretamente. Para um NOVO pedido explícito da pessoa para publicar/publicar novamente, use newPublicationRequest=true: permite recriar documento ausente mantendo ID, mesmo após exclusão, sem perguntar outra vez. Omita ou use false em retomadas automáticas; não reutilize autorização antiga. Preserva validações, destino, slug e conflito de revisão. Descarta drafts anteriores automaticamente.",
    {
      articlePath,
      expectedContentHash: string,
      newPublicationRequest: {
        type: "boolean",
        description:
          "Indica um novo pedido explícito de publicação da pessoa. Não exige outra confirmação; não usar por mera repetição/retomada de uma tentativa antiga.",
      },
    },
    ["articlePath", "expectedContentHash"],
    publishArticle,
  ),
  spec(
    "adopt_panel_identity",
    "Primeiro cadastro pelo painel: adota ID/CID do rascunho apenas se todo o conteúdo corresponder ao JSON. Não grava no Sanity.",
    { articlePath, draftId: string },
    ["articlePath", "draftId"],
    adoptPanelIdentity,
  ),
  spec(
    "check_panel_ready",
    "Imediatamente antes de clicar Publish: valida JSON/hash, revisão publicada, rascunho idêntico e colisões de slug. Novo pedido explícito de publicação usa newPublicationRequest=true e permite recriar o mesmo ID ausente, sem nova pergunta. Retomada automática não autoriza isso. Somente leitura.",
    { articlePath, expectedContentHash: string, newPublicationRequest: { type: "boolean" } },
    ["articlePath", "expectedContentHash"],
    checkPanelReady,
  ),
  spec(
    "verify_publication",
    "Compara documento publicado e JSON, confirma ID e revisão. Se houver divergência, não afirma publicação correta.",
    { articlePath },
    ["articlePath"],
    verifyPublication,
  ),
  spec(
    "check_public_page",
    "Confere HTML exclusivamente no SITE_URL atual do .env, inclusive localhost. Se detectar streaming React/Next, retorna pendente sem declarar trechos ausentes: prossiga com articles_devtools.check_public_page_rendered para comparar o texto visível e registrar o resultado. Não troque o host nem republique para contornar a conferência. HTTP 200 sozinho não comprova conteúdo.",
    { articlePath },
    ["articlePath"],
    checkPage,
  ),
  spec(
    "delete_article",
    "Exclui o artigo local conhecido. Se houver arquivos correspondentes, exige antes a resposta sobre removê-los também. Depois exclui Sanity e, somente se sim, os arquivos de Docs. Usa os mesmos controles de delete_remote_article.",
    {
      articlePath,
      expectedContentHash: string,
      confirmDelete: { const: true },
      removeLocalFiles: { type: "boolean" },
      expectedLocalFilesToken: string,
    },
    ["articlePath", "expectedContentHash", "confirmDelete"],
    deleteArticle,
  ),
];
const server = new Server(
  { name: "articles-sanity", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Para excluir: search_articles, depois prepare_article_deletion. Publicado/draft do mesmo ID são UM artigo. Se houver arquivos em Docs, pergunte se quer removê-los também e aguarde sim/não ANTES de excluir. Depois: Sanity primeiro, arquivos físicos só após confirmar ausência e somente se sim. Sem arquivos não faça essa pergunta. Use MCP, não Chrome/setup. Respeite .env e SITE_URL. ALLOW_UI_PUBLICATION=false publica direto sem escolha de UI; essa flag não dispensa a pergunta sobre remover fontes locais.",
  },
);
const panelTools = new Set(["adopt_panel_identity", "check_panel_ready"]);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools
    .filter(
      (tool) => publicationPolicy(settings()).allowUiPublication || !panelTools.has(tool.name),
    )
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const tool = tools.find((item) => item.name === params.name);
    if (!tool) throw new Error("Ferramenta não permitida.");
    if (panelTools.has(tool.name)) assertUiPublicationAllowed(settings());
    const result = await tool.execute(params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      ...(result?.valid === false ? { isError: true } : {}),
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
