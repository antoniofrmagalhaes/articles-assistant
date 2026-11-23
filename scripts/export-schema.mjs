import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, saveJson } from "../lib/workspace.mjs";
import { loadCurrentArticleSchema } from "./validate-article.mjs";

const schema = loadCurrentArticleSchema();
function convert(type, ancestors = []) {
  if (ancestors.includes(type)) return {};
  const next = [...ancestors, type];
  const rules = type.validation ?? [];
  const result = { type: type.jsonType === "number" ? "number" : type.jsonType };
  if (type.jsonType === "object") {
    result.properties = Object.fromEntries(
      (type.fields ?? []).map((field) => [field.name, convert(field.type, next)]),
    );
    result.properties._type = { type: "string" };
    result.properties._key = { type: "string", minLength: 1 };
    const required = (type.fields ?? [])
      .filter((field) => (field.type.validation ?? []).some((rule) => rule.isRequired?.()))
      .map((field) => field.name);
    if (required.length) result.required = required;
  }
  if (type.jsonType === "array") {
    result.items = {
      anyOf: (type.of ?? []).map((member) => {
        const item = convert(member, next);
        if (member.jsonType === "object") {
          item.properties = {
            ...item.properties,
            _type: { const: member.name },
            _key: { type: "string", minLength: 1 },
          };
          item.required = [...new Set([...(item.required ?? []), "_type", "_key"])];
        }
        return item;
      }),
    };
  }
  const list = type.options?.list;
  if (list) result.enum = list.map((item) => (typeof item === "object" ? item.value : item));
  for (const rule of rules)
    for (const entry of rule._rules ?? []) {
      if (!["min", "max"].includes(entry.flag) || typeof entry.constraint !== "number") continue;
      const key =
        type.jsonType === "array"
          ? `${entry.flag}Items`
          : type.jsonType === "string"
            ? `${entry.flag}Length`
            : entry.flag === "min"
              ? "minimum"
              : "maximum";
      result[key] = entry.constraint;
    }
  return result;
}
const exported = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Artigo Sanity",
  $comment:
    "Gerado do schema/source. O validador executa também regras customizadas do Sanity, Portable Text e requisitos da página; este JSON Schema sozinho não substitui validate:article.",
  ...convert(schema.get("article")),
};
exported.properties._type = { const: "article" };
exported.required = [...new Set([...(exported.required ?? []), "_type"])];
await saveJson(path.join(root, "schema/article.schema.json"), exported);
const files = ["articleType.ts", "articleSupportingTypes.ts", "index.ts"];
const fingerprints = Object.fromEntries(
  await Promise.all(
    files.map(async (name) => [
      name,
      createHash("sha256")
        .update(await fs.readFile(path.join(root, "schema/source", name)))
        .digest("hex"),
    ]),
  ),
);
await saveJson(path.join(root, "schema/version.json"), {
  sourceCommit: "da351d8",
  fingerprints,
  generatedAt: new Date().toISOString(),
  runtimeSource: "schema/source",
  note: "Snapshot portátil sem componentes visuais do Studio. Nomes, tipos, caminhos e regras de dados preservados. Atualize o pacote deliberadamente quando o schema do Studio mudar.",
});
console.log("Schema JSON e identificação do snapshot exportados.");
