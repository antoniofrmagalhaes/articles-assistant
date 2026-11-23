import { applyEditorialDefaults } from "../lib/editorial.mjs";
const [articlePath, ...args] = process.argv.slice(2);
const options = { articlePath };
try {
  for (let index = 0; index < args.length; index += 2) {
    const key = {
      "--author-id": "authorId",
      "--title-note": "titleNote",
      "--note-source": "noteSource",
    }[args[index]];
    if (!key || !args[index + 1])
      throw new Error("Use --author-id, --title-note ou --note-source seguidos do valor.");
    options[key] = args[index + 1];
  }
  if (!articlePath)
    throw new Error(
      "Uso: npm run apply:editorial -- Docs/<slug>/article.json [--title-note texto]",
    );
  console.log(JSON.stringify(await applyEditorialDefaults(options), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
