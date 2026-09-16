import { saveVault } from "./vault.js";
// MQTT-PWA-DASHBOARD for Uli. No broker credentials leave this browser except to its broker.
export const uid = () => crypto.randomUUID();
export const validTopic = (t, filter = false) =>
  typeof t === "string" &&
  t.length > 0 &&
  !t.includes("\0") &&
  new TextEncoder().encode(t).length <= 65535 &&
  (filter
    ? t
        .split("/")
        .every(
          (p, i, a) =>
            (!p.includes("#") || (p === "#" && i === a.length - 1)) &&
            (!p.includes("+") || p === "+"),
        )
    : !/[+#]/.test(t));
export function matches(filter, topic) {
  if (topic.startsWith("$") && !filter.startsWith("$")) return false;
  const f = filter.split("/"),
    t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= t.length || (f[i] !== "+" && f[i] !== t[i])) return false;
  }
  return f.length === t.length;
}
export function fieldValue(payload, path) {
  if (!path) return payload;
  try {
    let v = JSON.parse(payload);
    for (const k of path.split(".")) {
      if (["__proto__", "constructor", "prototype"].includes(k))
        return undefined;
      v = v?.[k];
    }
    return typeof v === "object" ? JSON.stringify(v) : v;
  } catch {
    return undefined;
  }
}
export const demoTopics = [
  "home/livingroom/temperature",
  "home/energy/solar",
  "home/livingroom/humidity",
  "home/livingroom/light/state",
  "home/system/status",
  "home/energy/battery",
];
export function initialState() {
  return {
    version: 1,
    brokers: [
      {
        id: "demo",
        name: "Demo Zuhause",
        url: "demo://local",
        clientId: "demo",
        version: 4,
        keepalive: 60,
        reconnect: true,
        persistent: false,
        subscriptions: [{ topic: "home/#", qos: 1, paused: false }],
      },
    ],
    favorites: [],
    presets: [],
    rules: [],
    widgets: [
      {
        id: uid(),
        broker: "demo",
        title: "Wohnzimmer",
        type: "chart",
        topic: demoTopics[0],
        unit: "°C",
        min: 15,
        max: 30,
      },
      {
        id: uid(),
        broker: "demo",
        title: "Solarleistung",
        type: "chart",
        topic: demoTopics[1],
        unit: "W",
        min: 0,
        max: 14300,
      },
      {
        id: uid(),
        broker: "demo",
        title: "Luftfeuchtigkeit",
        type: "gauge",
        topic: demoTopics[2],
        unit: "%",
        min: 0,
        max: 100,
      },
      {
        id: uid(),
        broker: "demo",
        title: "Wohnzimmerlicht",
        type: "switch",
        topic: demoTopics[3],
        command: "home/livingroom/light/set",
        on: "ON",
        off: "OFF",
        qos: 1,
      },
      {
        id: uid(),
        broker: "demo",
        title: "Systemstatus",
        type: "status",
        topic: demoTopics[4],
        on: "online",
      },
      {
        id: uid(),
        broker: "demo",
        title: "Batterie",
        type: "gauge",
        topic: demoTopics[5],
        unit: "%",
        min: 0,
        max: 100,
      },
    ],
    settings: { maxHistory: 5000, autoscroll: true },
  };
}
export class Engine extends EventTarget {
  constructor(snapshot) {
    super();
    this.state = snapshot?.state || initialState();
    this.clients = new Map();
    this.status = new Map();
    this.passwords = new Map();
    this.history = snapshot?.history || [];
    this.historyBytes = this.history.reduce(
      (n, m) => n + m.payload.length * 2 + m.topic.length * 2 + 300,
      0,
    );
    this.latest = new Map();
    this.counts = new Map();
    this.recording = null;
    this.recordings = snapshot?.recordings || [];
    this.ruleTimes = new Map();
    this.demoTick = 0;
    for (const m of this.history) this.indexMessage(m);
    this.ready = Promise.resolve();
  }
  snapshot() {
    return {
      state: {
        ...this.state,
        brokers: this.state.brokers.map((b) => ({
          ...b,
          password: b.rememberPassword ? b.password : undefined,
        })),
      },
      history: this.history,
      recordings: this.recordings,
    };
  }
  persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(
      () =>
        this.flush().catch((e) =>
          this.emit(
            "error",
            "Tresor konnte nicht gespeichert werden: " + e.message,
          ),
        ),
      750,
    );
  }
  flush() {
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    return saveVault(this.snapshot());
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  save() {
    this.persist();
    this.emit("change");
  }

  indexMessage(m) {
    if (m.direction === "OUT") return;
    const k = m.broker + "\0" + m.topic;
    this.latest.set(k, m);
    const c = this.counts.get(k) || { count: 0, first: m.time };
    c.count++;
    c.last = m.time;
    this.counts.set(k, c);
    if (this.latest.size > 2000) {
      const oldest = this.latest.keys().next().value;
      this.latest.delete(oldest);
      this.counts.delete(oldest);
    }
  }
  persistMessage() {
    this.persist();
  }

  receive(
    broker,
    topic,
    payload,
    packet = {},
    direction = "IN",
    time = Date.now(),
    sample = false,
  ) {
    if (new TextEncoder().encode(payload).length > 262144) {
      this.emit("error", "Nachricht über 256 KB nicht in History übernommen.");
      return;
    }
    const m = {
      key: uid(),
      broker,
      topic,
      payload,
      qos: packet.qos || 0,
      retain: !!packet.retain,
      direction,
      time,
      sample,
    };
    this.history.push(m);
    this.historyBytes += payload.length * 2 + topic.length * 2 + 300;
    while (
      this.history.length > this.state.settings.maxHistory ||
      this.historyBytes > 12000000
    ) {
      const removed = this.history.shift();
      this.historyBytes -=
        removed.payload.length * 2 + removed.topic.length * 2 + 300;
    }
    this.indexMessage(m);
    this.persistMessage(m);
    if (this.recording && direction === "IN" && !sample) {
      if (
        this.recording.messages.length < 10000 &&
        (this.recording.bytes || 0) + payload.length * 2 < 5000000
      ) {
        this.recording.messages.push(m);
        this.recording.bytes = (this.recording.bytes || 0) + payload.length * 2;
      } else {
        this.stopRecording();
        this.emit("error", "Aufnahmelimit erreicht. Aufnahme gespeichert.");
      }
    }
    if (direction === "IN" && !sample) this.runRules(m);
    this.emit("message", m);
  }
  setStatus(id, status) {
    this.status.set(id, status);
    this.emit("change");
  }
  connect(b) {
    if (this.clients.has(b.id) || this.status.get(b.id) === "Verbunden") return;
    if (b.id === "demo") {
      this.setStatus("demo", "Verbunden");
      this.demoTimer = setInterval(() => this.demo(), 2000);
      this.demo();
      return;
    }
    try {
      const url = new URL(b.url);
      if (
        !["ws:", "wss:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error(
          "Bitte ws:// oder wss:// ohne Zugangsdaten in der URL verwenden.",
        );
      if (location.protocol === "https:" && url.protocol === "ws:")
        throw Error("Diese HTTPS-App benötigt einen wss:// Broker.");
      if (!window.mqtt) throw Error("MQTT-Bibliothek nicht geladen.");
      if (
        [...this.state.brokers].some(
          (x) =>
            x.id !== b.id &&
            x.url === b.url &&
            x.clientId === b.clientId &&
            this.clients.has(x.id),
        )
      )
        throw Error("Client-ID wird bereits verwendet.");
      this.setStatus(b.id, "Verbindet …");
      const c = window.mqtt.connect(b.url, {
        clientId: b.clientId,
        username: b.username || undefined,
        password: this.passwords.get(b.id) || b.password || undefined,
        protocolVersion: Number(b.version),
        clean: !b.persistent,
        keepalive: Number(b.keepalive) || 60,
        reconnectPeriod: b.reconnect ? 3000 : 0,
        connectTimeout: 10000,
        resubscribe: false,
        queueQoSZero: false,
        ...(Number(b.version) === 5
          ? { properties: { sessionExpiryInterval: b.persistent ? 86400 : 0 } }
          : {}),
      });
      this.clients.set(b.id, c);
      c.on("connect", () => {
        if (this.clients.get(b.id) !== c) return;
        this.setStatus(b.id, "Verbunden");
        for (const topic of b.pendingUnsubscribe || []) {
          c.unsubscribe(topic, (error) => {
            if (error)
              return this.emit("error", "Abmelden fehlgeschlagen: " + topic);
            b.pendingUnsubscribe = (b.pendingUnsubscribe || []).filter(
              (t) => t !== topic,
            );
            this.save();
          });
        }
        for (const s of b.subscriptions || []) {
          if (s.paused) c.unsubscribe(s.topic);
          else this.subscribe(b, s);
        }
      });
      c.on("message", (t, p, packet) =>
        this.receive(b.id, t, p.toString(), packet),
      );
      c.on("reconnect", () => {
        if (this.clients.get(b.id) === c) this.setStatus(b.id, "Verbindet …");
      });
      c.on("close", () => {
        if (this.clients.get(b.id) === c) {
          this.setStatus(
            b.id,
            b.reconnect ? "Verbindung verloren" : "Getrennt",
          );
          if (!b.reconnect) {
            this.clients.delete(b.id);
            c.end(true);
          }
        }
      });
      c.on("error", (e) => {
        this.emit("error", `${b.name}: ${e.message}`);
      });
    } catch (e) {
      this.setStatus(b.id, "Fehler");
      this.emit("error", e.message);
    }
  }
  disconnect(id) {
    if (id === "demo") {
      clearInterval(this.demoTimer);
    }
    const c = this.clients.get(id);
    this.clients.delete(id);
    if (c) c.end(true);
    this.setStatus(id, "Getrennt");
  }
  subscribe(b, s) {
    const c = this.clients.get(b.id);
    if (c?.connected)
      c.subscribe(s.topic, { qos: Number(s.qos) }, (err, granted) => {
        if (err || granted?.some((x) => x.qos >= 128))
          this.emit("error", `Subscription abgelehnt: ${s.topic}`);
      });
  }
  async toggleSubscription(b, s, remove = false) {
    const c = this.clients.get(b.id);
    const pause = remove || !s.paused;
    if (c?.connected) {
      await new Promise((resolve, reject) => {
        if (pause) c.unsubscribe(s.topic, (e) => (e ? reject(e) : resolve()));
        else
          c.subscribe(s.topic, { qos: +s.qos }, (e, g) =>
            e || g?.some((x) => x.qos >= 128)
              ? reject(e || Error("Subscription abgelehnt"))
              : resolve(),
          );
      });
    }
    s.paused = pause;
    if (remove && !c?.connected)
      b.pendingUnsubscribe = [
        ...new Set([...(b.pendingUnsubscribe || []), s.topic]),
      ];
    if (remove) b.subscriptions = b.subscriptions.filter((x) => x !== s);
    this.save();
  }
  publish(id, topic, payload, qos = 0, retain = false) {
    return new Promise((resolve, reject) => {
      if (!validTopic(topic))
        return reject(Error("Ungültiges Publish-Topic (keine Wildcards)."));
      if (new TextEncoder().encode(payload).length > 262144)
        return reject(Error("Payload maximal 256 KB."));
      if (this.status.get(id) !== "Verbunden")
        return reject(Error("Broker zuerst verbinden."));
      const done = (e) => {
        if (e) return reject(e);
        this.receive(id, topic, payload, { qos, retain }, "OUT");
        resolve();
      };
      if (id === "demo") {
        done();
        const b = this.state.brokers.find((b) => b.id === id);
        const t = topic.endsWith("/set")
          ? topic.slice(0, -4) + "/state"
          : topic;
        if (b.subscriptions.some((s) => !s.paused && matches(s.topic, t)))
          this.receive(id, t, payload, { qos, retain });
        return;
      }
      const c = this.clients.get(id);
      if (!c?.connected) return reject(Error("Broker nicht verbunden."));
      c.publish(topic, payload, { qos: Number(qos), retain }, done);
    });
  }
  demo(sample = false) {
    this.demoTick++;
    const vals = [
      (21.4 + Math.sin(this.demoTick / 5) * 0.6).toFixed(1),
      Math.round(6420 + Math.sin(this.demoTick / 4) * 600),
      Math.round(46 + Math.sin(this.demoTick / 6) * 3),
      "ON",
      "online",
      Math.round(78 + Math.sin(this.demoTick / 8) * 2),
    ];
    const b = this.state.brokers.find((b) => b.id === "demo");
    if (!b) return;
    demoTopics.forEach((topic, i) => {
      if (i === 3 && this.latest.has("demo\0" + topic)) return;
      if (
        sample ||
        b.subscriptions.some((s) => !s.paused && matches(s.topic, topic))
      )
        this.receive(
          "demo",
          topic,
          String(vals[i]),
          { qos: 1, retain: true },
          "IN",
          Date.now(),
          sample,
        );
    });
  }
  startRecording(name) {
    if (this.recordings.length >= 10)
      throw Error(
        "Maximal 10 Aufzeichnungen. Vorhandene exportieren und löschen.",
      );
    this.recording = { id: uid(), name, started: Date.now(), messages: [] };
    this.emit("change");
  }
  stopRecording() {
    if (!this.recording) return;
    this.recording.ended = Date.now();
    this.recordings.push(this.recording);
    this.persist();
    this.recording = null;
    this.emit("change");
  }
  deleteRecording(id) {
    this.recordings = this.recordings.filter((r) => r.id !== id);
    this.persist();
    this.emit("change");
  }
  clearHistory() {
    this.history = [];
    this.historyBytes = 0;
    this.latest.clear();
    this.counts.clear();
    this.persist();
    this.emit("change");
  }
  async runRules(m) {
    for (const r of this.state.rules) {
      if (
        !r.enabled ||
        r.broker !== m.broker ||
        !matches(r.topic, m.topic) ||
        (m.retain && !r.allowRetain)
      )
        continue;
      const v = fieldValue(m.payload, r.field);
      const n = Number(v);
      const ok =
        r.operator === "any" ||
        (r.operator === "eq"
          ? String(v) === r.value
          : r.operator === "contains"
            ? String(v ?? "").includes(r.value)
            : v !== undefined &&
              String(v).trim() !== "" &&
              Number.isFinite(n) &&
              (r.operator === "gt"
                ? n > Number(r.value)
                : n < Number(r.value)));
      if (
        !ok ||
        Date.now() - (this.ruleTimes.get(r.id) || 0) <
          Math.max(1000, r.cooldown * 1000)
      )
        continue;
      this.ruleTimes.set(r.id, Date.now());
      try {
        if (r.action === "publish")
          await this.publish(
            r.targetBroker || r.broker,
            r.target,
            r.payload,
            r.qos || 0,
            false,
          );
        if (
          r.action === "notify" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          const sw = await navigator.serviceWorker?.getRegistration();
          if (sw)
            await sw.showNotification(r.name, {
              body: m.topic + ": " + m.payload.slice(0, 180),
              tag: r.id,
            });
          else new Notification(r.name, { body: m.payload.slice(0, 180) });
        }
        if (r.action === "http") {
          const u = new URL(r.target);
          if (u.protocol !== "https:")
            throw Error("HTTP-Regeln benötigen HTTPS.");
          const response = await fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: m.topic,
              payload: m.payload,
              broker: m.broker,
              time: m.time,
            }),
            credentials: "omit",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw Error("HTTP " + response.status);
        }
        this.emit("rule", r.name);
      } catch (e) {
        this.emit("error", `Regel ${r.name}: ${e.message}`);
      }
    }
  }
}
