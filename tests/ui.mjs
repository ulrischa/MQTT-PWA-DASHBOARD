// Uli: DOM integration smoke test; this does not replace real browser visual QA.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  process.env.MQTT_TEST_RUNTIME
    ? process.env.MQTT_TEST_RUNTIME + "/package.json"
    : import.meta.url,
);
const { JSDOM } = require("jsdom"),
  { indexedDB } = require("fake-indexeddb");
const dom = new JSDOM(
  await readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  { url: "https://mqtt.test/" },
);
const w = dom.window;
globalThis.window = w;
globalThis.document = w.document;
globalThis.indexedDB = indexedDB;
globalThis.location = { protocol: "https:", reload() {} };
globalThis.FormData = w.FormData;
globalThis.confirm = () => true;
Object.defineProperty(globalThis, "navigator", {
  value: { locks: { request: async (n, o, callback) => callback({}) } },
  configurable: true,
});
w.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
w.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const until = async (predicate) => {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Timed out");
};
const click = (selector) => {
  const e = document.querySelector(selector);
  assert(e, selector);
  e.click();
};
const fill = (form, name, value) => {
  const e = document.querySelector(form).elements[name];
  if (e.type === "checkbox") e.checked = !!value;
  else e.value = value;
};
const submit = (form) =>
  document
    .querySelector(form)
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
await import("../dist/app.js");
await until(() => document.querySelector("#unlock-form"));
fill("#unlock-form", "password", "synthetic-ui-passphrase");
fill("#unlock-form", "repeat", "synthetic-ui-passphrase");
submit("#unlock-form");
await until(() => document.querySelectorAll(".widgets .card").length === 6);
assert.equal(document.querySelector("#modal").open, false);
console.log("PASS vault setup opens six demo widgets");
click('[data-action="demo-toggle"]');
assert(document.querySelector("#brokers").textContent.includes("Verbunden"));
click('[data-view="publish"]');
fill("#publish-form", "topic", "home/livingroom/light/set");
fill("#publish-form", "payload", "OFF");
fill("#publish-form", "qos", "1");
submit("#publish-form");
await until(
  () => document.querySelector("#toast").textContent === "Nachricht gesendet.",
);
click('[data-view="dashboard"]');
assert(
  document.querySelector(".widgets").textContent.includes("Ausgeschaltet"),
);
console.log("PASS publish updates received widget state");
click('[data-action="widget-add"]');
fill("#editor", "title", "JSON test");
fill("#editor", "type", "json");
fill("#editor", "topic", "home/test/json");
fill("#editor", "field", "a.b");
submit("#editor");
await until(() => document.querySelectorAll(".widgets .card").length === 7);
click('[data-view="subscriptions"]');
assert(
  document.querySelector("#content").textContent.includes("home/test/json"),
);
click('[data-view="publish"]');
fill("#publish-form", "topic", "home/test/json");
fill("#publish-form", "payload", '{"a":{"b":99}}');
submit("#publish-form");
await new Promise((r) => setTimeout(r, 40));
click('[data-view="dashboard"]');
assert(document.querySelector(".widgets").textContent.includes("99"));
console.log("PASS widget creation, auto subscription and nested JSON field");
click('[data-view="rules"]');
click('[data-action="rule-add"]');
fill("#editor", "name", "Test rule");
fill("#editor", "topic", "home/test/input");
fill("#editor", "value", "30");
fill("#editor", "action", "publish");
fill("#editor", "target", "home/test/output");
fill("#editor", "payload", "ON");
fill("#editor", "enabled", true);
submit("#editor");
await until(() =>
  document.querySelector("#content").textContent.includes("Test rule"),
);
click('[data-view="publish"]');
fill("#publish-form", "topic", "home/test/input");
fill("#publish-form", "payload", "31");
submit("#publish-form");
await new Promise((r) => setTimeout(r, 50));
click('[data-view="history"]');
assert(
  document.querySelector("#content").textContent.includes("home/test/output"),
);
console.log("PASS rule form through incoming MQTT simulation");
click('[data-view="recordings"]');
click('[data-action="record-start"]');
fill("#editor", "name", "UI recording");
submit("#editor");
await until(() => document.querySelector("#modal").open === false);
click('[data-view="publish"]');
fill("#publish-form", "topic", "home/test/record");
fill("#publish-form", "payload", "recorded");
submit("#publish-form");
await new Promise((r) => setTimeout(r, 30));
click('[data-view="recordings"]');
click('[data-action="record-stop"]');
assert(document.querySelector("#content").textContent.includes("UI recording"));
click('[data-action="replay"]');
fill("#editor", "prefix", "replay/");
fill("#editor", "confirm", true);
submit("#editor");
await until(
  () =>
    document.querySelector("#toast").textContent === "Replay abgeschlossen.",
);
console.log("PASS recording and confirmed replay forms");
click('[data-action="demo-toggle"]');
click('[data-action="settings"]');
fill("#editor", "maxHistory", "100");
submit("#editor");
await until(() => document.querySelector("#modal").open === false);
console.log("All DOM integration checks passed.");
process.exit(0);
