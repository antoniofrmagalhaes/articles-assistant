import { pagesFrom } from "./studio-navigation.mjs";

// Runs in the page, reading only the rendered DOM. React's stream placeholders
// must disappear before a stable snapshot can count as a completed check.
export function renderedArticleScript({ timeoutMs = 10000, stableMs = 500, url } = {}) {
  return `async () => {
    const deadline = Date.now() + ${timeoutMs};
    let previous = null;
    let stableSince = Date.now();
    let snapshot;
    do {
      const expectedUrl = ${JSON.stringify(url ?? null)};
      if (expectedUrl && location.href !== expectedUrl)
        return { url: location.href, settled: false, heading: "", text: "" };
      const article = document.querySelector("article");
      const visible = !!article && (article.checkVisibility
        ? article.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : article.getClientRects().length > 0);
      const pendingStreaming = !!document.querySelector('template[id^="B:"],template[id^="P:"],[hidden][id^="S:"]');
      snapshot = {
        url: location.href,
        httpStatus: performance.getEntriesByType("navigation")[0]?.responseStatus || null,
        heading: visible ? article.querySelector("h1")?.innerText?.trim() || "" : "",
        text: visible ? article.innerText : "",
        pendingStreaming,
        settled: false
      };
      const signature = JSON.stringify([snapshot.url, snapshot.heading, snapshot.text, pendingStreaming]);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); }
      if (document.readyState === "complete" && !pendingStreaming && Date.now() - stableSince >= ${stableMs}) {
        snapshot.settled = true;
        return snapshot;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return snapshot;
  }`;
}

function toolJson(result) {
  if (result.structuredContent?.url) return result.structuredContent;
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    throw new Error("O navegador não retornou um snapshot válido do artigo.");
  }
}

export async function readRenderedPage(chrome, url) {
  const call = async (name, args) => {
    const result = await chrome.callTool({ name, arguments: args });
    if (result.isError)
      throw new Error((result.content ?? []).map((item) => item.text ?? "").join("\n"));
    return result;
  };
  const existing = new Set(pagesFrom(await call("list_pages", {})).map((page) => page.id));
  let pageId;
  try {
    const opened = await call("new_page", { url, background: true });
    const created = pagesFrom(opened).filter((page) => !existing.has(page.id));
    if (created.length !== 1)
      throw new Error("Não foi possível identificar a aba criada para a conferência.");
    pageId = created[0].id;
    if (created[0].url !== url)
      throw new Error("A página redirecionou para uma URL diferente da configurada.");
    return toolJson(
      await call("evaluate_script", {
        pageId,
        function: renderedArticleScript({ url }),
        waitForStableDom: false,
      }),
    );
  } finally {
    // Only close our own temporary tab; leave the client's tabs intact.
    if (pageId !== undefined) await call("close_page", { pageId }).catch(() => {});
  }
}
