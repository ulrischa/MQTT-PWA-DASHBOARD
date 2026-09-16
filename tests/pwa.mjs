// Uli: Validate install metadata, prompt lifecycle and scoped offline behavior without user data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.webmanifest", root), "utf8"),
);
for (const field of [
  "id",
  "name",
  "short_name",
  "start_url",
  "scope",
  "display",
])
  assert(manifest[field], field);
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.prefer_related_applications, false);
for (const size of [192, 512])
  assert(
    manifest.icons.some(
      (icon) => icon.sizes === `${size}x${size}` && icon.purpose === "any",
    ),
  );
assert(
  manifest.icons.some(
    (icon) => icon.sizes === "512x512" && icon.purpose === "maskable",
  ),
);
for (const icon of manifest.icons) {
  const bytes = await readFile(new URL(icon.src, root));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const [width, height] = icon.sizes.split("x").map(Number);
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
}
const html = await readFile(new URL("index.html", root), "utf8");
assert(html.includes('rel="manifest"'));
assert(html.includes('rel="apple-touch-icon"'));
assert(html.includes("apple-mobile-web-app-capable"));
const listeners = {},
  cacheEntries = new Map(),
  deleted = [];
let cachedPaths,
  matched,
  networkCalls = 0;
const scope = "https://example.test/sub/mqtt/";
const context = {
  URL,
  encodeURIComponent,
  Promise,
  fetch: async () => {
    networkCalls++;
    return "NETWORK";
  },
  caches: {
    open: async (name) => {
      if (!cacheEntries.has(name))
        cacheEntries.set(name, {
          addAll: async (paths) => {
            cachedPaths = paths;
          },
          match: async (request, options) => {
            matched = { name, request, options };
            return "CACHED";
          },
        });
      return cacheEntries.get(name);
    },
    keys: async () => [...cacheEntries.keys()],
    delete: async (name) => {
      deleted.push(name);
      cacheEntries.delete(name);
    },
  },
  self: {
    registration: { scope },
    location: new URL("sw.js", scope),
    addEventListener: (name, handler) => (listeners[name] = handler),
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => {},
    },
  },
};
vm.runInNewContext(await readFile(new URL("sw.js", root), "utf8"), context);
let work;
listeners.install({ waitUntil: (promise) => (work = promise) });
await work;
for (const asset of cachedPaths)
  if (asset !== "./") await readFile(new URL(asset, root));
assert(cachedPaths.includes("./pwa.js"));
assert(
  !cachedPaths.some((path) => path.includes("README") || path.includes("zip")),
);
const own = [...cacheEntries.keys()][0];
const stale = own.replace(/v2$/, "v1");
cacheEntries.set(stale, {});
cacheEntries.set("unrelated-app-v1", {});
listeners.activate({ waitUntil: (promise) => (work = promise) });
await work;
assert.deepEqual(deleted, [stale]);
let response;
listeners.fetch({
  request: { url: scope + "?source=installed", method: "GET" },
  respondWith: (promise) => (response = promise),
});
assert.equal(await response, "CACHED");
assert.equal(matched.name, own);
assert.equal(matched.options.ignoreSearch, true);
assert.equal(networkCalls, 0);
for (const request of [
  { url: "https://broker.test/data", method: "GET" },
  { url: scope + "secret", method: "GET" },
  { url: scope, method: "POST" },
  { url: "https://example.test/outside/index.html", method: "GET" },
])
  listeners.fetch({
    request,
    respondWith: () => assert.fail("Unexpected interception"),
  });
console.log(
  "PASS manifest, PNG dimensions, same-scope assets, offline query URL and cache isolation",
);
const events = {};
globalThis.window = {
  isSecureContext: true,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener: (name, handler) => (events[name] = handler),
};
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Chrome Android", platform: "Linux" },
  configurable: true,
});
const { setupInstall } = await import("../dist/pwa.js");
const button = { hidden: false, textContent: "" },
  notices = [];
const install = setupInstall({ button, notify: (text) => notices.push(text) });
assert.equal(button.hidden, false);
let prompts = 0,
  prevented = false;
events.beforeinstallprompt({
  preventDefault() {
    prevented = true;
  },
  prompt: async () => prompts++,
  userChoice: Promise.resolve({ outcome: "dismissed" }),
});
await install();
assert(prevented);
assert.equal(prompts, 1);
await install();
assert.equal(prompts, 1);
events.appinstalled();
assert(button.hidden);
console.log(
  "PASS one-shot install prompt, cancellation fallback and installed-state button",
);
navigator.userAgent = "iPhone";
const iosButton = {};
await setupInstall({
  button: iosButton,
  notify: (text) => notices.push(text),
})();
assert(notices.at(-1).includes("Safari"));
window.isSecureContext = false;
await setupInstall({ button: {}, notify: (text) => notices.push(text) })();
assert(notices.at(-1).includes("HTTPS"));
console.log("PASS iOS guidance and insecure-origin installation guidance");
