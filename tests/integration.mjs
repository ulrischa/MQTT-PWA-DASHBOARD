// Uli: Run against a disposable local broker and in-memory IndexedDB, never user devices.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  process.env.MQTT_TEST_RUNTIME
    ? process.env.MQTT_TEST_RUNTIME + "/package.json"
    : import.meta.url,
);
const { indexedDB } = require("fake-indexeddb");
globalThis.indexedDB = indexedDB;
const mqtt = require("mqtt"),
  aedes = require("aedes")(),
  { WebSocketServer, createWebSocketStream } = require("ws");
const { Engine, initialState, matches, validTopic, fieldValue } = await import(
  "../dist/core.js"
);
const vault = await import("../dist/vault.js");
assert.equal(await vault.openVault(), false);
const initial = { state: initialState(), history: [], recordings: [] };
initial.state.brokers[0].username = "synthetic-user";
initial.state.brokers[0].password = "synthetic-broker-secret";
initial.state.brokers[0].rememberPassword = true;
await vault.createVault("synthetic-test-passphrase", initial);
const encrypted = await vault.exportVault();
assert(!encrypted.includes("synthetic-user"));
assert(!encrypted.includes("synthetic-broker-secret"));
assert(!encrypted.includes("home/"));
await vault.lockVault();
await assert.rejects(() => vault.unlock("wrong-password"));
assert.deepEqual(await vault.unlock("synthetic-test-passphrase"), initial);
const tampered = JSON.parse(encrypted);
tampered.data[10] ^= 1;
await vault.restoreVault(JSON.stringify(tampered));
await assert.rejects(() => vault.unlock("synthetic-test-passphrase"));
await vault.restoreVault(encrypted);
await vault.unlock("synthetic-test-passphrase");
console.log(
  "PASS encryption, no plaintext credentials, wrong password, tamper rejection, backup restore",
);
assert(matches("home/#", "home"));
assert(matches("home/+/temp", "home/a/temp"));
assert(!matches("home/+", "home/a/temp"));
assert(!matches("#", "$SYS/status"));
assert(matches("$SYS/#", "$SYS/status"));
assert(!validTopic("a/#/b", true));
assert(!validTopic("a/+b", true));
assert(!validTopic("a/#"));
assert.equal(fieldValue('{"a":{"b":3}}', "a.b"), 3);
assert.equal(fieldValue("{}", "__proto__"), undefined);
console.log("PASS topic filters, wildcard validation and JSON paths");
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
server.on("connection", (ws) => aedes.handle(createWebSocketStream(ws)));
aedes.on("clientError", (client, error) =>
  console.log("Broker error:", error.stack),
);
await new Promise((r) => server.on("listening", r));
globalThis.window = { mqtt };
globalThis.location = { protocol: "http:" };
const b = {
  id: "test",
  name: "Test",
  url: `ws://127.0.0.1:${server.address().port}`,
  clientId: "synthetic-test-client",
  version: 4,
  keepalive: 60,
  persistent: true,
  reconnect: false,
  subscriptions: [{ topic: "test/#", qos: 1, paused: false }],
};
const state = initialState();
state.brokers = [b];
state.rules = [];
state.widgets = [];
const engine = new Engine({ state, history: [], recordings: [] });
const errors = [];
engine.addEventListener("error", (e) => errors.push(e.detail));
const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Timed out");
};
try {
  engine.connect(b);
  await until(() => engine.status.get("test") === "Verbunden");
  await new Promise((r) => setTimeout(r, 60));
  for (const qos of [0, 1, 2]) {
    await engine.publish(
      "test",
      `test/q${qos}`,
      '{"temperature":24}',
      qos,
      qos === 1,
    );
    await until(() => engine.latest.has("test\0test/q" + qos));
    assert.equal(
      engine.latest.get("test\0test/q" + qos).payload,
      '{"temperature":24}',
    );
  }
  console.log("PASS real MQTT WebSocket publish/subscribe QoS 0, 1, 2");
  await engine.toggleSubscription(b, b.subscriptions[0]);
  const before = engine.history.filter((m) => m.direction === "IN").length;
  await engine.publish("test", "test/paused", "ignored", 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(
    engine.history.filter((m) => m.direction === "IN").length,
    before,
  );
  await engine.toggleSubscription(b, b.subscriptions[0]);
  await until(
    () => engine.history.filter((m) => m.direction === "IN").length > before,
  );
  assert(engine.history.some((m) => m.direction === "IN" && m.retain));
  console.log("PASS subscription pause/resume and retained delivery");

  engine.startRecording("Synthetic");
  await engine.publish("test", "test/record", "42", 1);
  await until(() => engine.recording.messages.length > 0);
  engine.stopRecording();
  assert(engine.recordings[0].messages.some((m) => m.topic === "test/record"));
  assert(engine.recordings[0].messages.every((m) => m.direction === "IN"));
  state.rules.push({
    id: "r",
    broker: "test",
    topic: "test/input",
    operator: "gt",
    value: "30",
    action: "publish",
    target: "test/output",
    payload: "ON",
    enabled: true,
    cooldown: 1,
  });
  await engine.publish("test", "test/input", "31", 1);
  await until(() => engine.latest.has("test\0test/output"));
  assert.equal(engine.latest.get("test\0test/output").payload, "ON");
  console.log("PASS recording and rule execution through actual broker");
  engine.disconnect("test");
  await new Promise((r) => setTimeout(r, 60));
  const sender = mqtt.connect(b.url, {
    clientId: "synthetic-sender",
    reconnectPeriod: 0,
  });
  await new Promise((resolve, reject) => {
    sender.once("connect", resolve);
    sender.once("error", reject);
  });
  await new Promise((resolve, reject) =>
    sender.publish("test/offline", "queued", { qos: 1 }, (e) =>
      e ? reject(e) : resolve(),
    ),
  );
  await new Promise((r) => sender.end(false, r));
  engine.connect(b);
  await until(() => engine.latest.has("test\0test/offline"));
  assert.equal(engine.latest.get("test\0test/offline").payload, "queued");
  console.log("PASS persistent session queues QoS 1 while disconnected");
  await engine.flush();
  await vault.lockVault();
  const restored = await vault.unlock("synthetic-test-passphrase");
  assert(restored.history.length > 0);
  assert.equal(restored.recordings.length, 1);
  await vault.changePassword("changed-synthetic-passphrase", restored);
  await vault.lockVault();
  await assert.rejects(() => vault.unlock("synthetic-test-passphrase"));
  assert.deepEqual(
    await vault.unlock("changed-synthetic-passphrase"),
    restored,
  );
  console.log("PASS encrypted history persistence and master password change");
  assert.deepEqual(errors, []);
} finally {
  engine.disconnect("test");
  clearTimeout(engine.persistTimer);
  await new Promise((r) => server.close(r));
  await new Promise((r) => aedes.close(r));
}
console.log("All integration checks passed.");
