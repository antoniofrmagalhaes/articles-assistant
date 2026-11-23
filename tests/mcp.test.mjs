import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { root } from "../lib/workspace.mjs";

test("Sanity MCP starts outside the app cwd and exposes article tools", async () => {
  const client = new Client({ name: "local-smoke-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "mcp/sanity/server.mjs")],
    cwd: tmpdir(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "import_word",
      "list_word_files",
      "get_editorial_profile",
      "apply_editorial_defaults",
      "reset_article_draft",
      "search_articles",
      "delete_remote_article",
      "prepare_article_deletion",
      "validate_article",
      "publish_article",
      "verify_publication",
      "check_public_page",
    ])
      assert.ok(names.includes(name));
    const status = await client.callTool({ name: "workspace_status", arguments: {} });
    const config = JSON.parse(status.content.find((item) => item.type === "text").text);
    assert.equal(names.includes("check_panel_ready"), config.publicationPolicy.allowUiPublication);
    const wordList = await client.callTool({
      name: "list_word_files",
      arguments: { includeRegistered: false },
    });
    assert.notEqual(wordList.isError, true);
    assert.ok(
      Array.isArray(JSON.parse(wordList.content.find((item) => item.type === "text").text).files),
    );
    const result = await client.callTool({
      name: "validate_article",
      arguments: { articlePath: "../../escape/article.json" },
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
