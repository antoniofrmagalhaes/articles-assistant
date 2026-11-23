import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { root } from "../lib/workspace.mjs";

test("DevTools MCP exposes only the article workflow; no browser is operated", async () => {
  const client = new Client({ name: "devtools-smoke-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "mcp/devtools/server.mjs")],
    cwd: tmpdir(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "take_snapshot",
      "fill",
      "click",
      "navigate_page",
      "check_public_page_rendered",
    ])
      assert.ok(names.includes(name), `Missing ${name}`);
    assert.ok(
      !names.some((name) => /gofullpage|performance|emulat|network|extension|memory/i.test(name)),
    );
    const rejected = await client.callTool({ name: "performance_start_trace", arguments: {} });
    assert.equal(rejected.isError, true);
  } finally {
    await client.close();
  }
});
