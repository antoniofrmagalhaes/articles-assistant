import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderedArticleScript, readRenderedPage } from "../lib/rendered-page.mjs";

test("unfinished streaming stays pending on timeout", async () => {
  const snapshot = await vm.runInNewContext(`(${renderedArticleScript({ timeoutMs: 0 })})()`, {
    document: {
      readyState: "complete",
      querySelector: (selector) => (selector === "article" ? null : {}),
    },
    location: { href: "http://localhost:3000/artigos/test" },
    performance: { getEntriesByType: () => [] },
    setTimeout: (callback) => callback(),
  });
  assert.equal(snapshot.settled, false);
  assert.equal(snapshot.pendingStreaming, true);
});

test("a client redirect is rejected before reading another page's DOM", async () => {
  const snapshot = await vm.runInNewContext(
    `(${renderedArticleScript({ url: "http://localhost:3000/artigos/test" })})()`,
    {
      location: { href: "https://other.test/" },
      document: {
        querySelector: () => {
          throw new Error("Must not inspect a redirected page");
        },
      },
    },
  );
  assert.equal(snapshot.settled, false);
  assert.equal(snapshot.text, "");
  assert.equal(snapshot.url, "https://other.test/");
});

test("DOM reader waits for React placeholders to disappear and reads innerText only", async () => {
  let ticks = 0;
  const article = {
    checkVisibility: () => true,
    querySelector: () => ({ innerText: "Título" }),
    get innerText() {
      return ticks >= 2 ? "Título\nParágrafo renderizado" : "Título";
    },
    textContent: "Conteúdo oculto que não deve ser conferido",
  };
  const snapshot = await vm.runInNewContext(
    `(${renderedArticleScript({ timeoutMs: 100, stableMs: 0 })})()`,
    {
      document: {
        readyState: "complete",
        querySelector: (selector) => (selector === "article" ? article : ticks < 2 ? {} : null),
      },
      location: { href: "http://localhost:3000/artigos/test" },
      performance: { getEntriesByType: () => [{ responseStatus: 200 }] },
      setTimeout: (callback) => {
        ticks++;
        callback();
      },
    },
  );
  assert.ok(ticks >= 2);
  assert.equal(snapshot.settled, true);
  assert.equal(snapshot.pendingStreaming, false);
  assert.equal(snapshot.text, "Título\nParágrafo renderizado");
});

test("hidden article text cannot count as visible", async () => {
  const snapshot = await vm.runInNewContext(`(${renderedArticleScript({ stableMs: 0 })})()`, {
    document: {
      readyState: "complete",
      querySelector: (selector) =>
        selector === "article" ? { checkVisibility: () => false, innerText: "Oculto" } : null,
    },
    location: { href: "http://localhost:3000/artigos/test" },
    performance: { getEntriesByType: () => [] },
  });
  assert.equal(snapshot.text, "");
  assert.equal(snapshot.heading, "");
});

const pages = (values) => ({
  content: [{ type: "text", text: values.map(([id, url]) => `${id}: ${url}`).join("\n") }],
});
test("browser bridge uses the exact URL, a dedicated tab, and closes only that tab", async () => {
  const url = "http://localhost:3000/artigos/test";
  const calls = [];
  const chrome = {
    callTool: async (call) => {
      calls.push(call);
      if (call.name === "list_pages") return pages([[1, "https://other.test/"]]);
      if (call.name === "new_page")
        return pages([
          [1, "https://other.test/"],
          [2, url],
        ]);
      if (call.name === "evaluate_script")
        return {
          content: [
            { type: "text", text: 'Script ran:\n```json\n{"settled":true,"text":"Visible"}\n```' },
          ],
        };
      return { content: [] };
    },
  };
  const result = await readRenderedPage(chrome, url);
  assert.equal(result.text, "Visible");
  assert.deepEqual(calls.find((call) => call.name === "new_page").arguments, {
    url,
    background: true,
  });
  assert.equal(calls.find((call) => call.name === "evaluate_script").arguments.pageId, 2);
  assert.deepEqual(calls.at(-1), { name: "close_page", arguments: { pageId: 2 } });
});

test("redirect is rejected and browser errors still close the dedicated tab", async () => {
  for (const redirected of [true, false]) {
    const calls = [];
    const url = "http://localhost:3000/artigos/test";
    const chrome = {
      callTool: async (call) => {
        calls.push(call);
        if (call.name === "list_pages") return pages([[1, url]]);
        if (call.name === "new_page")
          return pages([
            [1, url],
            [2, redirected ? "https://other.test/" : url],
          ]);
        if (call.name === "evaluate_script")
          return { isError: true, content: [{ type: "text", text: "Chrome desconectado" }] };
        return { content: [] };
      },
    };
    await assert.rejects(
      () => readRenderedPage(chrome, url),
      redirected ? /redirecionou/ : /Chrome desconectado/,
    );
    assert.equal(calls.at(-1).name, "close_page");
    assert.equal(calls.at(-1).arguments.pageId, 2);
    if (redirected) assert.ok(!calls.some((call) => call.name === "evaluate_script"));
  }
});
