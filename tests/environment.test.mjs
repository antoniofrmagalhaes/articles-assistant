import test from "node:test";
import assert from "node:assert/strict";
import {
  settingsFromEnv,
  assertDestination,
  destination,
  publicationPolicy,
  assertUiPublicationAllowed,
} from "../lib/workspace.mjs";
import { createStudioNavigation } from "../lib/studio-navigation.mjs";

const env = (siteUrl) =>
  `SANITY_PROJECT_ID=example1\nSANITY_DATASET=production\nSITE_URL=${siteUrl}\nSTUDIO_URL=https://example.sanity.studio\n`;
test("production dataset and localhost site are independent configured destinations", () => {
  const config = settingsFromEnv(env("http://localhost:3000"));
  assert.equal(config.dataset, "production");
  assert.equal(config.siteUrl, "http://localhost:3000");
  const { allowedUrl } = createStudioNavigation(config);
  assert.equal(allowedUrl("http://localhost:3000/artigos/teste"), true);
  assert.equal(allowedUrl("https://www.example.com/artigos/teste"), false);
});
test("inherited shell environment cannot override or fill in the app .env", () => {
  const inherited = process.env.SITE_URL;
  process.env.SITE_URL = "https://www.example.com";
  try {
    assert.equal(settingsFromEnv(env("http://localhost:3000")).siteUrl, "http://localhost:3000");
    assert.throws(() => settingsFromEnv(env("")), /SITE_URL/);
  } finally {
    if (inherited === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = inherited;
  }
});
test("view URL changes do not change the Sanity document destination", () => {
  const previous = settingsFromEnv(env("https://www.example.com"));
  const current = settingsFromEnv(env("http://localhost:3000"));
  assert.doesNotThrow(() => assertDestination({ destination: destination(previous) }, current));
  assert.throws(
    () =>
      assertDestination({ destination: destination(previous) }, { ...current, dataset: "other" }),
    /projeto\/dataset/,
  );
});
test("a new env value produces a new navigation scope without a public-host fallback", () => {
  const first = createStudioNavigation(settingsFromEnv(env("http://localhost:3000")));
  const second = createStudioNavigation(settingsFromEnv(env("https://preview.example")));
  assert.equal(first.allowedUrl("http://localhost:3000/artigos/teste"), true);
  assert.equal(second.allowedUrl("https://preview.example/artigos/teste"), true);
  assert.equal(second.allowedUrl("http://localhost:3000/artigos/teste"), false);
});
test("ALLOW_UI_PUBLICATION controls both the mode question and Studio navigation", () => {
  const disabled = settingsFromEnv(`${env("http://localhost:3000")}ALLOW_UI_PUBLICATION=false\n`);
  assert.deepEqual(publicationPolicy(disabled), {
    allowUiPublication: false,
    askPublicationMode: false,
    availableModes: ["direct"],
    automaticMode: "direct",
  });
  assert.throws(() => assertUiPublicationAllowed(disabled), /ALLOW_UI_PUBLICATION=false/);
  const navigation = createStudioNavigation(disabled);
  assert.equal(navigation.allowedUrl(disabled.studioUrl), false);
  assert.equal(navigation.allowedUrl("http://localhost:3000/artigos/teste"), true);
  const enabled = settingsFromEnv(`${env("http://localhost:3000")}ALLOW_UI_PUBLICATION=true\n`);
  assert.equal(publicationPolicy(enabled).askPublicationMode, true);
  assert.equal(createStudioNavigation(enabled).allowedUrl(enabled.studioUrl), true);
  assert.throws(
    () => settingsFromEnv(`${env("http://localhost:3000")}ALLOW_UI_PUBLICATION=maybe\n`),
    /true ou false/,
  );
});
