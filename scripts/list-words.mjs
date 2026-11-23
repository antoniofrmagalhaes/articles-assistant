import { listWordFiles } from "../lib/word.mjs";
try {
  console.log(JSON.stringify(await listWordFiles(), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
