import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("before fetching server state the interface does not invent an empty ledger or zero balance", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const { default: App } = await vite.ssrLoadModule("/client/App.tsx");
    const html = renderToStaticMarkup(createElement(App));

    assert.equal(html.includes("Ledger unavailable"), true);
    assert.equal(
      /<button(?![^>]*disabled)[^>]*>Refresh state/.test(html),
      true,
      "An enabled refresh must be reachable even before the first response or after reloading a running turn.",
    );
    assert.equal(html.includes("No credits issued. Yet."), false);
    assert.equal(/0(?:<!-- -->)? <span>CR ISSUED/.test(html), false);
  } finally {
    await vite.close();
  }
});
