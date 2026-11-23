import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { importWord, listWordFiles, resolveWordSourcePath } from "../lib/word.mjs";
import { root, docs, json } from "../lib/workspace.mjs";

function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const filename = Buffer.from(name),
      body = Buffer.from(source);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, body);
    central.push(directory, filename);
    offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
test("external Word remains intact and extraction retains text and bold", async () => {
  const sourceFolder = await fs.mkdtemp(path.join(tmpdir(), "articles-word-test-"));
  const sourcePath = path.join(sourceFolder, "original.docx");
  const slug = `test-word-${randomUUID()}`;
  const folder = path.join(docs, slug);
  const word = zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Família e direitos.</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Trecho em negrito.</w:t></w:r></w:p></w:body></w:document>',
  });
  await fs.writeFile(sourcePath, word);
  try {
    const result = await importWord({ sourcePath, slug });
    assert.equal(result.originalPreserved, true);
    assert.equal(result.rootSourceRemoved, false);
    assert.deepEqual(await fs.readFile(sourcePath), word);
    assert.deepEqual(await fs.readFile(path.join(folder, "original.docx")), word);
    const html = await fs.readFile(path.join(folder, "extracted.html"), "utf8");
    assert.match(html, /Família e direitos/);
    assert.match(html, /<strong>Trecho em negrito/);
    assert.equal((await json(path.join(folder, "conversion-review.json"))).status, "pending");
    assert.equal((await importWord({ sourcePath, slug })).alreadyImported, true);
    const rootCopy = path.join(root, `test-input-${randomUUID()}.docx`);
    try {
      await fs.writeFile(rootCopy, word, { flag: "wx" });
      const registered = await importWord({ sourcePath: rootCopy, slug });
      assert.equal(registered.rootSourceRemoved, true);
      await assert.rejects(() => fs.access(rootCopy), { code: "ENOENT" });
      assert.deepEqual(await fs.readFile(path.join(folder, "original.docx")), word);
      // Never delete the root source when the registered copy is damaged.
      await fs.writeFile(rootCopy, word, { flag: "wx" });
      await fs.writeFile(path.join(folder, "original.docx"), "damaged");
      await assert.rejects(() => importWord({ sourcePath: rootCopy, slug }), /SHA-256/);
      assert.deepEqual(await fs.readFile(rootCopy), word);
      await fs.writeFile(path.join(folder, "original.docx"), word);
    } finally {
      await fs.unlink(rootCopy).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }

    const rootSource = path.join(root, `test-root-${randomUUID()}.docx`);
    const movedSlug = `test-moved-${randomUUID()}`;
    const movedFolder = path.join(docs, movedSlug);
    try {
      await fs.writeFile(rootSource, word, { flag: "wx" });
      const found = await listWordFiles({ includeRegistered: false });
      assert.equal(
        found.files.find((file) => file.name === path.basename(rootSource)).sourcePath,
        rootSource,
      );
      const moved = await importWord({ sourcePath: path.basename(rootSource), slug: movedSlug });
      assert.equal(moved.rootSourceRemoved, true);
      await assert.rejects(() => fs.access(rootSource), { code: "ENOENT" });
      assert.deepEqual(await fs.readFile(path.join(movedFolder, path.basename(rootSource))), word);
      const retried = await importWord({ sourcePath: path.basename(rootSource), slug: movedSlug });
      assert.equal(retried.alreadyImported, true);
      assert.equal(retried.rootSourceRemoved, true);
    } finally {
      assert.equal(path.dirname(await fs.realpath(movedFolder)), await fs.realpath(docs));
      for (const name of await fs.readdir(movedFolder))
        await fs.unlink(path.join(movedFolder, name));
      await fs.rmdir(movedFolder);
      await fs.unlink(rootSource).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  } finally {
    assert.equal(path.dirname(await fs.realpath(folder)), await fs.realpath(docs));
    for (const name of await fs.readdir(folder)) await fs.unlink(path.join(folder, name));
    await fs.rmdir(folder);
    await fs.unlink(sourcePath);
    await fs.rmdir(sourceFolder);
  }
});
test("Word paths resolve from the app root and invalid arguments give an actionable error", async () => {
  assert.equal(resolveWordSourcePath("arquivo.docx"), path.join(root, "arquivo.docx"));
  assert.equal(
    resolveWordSourcePath(path.join("Docs", "artigo", "arquivo.docx")),
    path.join(docs, "artigo", "arquivo.docx"),
  );
  assert.throws(() => resolveWordSourcePath(""), /list_word_files/);
  assert.throws(() => resolveWordSourcePath("../arquivo.docx"), /dentro do app/);
  await assert.rejects(
    () => importWord({ sourcePath: "missing-word.docx", slug: `missing-${randomUUID()}` }),
    /Word não encontrado.*list_word_files/,
  );
});

test("failed extraction keeps the root Word and its intact registered copy", async () => {
  const name = `test-invalid-${randomUUID()}.docx`;
  const sourcePath = path.join(root, name);
  const slug = `test-failed-word-${randomUUID()}`;
  const folder = path.join(docs, slug);
  const original = Buffer.from("This is not a valid DOCX archive.");
  await fs.writeFile(sourcePath, original, { flag: "wx" });
  try {
    await assert.rejects(() => importWord({ sourcePath, slug }));
    assert.deepEqual(await fs.readFile(sourcePath), original);
    assert.deepEqual(await fs.readFile(path.join(folder, name)), original);
    await assert.rejects(() => fs.access(path.join(folder, "extraction.json")), { code: "ENOENT" });
  } finally {
    assert.equal(path.dirname(await fs.realpath(folder)), await fs.realpath(docs));
    for (const filename of await fs.readdir(folder)) await fs.unlink(path.join(folder, filename));
    await fs.rmdir(folder);
    await fs.unlink(sourcePath);
  }
});
