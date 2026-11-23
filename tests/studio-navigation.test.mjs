import test from "node:test";
import assert from "node:assert/strict";
import { createStudioNavigation, pagesFrom } from "../lib/studio-navigation.mjs";

const config = {
  siteUrl: "https://www.example.com",
  studioUrl: "https://www.sanity.io/@example-org/studio/example-studio/default",
  studioAliases: ["https://example.sanity.studio"],
};
const { allowedUrl, assertCall } = createStudioNavigation(config);
test("canonical hosted Studio, document routes, intents and alias are accessible", () => {
  for (const url of [
    config.studioUrl,
    `${config.studioUrl}/structure/article;article-123`,
    `${config.studioUrl}/intent/edit/id=article-123;type=article`,
    config.studioUrl.replace("/default", ""),
    config.studioAliases[0],
    `${config.studioAliases[0]}/intent/create/type=article`,
    `${config.siteUrl}/artigos/teste`,
  ])
    assert.equal(allowedUrl(url), true, url);
});
test("another organization, Studio or shared-host page is not treated as this Studio", () => {
  for (const url of [
    "https://www.sanity.io/",
    "https://www.sanity.io/manage",
    "https://www.sanity.io/@other/studio/example-studio/default",
    "https://www.sanity.io/@example-org/studio/another-app/default",
    "https://www.sanity.io/@example-org/studio/example-studio-other/default",
    "https://www.sanity.io.evil.example/@example-org/studio/example-studio",
    "javascript:alert(1)",
    "https://someone@www.sanity.io/@example-org/studio/example-studio",
  ])
    assert.equal(allowedUrl(url), false, url);
  assert.throws(
    () => createStudioNavigation({ ...config, studioUrl: "https://www.sanity.io" }),
    /URL completa/,
  );
});
test("both titled and legacy plain page listings retain the real URL", () => {
  const pages = pagesFrom({
    content: [
      {
        type: "text",
        text: `## Pages\n4: Artigo da cliente (${config.studioUrl}/structure/article;article-123) [selected]\n5: ${config.siteUrl}/artigos\n6: Outra aba (https://elsewhere.example/)`,
      },
    ],
  });
  assert.deepEqual(pages, [
    { id: 4, url: `${config.studioUrl}/structure/article;article-123`, selected: true },
    { id: 5, url: `${config.siteUrl}/artigos`, selected: false },
    { id: 6, url: "https://elsewhere.example/", selected: false },
  ]);
});
test("structured page results are preferred over human-readable titles", () => {
  assert.deepEqual(
    pagesFrom({
      structuredContent: {
        pages: [{ id: 4, title: "Artigo", url: config.studioUrl, selected: true }],
      },
    }),
    [{ id: 4, url: config.studioUrl, selected: true }],
  );
});
test("explicit pageId works even when an unrelated tab is selected", () => {
  const pages = [
    { id: 1, url: "https://elsewhere.example/", selected: true },
    { id: 4, url: config.studioUrl, selected: false },
  ];
  for (const name of ["take_snapshot", "click", "select_page", "close_page", "evaluate_script"])
    assert.doesNotThrow(() => assertCall(name, { pageId: 4 }, pages));
  assert.doesNotThrow(() =>
    assertCall(
      "navigate_page",
      { pageId: 4, url: `${config.studioUrl}/intent/edit/id=article-123` },
      pages,
    ),
  );
  assert.throws(() => assertCall("take_snapshot", {}, pages), /pageId/);
  assert.throws(() => assertCall("take_snapshot", { pageId: 1 }, pages), /pageId/);
  assert.throws(
    () => assertCall("new_page", { url: "https://elsewhere.example/" }, pages),
    /somente/,
  );
});
