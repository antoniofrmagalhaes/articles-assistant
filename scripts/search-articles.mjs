import { searchArticles } from "../lib/research.mjs";
try {
  console.log(
    JSON.stringify(await searchArticles({ query: process.argv.slice(2).join(" ") }), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
