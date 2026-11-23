import test from "node:test";
import assert from "node:assert/strict";
import { getEditorialProfile, mergeEditorialDefaults } from "../lib/editorial.mjs";

const profile = await getEditorialProfile();
test("shared profile fills author and publisher-derived note without mutating input", () => {
  const input = {
    _type: "article",
    _id: "stable",
    cid: "cidv1-aaaaaaaaaaaaaaaa",
    frontMatter: { lead: "Abertura" },
  };
  const before = structuredClone(input);
  const result = mergeEditorialDefaults(input, profile, {
    titleNote: "Reflexões sobre os temas e as questões apresentados neste artigo.",
  });
  assert.equal(result.document.author.name, profile.authors[profile.defaultAuthorId].name);
  assert.ok(result.document.author.description.length >= 40);
  assert.equal(result.titleNoteSource, "publisher-derived");
  assert.equal(result.needsTitleNote, false);
  assert.deepEqual(input, before);
  assert.equal(result.document._id, "stable");
  assert.equal(result.document.frontMatter.lead, "Abertura");
});
test("provided author, bio and title note remain untouched", () => {
  const input = {
    author: {
      name: "Outra Autora",
      description: "Biografia específica da outra autora que não deve ser substituída.",
    },
    frontMatter: { titleNote: "Nota originalmente fornecida no documento pela autora." },
  };
  const result = mergeEditorialDefaults(input, profile, {
    titleNote: "Uma outra nota que não deve substituir a nota fornecida.",
  });
  assert.deepEqual(result.document, input);
  assert.deepEqual(result.applied, []);
  assert.equal(result.titleNoteSource, "existing");
});
test("matching aliases reuse biography; unknown authors never get default bio", () => {
  const result = mergeEditorialDefaults({ author: { name: "Nathália Valadares" } }, profile);
  assert.equal(result.document.author.name, "Nathália Valadares");
  assert.equal(
    result.document.author.description,
    profile.authors[profile.defaultAuthorId].description,
  );
  assert.throws(
    () => mergeEditorialDefaults({ author: { name: "Outra pessoa" } }, profile),
    /autoria diferente/,
  );
});
test("notes need content and an existing note is not invented by the defaults helper", () => {
  assert.equal(mergeEditorialDefaults({}, profile).needsTitleNote, true);
  assert.throws(() => mergeEditorialDefaults({}, profile, { titleNote: "Curta" }), /24 caracteres/);
});
test("multiple author profiles can be selected explicitly", () => {
  const multiple = structuredClone(profile);
  multiple.authors.convidada = {
    name: "Autora Convidada",
    description: "Apresentação específica da autora convidada com os dados cadastrados.",
  };
  const result = mergeEditorialDefaults({}, multiple, { authorId: "convidada" });
  assert.equal(result.document.author.name, "Autora Convidada");
  assert.throws(
    () =>
      mergeEditorialDefaults({ author: { name: "Outra pessoa" } }, multiple, {
        authorId: "convidada",
      }),
    /difere do perfil/,
  );
});
