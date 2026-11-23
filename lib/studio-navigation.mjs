function parsedUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function studioScope(value) {
  const url = parsedUrl(value);
  if (!url) throw new Error("URL do Studio inválida.");
  let pathname = url.pathname.replace(/\/$/, "");
  if (["sanity.io", "www.sanity.io"].includes(url.hostname)) {
    const hosted = pathname.match(/^\/@[^/]+\/studio\/[^/]+(?=\/|$)/);
    if (!hosted)
      throw new Error(
        "No domínio compartilhado da Sanity, configure a URL completa /@organização/studio/aplicação/workspace.",
      );
    pathname = hosted[0];
  }
  return { origin: url.origin, pathname };
}

export function createStudioNavigation(config) {
  const site = parsedUrl(config.siteUrl);
  if (!site) throw new Error("URL do site inválida.");
  const scopes =
    config.allowUiPublication === false
      ? []
      : [config.studioUrl, ...(config.studioAliases ?? [])].map(studioScope);
  const allowedUrl = (value) => {
    const url = parsedUrl(value);
    if (!url) return false;
    if (url.origin === site.origin) return true;
    return (
      config.allowUiPublication !== false &&
      scopes.some(
        (scope) =>
          url.origin === scope.origin &&
          (!scope.pathname ||
            url.pathname === scope.pathname ||
            url.pathname.startsWith(`${scope.pathname}/`)),
      )
    );
  };
  function assertCall(name, args, pages) {
    if (
      ["new_page", "navigate_page"].includes(name) &&
      args.url !== undefined &&
      !allowedUrl(args.url)
    )
      throw new Error("Navegue somente para o Studio da cliente ou site configurados.");
    if (name === "list_pages") return;
    if (name === "new_page") {
      if (!allowedUrl(args.url))
        throw new Error("Informe a URL configurada do Studio ou site ao abrir a aba.");
      return;
    }
    const target =
      args.pageId !== undefined
        ? pages.find((page) => page.id === args.pageId)
        : pages.find((page) => page.selected);
    if (!target || !allowedUrl(target.url))
      throw new Error(
        "Aba fora do Studio da cliente/site configurados. Use list_pages e indique o pageId correto.",
      );
  }
  return { allowedUrl, assertCall };
}

export function pagesFrom(result) {
  if (Array.isArray(result.structuredContent?.pages)) {
    return result.structuredContent.pages
      .filter((page) => Number.isInteger(page.id) && typeof page.url === "string")
      .map(({ id, url, selected }) => ({ id, url, selected: Boolean(selected) }));
  }
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return [...text.matchAll(/^(\d+):\s+(.+)$/gm)].flatMap((match) => {
    const label = match[2];
    const url =
      label.match(/\((https?:\/\/\S+)\)(?:\s|$)/)?.[1] ?? label.match(/^(https?:\/\/\S+)/)?.[1];
    return url ? [{ id: Number(match[1]), url, selected: /\[selected\](?:\s|$)/.test(label) }] : [];
  });
}
