import { importWord } from "../lib/word.mjs";
const [sourcePath, slug] = process.argv.slice(2);
try {
  console.log(JSON.stringify(await importWord({ sourcePath, slug }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
