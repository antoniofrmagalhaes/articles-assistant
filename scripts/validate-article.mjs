import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createSchema, validateDocument } from "sanity";

const requireDependency = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Sanity's validator schedules work through window timers, even in CLI mode.
if (typeof globalThis.window === "undefined") {
  globalThis.window = { setTimeout, clearTimeout };
}

// Read the current TS schema directly, without loading Studio UI or credentials.
function loadProjectModule(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const record = { exports: {} };
  cache.set(filename, record);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = (specifier) => {
    if (specifier.startsWith("../components/")) return {};
    if (!specifier.startsWith(".")) return requireDependency(specifier);
    const target = path.resolve(path.dirname(filename), `${specifier}.ts`);
    return loadProjectModule(target, cache);
  };
  new Function("require", "module", "exports", compiled)(localRequire, record, record.exports);
  return record.exports;
}

function fieldPath(segments = []) {
  return (
    segments.reduce((result, segment) => {
      if (typeof segment === "number") return `${result}[${segment}]`;
      if (typeof segment === "object") return `${result}[_key=${JSON.stringify(segment._key)}]`;
      return result ? `${result}.${segment}` : segment;
    }, "") || "$"
  );
}

export function loadCurrentArticleSchema() {
  const { schemaTypes } = loadProjectModule(path.join(projectRoot, "schema/source/index.ts"));
  return createSchema({ name: "prepublish-article", types: schemaTypes });
}

export async function validateArticleObject(document, remote = {}) {
  const errors = [];
  const warnings = [];
  const addError = (field, message) => errors.push({ field, message });
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return {
      valid: false,
      errors: [{ field: "$", message: "Esperado um objeto de artigo." }],
      warnings,
    };
  }
  if (document._type !== "article") addError("_type", 'Esperado "article".');

  const schema = loadCurrentArticleSchema();
  for (const group of schema._validation ?? []) {
    for (const problem of group.problems) {
      if (problem.severity === "error") addError("$schema", problem.message);
    }
  }
  if (!schema.get("article")) addError("$schema", "O schema atual não define o tipo article.");
  if (errors.length) return { valid: false, errors, warnings };

  function inspect(value, type, segments) {
    if (value === undefined) return;
    const field = fieldPath(segments);
    if (value === null) {
      addError(
        field,
        "Valor null incompatível com o campo; remova o campo opcional ou preencha-o.",
      );
      return;
    }
    if (type.jsonType === "array") {
      if (!Array.isArray(value)) {
        addError(field, "Esperada uma lista.");
        return;
      }
      const keys = new Set();
      for (const [index, item] of value.entries()) {
        const itemPath = [...segments, index];
        const candidate = type.of?.find((member) => {
          if (item && typeof item === "object")
            return member.name === item._type || member.type?.name === item._type;
          return member.jsonType === typeof item;
        });
        if (!candidate) {
          addError(fieldPath(itemPath), "Item ou _type não suportado pelo schema atual.");
          continue;
        }
        if (item && typeof item === "object") {
          if (typeof item._key !== "string" || !item._key || keys.has(item._key)) {
            addError(
              `${fieldPath(itemPath)}._key`,
              "Cada objeto da lista deve ter uma _key não vazia e única.",
            );
          }
          keys.add(item._key);
        }
        inspect(item, candidate, itemPath);
      }
      return;
    }
    if (type.jsonType === "object") {
      if (typeof value !== "object" || Array.isArray(value)) {
        addError(field, "Esperado um objeto.");
        return;
      }
      for (const child of type.fields ?? [])
        inspect(value[child.name], child.type, [...segments, child.name]);
      return;
    }
    if (typeof value !== type.jsonType) addError(field, `Esperado tipo ${type.jsonType}.`);
    const choices = type.options?.list?.map((choice) =>
      typeof choice === "object" ? choice.value : choice,
    );
    if (choices && !choices.includes(value))
      addError(field, "Valor não está nas opções do schema atual.");
  }
  inspect(document, schema.get("article"), []);

  // Structural validation is local. Remote identity checks belong to publication.
  const skippedChecks = new Set();
  const offlineClient = {
    config: () => ({ projectId: "local", dataset: "local" }),
    withConfig: () => offlineClient,
    fetch: async (_query, _params, options) => {
      if (options?.tag === "validation.slug-is-unique") {
        skippedChecks.add("Unicidade do slug no Sanity não verificada offline.");
        return true;
      }
      throw new Error("O schema exige uma consulta remota não suportada nesta validação local.");
    },
  };
  const markers = await validateDocument({
    document: { ...document, _id: document._id ?? "local-prepublish-validation" },
    workspace: { schema },
    environment: "cli",
    getClient: remote.getClient ?? (() => offlineClient),
    getDocumentExists:
      remote.getDocumentExists ??
      (async () => {
        skippedChecks.add("Existência dos assets/referências no Sanity não verificada offline.");
        return true;
      }),
  });
  for (const marker of markers) {
    const issue = { field: fieldPath(marker.path), message: marker.message };
    (marker.level === "error" ? errors : warnings).push(issue);
  }

  // Minimum routing/rendering contract, in addition to the current Studio rules.
  const slug = document.slug?.current;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    addError("slug.current", "Use um slug não vazio, com letras minúsculas, números e hífens.");
  }
  if (typeof slug === "string" && slug.length > 96)
    addError("slug.current", "Máximo de 96 caracteres.");
  if (!Number.isFinite(new Date(document.publication?.publishedAt ?? "").getTime())) {
    addError("publication.publishedAt", "Data de publicação inválida ou ausente.");
  }
  for (const [index, section] of (Array.isArray(document.sections)
    ? document.sections
    : []
  ).entries()) {
    if (!section || typeof section.title !== "string" || !section.title.trim()) {
      addError(`sections[${index}].title`, "Título da seção ausente ou inválido.");
    }
  }
  warnings.push(...[...skippedChecks].map((message) => ({ field: "$remote", message })));
  return { valid: errors.length === 0, errors, warnings };
}

async function main() {
  const [filename, ...extra] = process.argv.slice(2);
  if (!filename || extra.length) {
    console.error("Uso: npm run validate:article -- caminho/article.json");
    process.exitCode = 2;
    return;
  }
  try {
    const document = JSON.parse(
      fs.readFileSync(path.resolve(filename), "utf8").replace(/^\uFEFF/, ""),
    );
    const result = await validateArticleObject(document);
    for (const issue of result.errors) console.error(`ERRO ${issue.field}: ${issue.message}`);
    for (const issue of result.warnings) console.warn(`AVISO ${issue.field}: ${issue.message}`);
    console.log(
      result.valid
        ? "VÁLIDO: schema atual e requisitos mínimos da página atendidos."
        : "INVÁLIDO: publicação bloqueada até corrigir os campos acima.",
    );
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    console.error(`ERRO $: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
