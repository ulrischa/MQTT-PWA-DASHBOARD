import { setupInstall } from "./pwa.js";
import {
  Engine,
  uid,
  validTopic,
  matches,
  fieldValue,
  initialState,
} from "./core.js";
import {
  openVault,
  unlock,
  createVault,
  exportVault,
  restoreVault,
  changePassword,
  lockVault,
} from "./vault.js";
let engine;
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const topicColor = (topic) => {
  let hash = 0;
  for (const character of topic)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return ["#a9d6c7", "#8ecce5", "#e4cc93", "#c9b0e4", "#a9d987"][
    Math.abs(hash) % 5
  ];
};
const names = {
  dashboard: "Dashboard",
  explorer: "Topic Explorer",
  messages: "Live-Nachrichten",
  publish: "Publish",
  subscriptions: "Subscriptions",
  history: "History",
  rules: "Regeln",
  recordings: "Aufzeichnungen",
  brokers: "Broker",
};
const symbols = ["▦", "⌘", "≋", "↗", "⊞", "◷", "⌁", "⊙", "▤"];
let view = "dashboard",
  filter = { broker: "", topic: "", payload: "", from: "", to: "" },
  paused = false,
  frozen = [],
  page = 0,
  toastTimer,
  renderTimer,
  replayTimer,
  replayStopped = true;
const state = () => engine.state,
  bname = (id) => state().brokers.find((b) => b.id === id)?.name || id,
  btn = (action, label, extra = "", cls = "") =>
    `<button data-action="${action}" ${extra} class="${cls}">${label}</button>`,
  options = (items, val) =>
    items
      .map((x) => {
        const [v, l] = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
      })
      .join(""),
  brokerOptions = (v, all = false) =>
    options(
      [
        ...(all ? [["", "Alle Broker"]] : []),
        ...state().brokers.map((b) => [b.id, b.name]),
      ],
      v,
    ),
  input = (label, name, value = "", type = "text", attrs = "") =>
    `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`,
  select = (label, name, items, value) =>
    `<label>${label}<select name="${name}">${options(items, value)}</select></label>`,
  brokerSelect = (v, name = "broker") =>
    `<label>Broker<select name="${name}">${brokerOptions(v)}</select></label>`,
  check = (label, name, value = false) =>
    `<label class="check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}>${label}</label>`,
  empty = (title, text) =>
    `<div class="empty"><strong>${title}</strong>${text}</div>`,
  time = (t) => new Date(t).toLocaleTimeString("de-DE"),
  latest = (w) => engine.latest.get(w.broker + "\0" + w.topic),
  value = (w) => fieldValue(latest(w)?.payload ?? "", w.field);
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 5000);
}
function modal(title, body) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal").showModal();
}
function form(title, body, submit, footer = "") {
  modal(
    title,
    `<form id="editor">${body}<div class="form-actions">${footer}${btn("close", "Abbrechen", 'type="button"')}<button class="primary" type="submit">Speichern</button></div></form>`,
  );
  $("#editor").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await submit(new FormData(e.target));
      $("#modal").close();
      engine.save();
      render();
    } catch (err) {
      toast(err.message);
    }
  };
}
function download(name, data, type = "application/json") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob(
        [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
        { type },
      ),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderSidebar() {
  $("#nav").innerHTML = Object.entries(names)
    .map(([k, v], i) =>
      btn(
        "view",
        `<span class="nav-icon">${symbols[i]}</span>${v}`,
        `data-view="${k}" ${view === k ? 'aria-current="page"' : ""}`,
        view === k ? "active" : "",
      ),
    )
    .join("");
  $("#brokers").innerHTML = state()
    .brokers.map(
      (b) =>
        `<div class="broker-row"><span class="dot ${engine.status.get(b.id) === "Verbunden" ? "on" : ""}"></span>${btn("connect", `${esc(b.name)}<small>${esc(engine.status.get(b.id) || "Getrennt")}</small>`, `data-id="${b.id}"`)}${btn("broker-edit", "⋯", `data-id="${b.id}" aria-label="${esc(b.name)} bearbeiten"`, "edit")}</div>`,
    )
    .join("");
  $("#favorites").innerHTML = state().favorites.length
    ? state()
        .favorites.map((f) =>
          btn(
            "favorite-open",
            `☆ ${esc(f.topic)}`,
            `data-id="${f.id}"`,
            "favorite",
          ),
        )
        .join("")
    : '<small style="padding:10px">Noch keine Favoriten</small>';
  $("#connection-summary").textContent =
    [...engine.status.values()].filter((s) => s === "Verbunden").length +
    " verbunden";
  $("#demo-banner").hidden = !state().brokers.some((b) => b.id === "demo");
  $("#demo-banner button").textContent =
    engine.status.get("demo") === "Verbunden" ? "Demo stoppen" : "Demo starten";
}
function stats() {
  const live = [...engine.status.values()].filter(
    (s) => s === "Verbunden",
  ).length;
  const n = engine.history.filter(
    (m) => m.direction === "IN" && Date.now() - m.time < 60000 && !m.sample,
  ).length;
  return `<div class="stats"><div class="stat"><div class="stat-label">Verbundene Broker</div><div class="value">${live} <small style="display:inline;font-size:16px">/ ${state().brokers.length}</small></div><small>WebSocket-Verbindungen</small></div><div class="stat"><div class="stat-label">Beobachtete Topics</div><div class="value">${engine.latest.size}</div><small>Über alle Broker</small></div><div class="stat"><div class="stat-label">Nachrichten / Minute</div><div class="value">${n}</div><small>Empfang in den letzten 60 s</small></div><div class="stat"><div class="stat-label">Lokale History</div><div class="value">${engine.history.length.toLocaleString("de-DE")}</div><small>Max. ${state().settings.maxHistory.toLocaleString("de-DE")} Nachrichten</small></div></div>`;
}
function spark(w) {
  const nums = engine.history
    .filter(
      (m) =>
        m.broker === w.broker && m.topic === w.topic && m.direction === "IN",
    )
    .slice(-40)
    .map((m) => Number(fieldValue(m.payload, w.field)))
    .filter(Number.isFinite);
  if (nums.length < 2)
    return '<div class="chart muted"><small>Verlauf erscheint nach weiteren Nachrichten.</small></div>';
  const min = Math.min(...nums),
    max = Math.max(...nums),
    span = max - min || 1;
  return `<svg class="chart" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Verlauf der letzten ${nums.length} Messwerte, Minimum ${min}, Maximum ${max}"><path class="gridline" d="M0 20H300 M0 50H300"/><polyline points="${nums.map((n, i) => `${(i / (nums.length - 1)) * 300},${60 - ((n - min) / span) * 50}`).join(" ")}"/></svg>`;
}
function widget(w) {
  const m = latest(w),
    v = value(w),
    num = Number(v),
    display = v === "" || v === undefined ? "—" : v;
  let body = "";
  if (w.type === "switch")
    body = `<div class="switch-row"><span>${v === w.on ? "Eingeschaltet" : v === w.off ? "Ausgeschaltet" : "Status unbekannt"}</span><button class="switch ${v === w.on ? "on" : ""}" data-action="widget-send" data-id="${w.id}" aria-label="${esc(w.title)} umschalten"><i></i></button></div>`;
  else if (w.type === "button")
    body = `<div style="margin:30px 0">${btn("widget-send", esc(w.on || "Senden"), `data-id="${w.id}"`, "primary")}</div>`;
  else {
    body = `<div class="widget-value ${w.type === "status" && v === w.on ? "green" : ""}">${esc(display)}<span class="unit">${esc(w.unit)}</span></div>`;
    if (w.type === "chart") body += spark(w);
    else if (w.type === "gauge")
      body += `<div class="gauge"><span style="width:${Number.isFinite(num) && display !== "—" ? Math.min(100, Math.max(0, ((num - w.min) / (w.max - w.min)) * 100)) : 0}%"></span></div><div class="widget-foot"><span>${esc(w.min)} ${esc(w.unit)}</span><span>${esc(w.max)} ${esc(w.unit)}</span></div>`;
    else body += '<div style="height:35px"></div>';
  }
  return `<article class="card"><div class="card-head"><h2>${esc(w.title)}</h2>${btn("widget-edit", "⋯", `data-id="${w.id}" aria-label="${esc(w.title)} bearbeiten"`)}</div><div class="topic-label">${esc(w.topic || w.command)}</div>${body}<div class="widget-foot" style="margin-top:16px"><span>${esc(bname(w.broker))}</span><span>${m ? (m.sample ? "Demo-Beispiel" : time(m.time)) : "Warte auf Daten"}</span></div></article>`;
}
function table(messages, compact = false) {
  return messages.length
    ? `<div class="table-scroll"><table><thead><tr><th>Zeit</th><th>Topic</th><th>Payload</th>${compact ? "" : "<th>Broker</th><th>QoS / Retain</th>"}<th></th></tr></thead><tbody>${messages.map((m) => `<tr><td class="mono">${time(m.time)}</td><td class="topic mono" style="color:${topicColor(m.topic)}" title="${esc(m.topic)}">${esc(m.topic)}</td><td class="mono" title="${esc(m.payload.slice(0, 500))}">${esc(m.payload.slice(0, 150))}</td>${compact ? "" : `<td>${esc(bname(m.broker))}</td><td>${m.qos} / ${m.retain ? "ja" : "nein"} <span class="badge ${m.direction === "OUT" ? "blue" : ""}">${m.direction}</span></td>`}<td>${btn("message-detail", "↗", `data-id="${m.key}" aria-label="Nachricht öffnen"`)}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "Noch keine Nachrichten",
        "Broker verbinden und ein Topic abonnieren.",
      );
}
function tree(messages) {
  messages = messages.slice(0, 500);
  const split = (t) => {
    const parts = t.split("/");
    return parts.length > 16
      ? [...parts.slice(0, 15), parts.slice(15).join("/")]
      : parts;
  };
  const root = new Map();
  for (const m of messages) {
    let node = root;
    for (const part of split(m.topic)) {
      if (!node.has(part))
        node.set(part, { children: new Map(), messages: [] });
      const n = node.get(part);
      node = n.children;
    }
    let n = root;
    const parts = split(m.topic);
    for (let i = 0; i < parts.length; i++) {
      const item = n.get(parts[i]);
      if (i === parts.length - 1) item.messages.push(m);
      n = item.children;
    }
  }
  const draw = (node) =>
    [...node]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([part, n]) =>
          `<details open><summary>${esc(part || "(leer)")}</summary>${n.messages.map((m) => btn("topic-detail", esc(m.payload.slice(0, 65)) || "(leere Payload)", `data-broker="${esc(m.broker)}" data-topic="${esc(m.topic)}"`)).join("")}${draw(n.children)}</details>`,
      )
      .join("");
  return `<div class="tree">${draw(root) || "Keine Topics beobachtet."}</div>`;
}
function filters() {
  return `<div class="toolbar"><label>Broker<select id="filter-broker">${brokerOptions(filter.broker, true)}</select></label><label>Topic / Wildcard<input id="filter-topic" placeholder="home/#" value="${esc(filter.topic)}"></label><label>Payload durchsuchen<input id="filter-payload" placeholder="Suchen …" value="${esc(filter.payload)}"></label>${view === "history" ? `<label>Von<input id="filter-from" type="datetime-local" value="${esc(filter.from)}"></label><label>Bis<input id="filter-to" type="datetime-local" value="${esc(filter.to)}"></label>` : ""}</div>`;
}
function filtered() {
  return (paused && view === "messages" ? frozen : engine.history).filter(
    (m) =>
      (!filter.broker || m.broker === filter.broker) &&
      (!filter.topic ||
        (filter.topic.includes("#") || filter.topic.includes("+")
          ? matches(filter.topic, m.topic)
          : m.topic.includes(filter.topic))) &&
      (!filter.payload ||
        m.payload.toLowerCase().includes(filter.payload.toLowerCase())) &&
      (!filter.from || m.time >= new Date(filter.from).getTime()) &&
      (!filter.to || m.time <= new Date(filter.to).getTime()),
  );
}
function render() {
  renderSidebar();
  $("#view-name").textContent = names[view];
  $("#title").textContent = names[view];
  $("#subtitle").textContent = {
    dashboard: "Deine Geräte. Deine Daten. Alles im Blick.",
    explorer: "Topics entdecken, Zustände prüfen und Favoriten speichern.",
    messages: "Eingehende und gesendete Nachrichten in Echtzeit.",
    publish: "Nachrichten senden und häufige Befehle speichern.",
    subscriptions: "Bestimme, welche Topics du empfängst.",
    history:
      "Deine empfangenen und gesendeten Nachrichten – lokal gespeichert.",
    rules: "Automationen laufen, solange die App aktiv ist.",
    recordings: "Nachrichten aufzeichnen und kontrolliert erneut senden.",
    brokers: "Mehrere Verbindungen. Ein Workspace.",
  }[view];
  $("#page-actions").innerHTML = {
    dashboard: btn("widget-add", "＋ Widget hinzufügen", "", "primary"),
    explorer: btn("discovery", "＋ Topic Discovery"),
    messages: btn("pause", paused ? "▶ Fortsetzen" : "Ⅱ Anzeige pausieren"),
    publish: "",
    subscriptions: btn("subscription-add", "＋ Subscription", "", "primary"),
    history: btn("history-clear", "History löschen", "", "danger"),
    rules: btn("rule-add", "＋ Regel erstellen", "", "primary"),
    recordings: btn(
      engine.recording ? "record-stop" : "record-start",
      engine.recording ? "■ Aufnahme beenden" : "● Aufnahme starten",
      "",
      engine.recording ? "danger" : "primary",
    ),
    brokers: btn("broker-add", "＋ Broker hinzufügen", "", "primary"),
  }[view];
  let html = "";
  if (view === "dashboard")
    html =
      stats() +
      `<div class="section-head"><h2>Meine Widgets <small>${state().widgets.length} Widgets</small></h2><small>Letzter bekannter Zustand</small></div><div class="widgets">${state().widgets.map(widget).join("") || empty("Dein Dashboard ist bereit", "Lege dein erstes Widget an.")}</div><div class="bottom-grid"><section class="panel"><div class="panel-title"><h2>Letzte Nachrichten</h2>${btn("view", "Alle ansehen →", 'data-view="messages"')}</div>${table(engine.history.slice(-5).reverse(), true)}</section><section class="panel"><div class="panel-title"><h2>Topic Explorer</h2>${btn("view", "Öffnen →", 'data-view="explorer"')}</div>${tree([...engine.latest.values()].slice(0, 8))}</section></div>`;
  if (view === "messages" || view === "history") {
    const data = filtered().slice().reverse(),
      pages = Math.ceil(data.length / 100);
    page = Math.max(0, Math.min(page, pages - 1));
    html =
      filters() +
      `<div class="toolbar">${btn("export-json", "↓ JSON")}${btn("export-csv", "↓ CSV")}<small>${data.length} Nachrichten${paused ? " · Anzeige pausiert, Empfang läuft weiter" : ""}</small>${view === "messages" ? `<label class="check" style="flex:0;min-width:180px"><input id="autoscroll" type="checkbox" ${state().settings.autoscroll ? "checked" : ""}>Neueste zuerst</label>` : ""}</div><section class="panel">${table(data.slice(page * 100, page * 100 + 100))}</section><div class="section-head">${btn("page-prev", "← Zurück", page === 0 ? "disabled" : "")}<small>Seite ${page + 1} / ${Math.max(1, pages)} · 100 je Seite</small>${btn("page-next", "Weiter →", page >= pages - 1 ? "disabled" : "")}</div>`;
  }
  if (view === "explorer")
    html =
      filters() +
      `<div class="two-col"><section class="panel"><div class="panel-title"><h2>Topic-Baum</h2><span class="badge">${engine.latest.size} Topics</span></div>${tree([...engine.latest.values()].filter((m) => (!filter.broker || m.broker === filter.broker) && (!filter.topic || m.topic.includes(filter.topic)) && (!filter.payload || m.payload.includes(filter.payload))))}</section><div class="card"><h2>Topic Discovery</h2><p style="margin-top:12px">Abonniere <code>#</code>, um alle freigegebenen Topics zu beobachten. Für System-Topics zusätzlich <code>$SYS/#</code> abonnieren.</p><p>Der Baum zeigt empfangene Topics. MQTT liefert kein vollständiges Verzeichnis aller vorhandenen Topics.</p>${btn("discovery", "Discovery starten", "", "primary")}</div></div>`;
  if (view === "publish") html = publishView();
  if (view === "subscriptions")
    html = `<section class="panel">${
      state()
        .brokers.flatMap((b) =>
          (b.subscriptions || []).map(
            (s, i) =>
              `<div class="list-row"><div><strong class="mono">${esc(s.topic)}</strong><p>${esc(b.name)} · QoS ${s.qos} · ${s.paused ? "Pausiert" : "Aktiv"}</p></div><div class="list-actions">${btn("subscription-toggle", s.paused ? "Fortsetzen" : "Pausieren", `data-id="${b.id}" data-index="${i}"`)}${btn("subscription-delete", "Entfernen", `data-id="${b.id}" data-index="${i}"`)}</div></div>`,
          ),
        )
        .join("") ||
      empty(
        "Keine Subscriptions",
        "Abonniere ein Topic, um Nachrichten zu empfangen.",
      )
    }</section>`;
  if (view === "brokers")
    html = `<div class="toolbar">${btn("config-export", "↓ Konfiguration exportieren")}${btn("config-import", "↑ Konfiguration importieren")}</div><section class="panel">${
      state()
        .brokers.map(
          (b) =>
            `<div class="list-row"><div><strong>${esc(b.name)}</strong><p class="mono">${esc(b.url)}</p><span class="badge">${esc(engine.status.get(b.id) || "Getrennt")}</span></div><div class="list-actions">${btn("connect", engine.status.get(b.id) === "Verbunden" || engine.clients.has(b.id) ? "Trennen" : "Verbinden", `data-id="${b.id}"`)}${btn("broker-edit", "Bearbeiten", `data-id="${b.id}"`)}${btn("broker-copy", "Duplizieren", `data-id="${b.id}" ${b.id === "demo" ? "disabled" : ""}`)}</div></div>`,
        )
        .join("") ||
      empty(
        "Noch kein Broker",
        "Füge die WebSocket-Adresse deines Brokers hinzu.",
      )
    }</section>`;
  if (view === "rules")
    html = `<div class="notice">Regeln reagieren nur auf neue empfangene Nachrichten. Retained-Werte sind standardmäßig ausgeschlossen. Mindestens 1 s Pause zwischen Ausführungen schützt vor Schleifen.</div><section class="panel">${
      state()
        .rules.map(
          (r) =>
            `<div class="list-row"><div><strong>${esc(r.name)}</strong><p><code>${esc(r.topic)}</code> · ${esc(bname(r.broker))} → ${esc(r.action)}</p><small>${r.enabled ? "Aktiv" : "Deaktiviert"} · ${r.cooldown}s Abklingzeit</small></div><div class="list-actions">${btn("rule-toggle", r.enabled ? "Deaktivieren" : "Aktivieren", `data-id="${r.id}"`)}${btn("rule-edit", "Bearbeiten", `data-id="${r.id}"`)}</div></div>`,
        )
        .join("") ||
      empty(
        "Noch keine Regeln",
        "Lasse einen Wert einen MQTT-Befehl oder eine Benachrichtigung auslösen.",
      )
    }</section>`;
  if (view === "recordings")
    html = `${!replayStopped ? `<div class="banner">Replay läuft ${btn("replay-stop", "■ Replay stoppen")}</div>` : ""}${engine.recording ? `<div class="notice recording">● ${esc(engine.recording.name)} · ${engine.recording.messages.length} Nachrichten · maximal 10.000 / 5 MB</div>` : ""}<div class="toolbar">${btn("record-import", "↑ Aufzeichnung importieren")}</div><section class="panel">${engine.recordings.map((r) => `<div class="list-row"><div><strong>${esc(r.name)}</strong><p>${r.messages.length} Nachrichten · ${new Date(r.started).toLocaleString("de-DE")}</p></div><div class="list-actions">${btn("replay", "▶ Replay", `data-id="${r.id}" ${!r.messages.length ? "disabled" : ""}`)}${btn("record-export", "↓ JSON", `data-id="${r.id}"`)}${btn("record-delete", "Löschen", `data-id="${r.id}"`)}</div></div>`).join("") || empty("Keine Aufzeichnungen", "Starte eine Aufnahme und empfange MQTT-Nachrichten.")}</section>`;
  $("#content").innerHTML = html;
  bindView();
}
function bindView() {
  for (const key of ["broker", "topic", "payload", "from", "to"]) {
    const el = $("#filter-" + key);
    if (el)
      el.addEventListener("change", () => {
        filter[key] = el.value;
        page = 0;
        render();
      });
  }
  if ($("#autoscroll"))
    $("#autoscroll").onchange = (e) => {
      state().settings.autoscroll = e.target.checked;
      engine.save();
    };
  if ($("#publish-form"))
    $("#publish-form").onsubmit = async (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      try {
        if (d.get("format") === "json") JSON.parse(d.get("payload"));
        await engine.publish(
          d.get("broker"),
          d.get("topic"),
          d.get("payload"),
          +d.get("qos"),
          d.has("retain"),
        );
        state().recentTopics = [
          d.get("topic"),
          ...(state().recentTopics || []).filter((t) => t !== d.get("topic")),
        ].slice(0, 20);
        engine.save();
        toast("Nachricht gesendet.");
      } catch (err) {
        toast(err.message);
      }
    };
}
function publishView() {
  return `<div class="two-col"><form id="publish-form" class="card"><h2 style="margin-bottom:22px">Nachricht senden</h2>${brokerSelect(filter.broker || state().brokers[0]?.id)}${input("Topic", "topic", "", "text", 'required list="recent-topics" placeholder="home/light/set"')}<datalist id="recent-topics">${(state().recentTopics || []).map((t) => `<option value="${esc(t)}">`).join("")}</datalist><div class="form-grid">${select(
    "Payload-Format",
    "format",
    [
      ["text", "Text"],
      ["json", "JSON"],
    ],
    "text",
  )}${select("Quality of Service", "qos", [0, 1, 2], 0)}</div><label>Payload<textarea name="payload" placeholder='{"state":"ON"}'></textarea></label>${check("Retain – als letzten Zustand am Broker speichern", "retain")}<div class="form-actions">${btn("json-format", "JSON formatieren", 'type="button"')}${btn("preset-save", "Als Preset speichern", 'type="button"')}<button class="primary" type="submit">Nachricht senden ↗</button></div></form><section class="panel"><div class="panel-title"><h2>Gespeicherte Nachrichten</h2><small>Presets</small></div>${
    state()
      .presets.map(
        (p) =>
          `<div class="list-row"><div><strong>${esc(p.name)}</strong><p class="mono">${esc(p.topic)}</p></div><div class="list-actions">${btn("preset-load", "Laden", `data-id="${p.id}"`)}${btn("preset-delete", "×", `data-id="${p.id}" aria-label="Preset löschen"`)}</div></div>`,
      )
      .join("") ||
    empty("Wiederkehrende Befehle", "Speichere deine Nachricht als Preset.")
  }</section></div>`;
}
function brokerForm(id) {
  const old = state().brokers.find((b) => b.id === id),
    b = old || {
      name: "",
      url: "wss://",
      clientId: "mqtt-pwa-" + uid().slice(0, 8),
      version: 4,
      keepalive: 60,
      reconnect: true,
      rememberPassword: true,
    };
  if (id === "demo") {
    modal(
      "Demo-Broker",
      `<p>Simulierter Broker zum Ausprobieren. Sendet ausschließlich lokale Beispieldaten.</p>${btn("broker-delete", "Demo-Broker und seine Widgets entfernen", 'data-id="demo"', "danger")}`,
    );
    return;
  }
  form(
    old ? "Broker bearbeiten" : "Broker hinzufügen",
    `<div class="form-grid">${input("Name", "name", b.name, "text", 'required maxlength="80"')}${input("WebSocket-URL inkl. Port und Pfad", "url", b.url, "url", 'required placeholder="wss://mqtt.example.org:8084/mqtt"')}${input("Benutzername", "username", b.username, "text", 'autocomplete="off"')}${input("Passwort", "password", engine.passwords.get(b.id) || b.password || "", "password", 'autocomplete="new-password"')}${input("Client-ID (stabil und eindeutig)", "clientId", b.clientId, "text", 'required maxlength="128"')}${select(
      "MQTT-Version",
      "version",
      [
        [4, "3.1.1"],
        [5, "5.0"],
      ],
      b.version,
    )}${input("Keepalive (Sekunden)", "keepalive", b.keepalive, "number", 'min="5" max="65535" required')}</div>${check("Automatisch wiederverbinden", "reconnect", b.reconnect)}${check("Persistente Session (MQTT 5: 24 h Ablauf)", "persistent", b.persistent)}${check("Passwort im verschlüsselten Tresor speichern", "rememberPassword", b.rememberPassword)}<p class="notice">HTTPS benötigt wss:// mit gültigem Zertifikat. Ein normaler MQTT-Port (1883/8883) reicht nicht. Nach dem Speichern testet „Verbinden“ den Broker.</p>`,
    (d) => {
      const url = new URL(d.get("url"));
      if (
        !["ws:", "wss:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error(
          "Gültige ws:// oder wss:// URL ohne eingebettete Zugangsdaten erforderlich.",
        );
      if (old) engine.disconnect(id);
      const updated = {
        id: old?.id || uid(),
        name: d.get("name"),
        url: url.href,
        username: d.get("username"),
        password: d.has("rememberPassword") ? d.get("password") : undefined,
        rememberPassword: d.has("rememberPassword"),
        clientId: d.get("clientId"),
        version: +d.get("version"),
        keepalive: +d.get("keepalive"),
        reconnect: d.has("reconnect"),
        persistent: d.has("persistent"),
        subscriptions: old?.subscriptions || [],
      };
      engine.passwords.set(updated.id, d.get("password"));
      if (old) state().brokers[state().brokers.indexOf(old)] = updated;
      else state().brokers.push(updated);
    },
    old
      ? btn(
          "broker-delete",
          "Löschen",
          `type="button" data-id="${id}"`,
          "danger",
        )
      : "",
  );
}
function widgetForm(id, prefill = {}) {
  const old = state().widgets.find((w) => w.id === id),
    w = old || {
      broker: state().brokers[0]?.id,
      type: "value",
      min: 0,
      max: 100,
      on: "ON",
      off: "OFF",
      qos: 1,
      ...prefill,
    };
  form(
    old ? "Widget bearbeiten" : "Widget hinzufügen",
    `<div class="form-grid">${input("Titel", "title", w.title, "text", 'required maxlength="100"')}${brokerSelect(w.broker)}${select(
      "Widget-Typ",
      "type",
      [
        ["value", "Wert"],
        ["text", "Text"],
        ["chart", "Diagramm"],
        ["gauge", "Gauge"],
        ["json", "JSON-Feld"],
        ["status", "Statusampel"],
        ["switch", "Schalter"],
        ["button", "Button"],
      ],
      w.type,
    )}${input("Zustands-Topic", "topic", w.topic, "text", 'placeholder="home/temperature"')}${input("JSON-Feld (optional, z. B. sensor.temp)", "field", w.field)}${input("Einheit", "unit", w.unit)}${input("Minimum (Gauge)", "min", w.min, "number", 'step="any" required')}${input("Maximum (Gauge)", "max", w.max, "number", 'step="any" required')}${input("Befehls-Topic (Schalter / Button)", "command", w.command)}${input("ON-Payload / grüner Statuswert", "on", w.on)}${input("OFF-Payload", "off", w.off)}${select("QoS für Befehle", "qos", [0, 1, 2], w.qos || 0)}</div><p class="notice">Das Zustands-Topic wird beim Speichern automatisch abonniert. Schalter zeigen den empfangenen Zustand, nicht nur den zuletzt gesendeten Befehl.</p>`,
    (d) => {
      const n = Object.fromEntries(d);
      n.min = +n.min;
      n.max = +n.max;
      n.qos = +n.qos;
      n.id = old?.id || uid();
      if (!state().brokers.some((b) => b.id === n.broker))
        throw Error("Zuerst Broker anlegen.");
      if (n.type !== "button" && !validTopic(n.topic))
        throw Error("Gültiges Zustands-Topic erforderlich.");
      if (["button", "switch"].includes(n.type) && !validTopic(n.command))
        throw Error("Gültiges Befehls-Topic erforderlich.");
      if (n.type === "gauge" && n.max <= n.min)
        throw Error("Maximum muss größer als Minimum sein.");
      if (old) state().widgets[state().widgets.indexOf(old)] = n;
      else state().widgets.push(n);
      if (n.topic) addSubscription(n.broker, n.topic, 1);
    },
    old
      ? btn(
          "widget-delete",
          "Löschen",
          `type="button" data-id="${id}"`,
          "danger",
        )
      : "",
  );
}
function addSubscription(id, topic, qos) {
  if (!validTopic(topic, true)) throw Error("Ungültiger Topic-Filter.");
  const b = state().brokers.find((b) => b.id === id);
  if (!b) throw Error("Broker fehlt.");
  b.pendingUnsubscribe = (b.pendingUnsubscribe || []).filter(
    (t) => t !== topic,
  );
  const existing = b.subscriptions.find((s) => s.topic === topic);
  if (existing) {
    if (existing.paused) {
      existing.paused = false;
      engine.subscribe(b, existing);
    }
    return;
  }
  const s = { topic, qos: +qos, paused: false };
  b.subscriptions.push(s);
  engine.subscribe(b, s);
  engine.save();
}
function subscriptionForm(discovery = false) {
  form(
    discovery ? "Topic Discovery starten" : "Subscription hinzufügen",
    `${brokerSelect(filter.broker || state().brokers[0]?.id)}${input("Topic-Filter", "topic", discovery ? "#" : "", "text", 'required placeholder="home/+/temperature"')}${select("QoS", "qos", [0, 1, 2], 1)}<p class="notice">+ ersetzt genau eine Ebene, # alle verbleibenden Ebenen. Discovery kann viele Nachrichten empfangen.</p>`,
    (d) => addSubscription(d.get("broker"), d.get("topic"), d.get("qos")),
  );
}
function ruleForm(id) {
  const old = state().rules.find((r) => r.id === id),
    r = old || {
      broker: state().brokers[0]?.id,
      operator: "gt",
      action: "notify",
      cooldown: 30,
      enabled: false,
    };
  form(
    old ? "Regel bearbeiten" : "Regel erstellen",
    `<div class="form-grid">${input("Name", "name", r.name, "text", "required")}${brokerSelect(r.broker)}${input("Topic-Filter", "topic", r.topic, "text", "required")}${input("JSON-Feld (optional)", "field", r.field)}${select(
      "Bedingung",
      "operator",
      [
        ["gt", "Größer als"],
        ["lt", "Kleiner als"],
        ["eq", "Gleich"],
        ["contains", "Enthält"],
        ["any", "Jede Nachricht"],
      ],
      r.operator,
    )}${input("Vergleichswert", "value", r.value)}${select(
      "Aktion",
      "action",
      [
        ["notify", "Benachrichtigung"],
        ["publish", "MQTT Publish"],
        ["http", "HTTP POST (CORS erforderlich)"],
      ],
      r.action,
    )}${brokerSelect(r.targetBroker || r.broker, "targetBroker")}${input("Ziel-Topic oder HTTPS-URL", "target", r.target)}${input("Publish-Payload", "payload", r.payload)}${input("Abklingzeit in Sekunden", "cooldown", r.cooldown, "number", 'required min="1" max="86400"')}${select("Publish QoS", "qos", [0, 1, 2], r.qos || 0)}</div>${check("Regel aktivieren", "enabled", r.enabled)}${check("Auch retained Nachrichten auswerten", "allowRetain", r.allowRetain)}${btn("notify-permission", "Benachrichtigungen erlauben", 'type="button"')}<p class="notice">HTTP-Ziele müssen CORS erlauben. Es gibt keinen eingehenden HTTP-Endpoint ohne Backend. MQTT-Regeln können Geräte schalten; Abklingzeit und Topics bewusst wählen.</p>`,
    (d) => {
      const n = {
        ...Object.fromEntries(d),
        id: old?.id || uid(),
        enabled: d.has("enabled"),
        allowRetain: d.has("allowRetain"),
        cooldown: +d.get("cooldown"),
        qos: +d.get("qos"),
      };
      if (!validTopic(n.topic, true)) throw Error("Ungültiger Topic-Filter.");
      if (
        ["gt", "lt"].includes(n.operator) &&
        (!n.value.trim() || !Number.isFinite(Number(n.value)))
      )
        throw Error("Numerischer Vergleichswert erforderlich.");
      if (n.action === "publish" && !validTopic(n.target))
        throw Error("Ungültiges Ziel-Topic.");
      if (n.action === "http" && new URL(n.target).protocol !== "https:")
        throw Error("HTTPS-Ziel erforderlich.");
      if (old) state().rules[state().rules.indexOf(old)] = n;
      else state().rules.push(n);
      addSubscription(n.broker, n.topic, 1);
    },
    old
      ? btn("rule-delete", "Löschen", `type="button" data-id="${id}"`, "danger")
      : "",
  );
}
function detail(m) {
  if (!m) return toast("Nachricht nicht mehr in History.");
  let payload = m.payload;
  try {
    payload = JSON.stringify(JSON.parse(payload), null, 2);
  } catch {}
  const c = engine.counts.get(m.broker + "\0" + m.topic);
  modal(
    "Nachricht & Topic",
    `<p class="mono">${esc(m.topic)}</p><div class="notice">${esc(bname(m.broker))} · ${new Date(m.time).toLocaleString("de-DE")} · QoS ${m.qos} · Retain ${m.retain ? "ja" : "nein"} · ${m.direction}<br>${c ? `${c.count} empfangene Nachrichten in dieser History · Ø ${(c.count / Math.max(1, (c.last - c.first) / 1000)).toFixed(2)} / s` : ""}</div><pre>${esc(payload)}</pre><div class="form-actions">${btn("message-copy", "Kopieren", `data-id="${m.key}"`)}${btn("message-publish", "In Publish übernehmen", `data-id="${m.key}"`)}${btn("favorite-add", "☆ Favorit", `data-id="${m.key}"`)}${btn("topic-widget", "＋ Widget", `data-id="${m.key}"`)}</div>`,
  );
}
function settings() {
  form(
    "Einstellungen",
    `${input("Maximale History (100–20.000 Nachrichten)", "maxHistory", state().settings.maxHistory, "number", 'required min="100" max="20000"')}${select(
      "Bei inaktivem Tab automatisch sperren",
      "autoLock",
      [
        [0, "Nicht automatisch"],
        [1, "Nach 1 Minute"],
        [5, "Nach 5 Minuten"],
        [15, "Nach 15 Minuten"],
      ],
      state().settings.autoLock ?? 5,
    )}<p class="notice">AES-256-GCM · PBKDF2-SHA-256 (600.000 Iterationen). Einstellungen, gespeicherte Zugangsdaten, History und Aufzeichnungen liegen verschlüsselt in IndexedDB. Beim Sperren enden MQTT-Verbindungen und Regeln.</p><div class="toolbar">${btn("vault-export", "↓ Verschlüsseltes Backup", 'type="button"')}${btn("vault-password", "Master-Passwort ändern", 'type="button"')}${btn("lock", "🔒 Jetzt sperren", 'type="button"')}</div><p class="notice">Ein starkes, einzigartiges Master-Passwort schützt die ruhenden Daten. Ein entsperrter Browser, bösartige Erweiterungen oder Schadcode auf dem Gerät können weiterhin auf Daten zugreifen. Gelöschter Browserspeicher ist ohne Backup verloren.</p>`,
    (d) => {
      state().settings.maxHistory = +d.get("maxHistory");
      state().settings.autoLock = +d.get("autoLock");
      engine.history = engine.history.slice(-state().settings.maxHistory);
      engine.historyBytes = engine.history.reduce(
        (n, m) => n + m.payload.length * 2 + m.topic.length * 2 + 300,
        0,
      );
      engine.latest.clear();
      engine.counts.clear();
      engine.history.forEach((m) => engine.indexMessage(m));
    },
  );
}
function help() {
  modal(
    "MQTT-PWA-DASHBOARD",
    `<p>Reine JavaScript-PWA. Kein PHP, kein Serverprozess und keine zentrale Datenbank.</p><ol><li>Master-Passwort anlegen und verschlüsseltes Backup sichern.</li><li>Unter Broker deine ws:// oder wss:// Adresse hinzufügen.</li><li>Broker verbinden und Topics abonnieren.</li><li>Widgets und Regeln für deine Topics anlegen.</li></ol><p>Der Broker muss MQTT über WebSockets unterstützen. HTTPS-Seiten benötigen wss:// und ein gültiges Zertifikat. Ein entfernter Browser kann private Heimnetz-Adressen nicht erreichen.</p><p>Die App-Hülle ist nach dem ersten Laden offline nutzbar. MQTT-Empfang benötigt eine Verbindung. Geschlossene oder vom Betriebssystem angehaltene Apps empfangen nicht weiter. Echte Push-Nachrichten bei geschlossener App erfordern einen Hintergrunddienst.</p><p>Persistente Sessions verwenden eine stabile Client-ID. MQTT 5 erhält 24 h Session-Ablauf. Nachlieferung von QoS 1/2 hängt vom Broker ab; QoS 0 wird nicht zuverlässig nachgeliefert. Retain liefert nur den letzten gespeicherten Topic-Wert.</p><p>Die History ist begrenzt und kein verlustfreies Langzeitarchiv. Binäre Payloads werden als UTF-8 angezeigt. Replay sendet Text-Payloads ohne Retain.</p><a href="README.md" target="_blank" rel="noopener">Technische Dokumentation öffnen</a> · <a href="MQTT-PWA-DASHBOARD.zip" download>Quellcode herunterladen</a>`,
  );
}
async function importFile(kind) {
  const el = $("#import-file");
  el.value = "";
  el.onchange = async () => {
    try {
      const f = el.files[0];
      if (!f) return;
      if (f.size > 50000000) throw Error("Datei maximal 50 MB.");
      const text = await f.text();
      if (kind === "vault") {
        if (
          !confirm(
            "Vorhandenen Tresor durch dieses verschlüsselte Backup ersetzen?",
          )
        )
          return;
        await restoreVault(text);
        location.reload();
        return;
      }
      const d = JSON.parse(text);
      if (kind === "record") {
        if (engine.recordings.length >= 10)
          throw Error("Maximal 10 Aufzeichnungen.");
        if (
          !Array.isArray(d.messages) ||
          d.messages.length > 10000 ||
          JSON.stringify(d.messages).length > 5000000 ||
          d.messages.some(
            (m) =>
              !validTopic(m.topic) ||
              typeof m.payload !== "string" ||
              m.payload.length > 262144 ||
              !Number.isFinite(m.time) ||
              ![0, 1, 2].includes(m.qos),
          )
        )
          throw Error("Ungültige Aufzeichnung.");
        engine.recordings.push({
          id: uid(),
          name: String(d.name || "Import").slice(0, 100),
          started: Number(d.started) || Date.now(),
          messages: d.messages.map((m) => ({
            broker: String(m.broker),
            topic: m.topic,
            payload: m.payload,
            time: m.time,
            qos: m.qos,
            retain: !!m.retain,
          })),
        });
        engine.save();
        render();
        return;
      }
      if (d.version !== 1 || !Array.isArray(d.brokers) || d.brokers.length > 50)
        throw Error("Ungültige Konfiguration.");
      const imported = [];
      for (const b of d.brokers) {
        if (b.url === "demo://local") continue;
        const url = new URL(b.url);
        if (
          !["ws:", "wss:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error("Ungültige Broker-URL.");
        const subs = Array.isArray(b.subscriptions) ? b.subscriptions : [];
        if (
          subs.some(
            (s) => !validTopic(s.topic, true) || ![0, 1, 2].includes(+s.qos),
          )
        )
          throw Error("Ungültige Subscriptions.");
        imported.push({
          id: uid(),
          name: String(b.name || "Import").slice(0, 80),
          url: url.href,
          username: String(b.username || ""),
          clientId: "mqtt-pwa-" + uid().slice(0, 8),
          version: b.version === 5 ? 5 : 4,
          keepalive: Math.min(65535, Math.max(5, +b.keepalive || 60)),
          reconnect: !!b.reconnect,
          persistent: !!b.persistent,
          rememberPassword: true,
          subscriptions: subs.map((s) => ({
            topic: s.topic,
            qos: +s.qos,
            paused: !!s.paused,
          })),
        });
      }
      state().brokers.push(...imported);
      engine.save();
      render();
      toast(
        `${imported.length} Broker importiert. Passwörter erneut eingeben.`,
      );
    } catch (e) {
      toast(e.message);
    }
  };
  el.click();
}
function replayForm(id) {
  const r = engine.recordings.find((r) => r.id === id);
  form(
    "Aufzeichnung erneut senden",
    `<p>${esc(r.name)} · ${r.messages.length} Nachrichten</p>${brokerSelect(state().brokers[0]?.id)}${select(
      "Geschwindigkeit",
      "speed",
      [
        [0.5, "0,5×"],
        [1, "1× Originaltempo"],
        [2, "2×"],
        [5, "5×"],
      ],
      1,
    )}${input("Optionales Topic-Präfix", "prefix", "", "text", 'placeholder="replay/"')}<p class="notice">Replay sendet echte MQTT-Nachrichten und kann Geräte schalten oder Regeln auslösen. Retain wird immer deaktiviert. Nachrichten werden nacheinander mit mindestens 100 ms Abstand gesendet.</p>${check("Ich möchte diese Nachrichten tatsächlich senden", "confirm")}`,
    (d) => {
      if (!d.has("confirm")) throw Error("Senden ausdrücklich bestätigen.");
      const broker = d.get("broker");
      if (engine.status.get(broker) !== "Verbunden")
        throw Error("Ziel-Broker zuerst verbinden.");
      const messages = r.messages.slice().sort((a, b) => a.time - b.time),
        prefix = d.get("prefix");
      if (messages.some((m) => !validTopic(prefix + m.topic)))
        throw Error("Ungültiges Präfix.");
      replayStopped = false;
      let i = 0;
      const step = async () => {
        if (replayStopped) return;
        const m = messages[i];
        try {
          await engine.publish(
            broker,
            prefix + m.topic,
            m.payload,
            m.qos,
            false,
          );
        } catch (e) {
          replayStopped = true;
          toast(e.message);
          render();
          return;
        }
        i++;
        if (i === messages.length) {
          replayStopped = true;
          toast("Replay abgeschlossen.");
          render();
          return;
        }
        replayTimer = setTimeout(
          step,
          Math.max(
            100,
            Math.min(2147483647, (messages[i].time - m.time) / +d.get("speed")),
          ),
        );
      };
      step();
    },
  );
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action,
    id = el.dataset.id;
  try {
    if (a === "close") {
      $("#modal").close();
      return;
    }
    if (a === "install") {
      await installApp();
      return;
    }
    if (a === "vault-restore") {
      await importFile("vault");
      return;
    }
    if (!engine) return;
    if (a === "view") {
      view = el.dataset.view;
      page = 0;
      filter = { broker: "", topic: "", payload: "", from: "", to: "" };
      render();
    }
    if (a === "broker-add") brokerForm();
    if (a === "broker-edit") brokerForm(id);
    if (a === "broker-copy") {
      const b = state().brokers.find((b) => b.id === id);
      state().brokers.push({
        ...structuredClone(b),
        id: uid(),
        name: b.name + " Kopie",
        clientId: "mqtt-pwa-" + uid().slice(0, 8),
        password: undefined,
      });
      engine.save();
      render();
    }
    if (a === "broker-delete") {
      if (
        confirm(
          "Broker und zugehörige Widgets, Favoriten und Regeln entfernen?",
        )
      ) {
        engine.disconnect(id);
        state().brokers = state().brokers.filter((b) => b.id !== id);
        state().widgets = state().widgets.filter((w) => w.broker !== id);
        state().rules = state().rules.filter(
          (r) => r.broker !== id && r.targetBroker !== id,
        );
        state().favorites = state().favorites.filter((f) => f.broker !== id);
        $("#modal").close();
        engine.save();
        render();
      }
    }
    if (a === "connect" || a === "demo-toggle") {
      const b = state().brokers.find(
        (b) => b.id === (a === "demo-toggle" ? "demo" : id),
      );
      if (engine.status.get(b.id) === "Verbunden" || engine.clients.has(b.id))
        engine.disconnect(b.id);
      else engine.connect(b);
      render();
    }
    if (a === "widget-add") widgetForm();
    if (a === "widget-edit") widgetForm(id);
    if (a === "widget-delete") {
      state().widgets = state().widgets.filter((w) => w.id !== id);
      $("#modal").close();
      engine.save();
      render();
    }
    if (a === "widget-send") {
      const w = state().widgets.find((w) => w.id === id);
      await engine.publish(
        w.broker,
        w.command,
        w.type === "switch" && value(w) === w.on ? w.off : w.on,
        w.qos || 0,
        false,
      );
      toast("Befehl gesendet.");
    }
    if (a === "discovery") subscriptionForm(true);
    if (a === "subscription-add") subscriptionForm();
    if (a === "subscription-toggle" || a === "subscription-delete") {
      const b = state().brokers.find((b) => b.id === id),
        s = b.subscriptions[+el.dataset.index];
      await engine.toggleSubscription(b, s, a === "subscription-delete");
      render();
    }
    if (a === "pause") {
      paused = !paused;
      if (paused) frozen = engine.history.slice();
      render();
    }
    if (a === "page-prev") {
      page--;
      render();
    }
    if (a === "page-next") {
      page++;
      render();
    }
    if (a === "history-clear" && confirm("Gesamte lokale History löschen?")) {
      engine.clearHistory();
      render();
    }
    if (a === "message-detail")
      detail(
        engine.history.find((m) => m.key === id) ||
          frozen.find((m) => m.key === id),
      );
    if (a === "topic-detail")
      detail(engine.latest.get(el.dataset.broker + "\0" + el.dataset.topic));
    if (a === "message-copy") {
      await navigator.clipboard.writeText(
        engine.history.find((m) => m.key === id).payload,
      );
      toast("Payload kopiert.");
    }
    if (a === "message-publish") {
      const m = engine.history.find((m) => m.key === id);
      $("#modal").close();
      view = "publish";
      render();
      const f = $("#publish-form");
      for (const k of ["broker", "topic", "payload", "qos"])
        f.elements[k].value = m[k];
      f.elements.retain.checked = false;
    }
    if (a === "topic-widget") {
      const m = engine.history.find((m) => m.key === id);
      $("#modal").close();
      widgetForm(null, {
        broker: m.broker,
        topic: m.topic,
        title: m.topic.split("/").pop(),
      });
    }
    if (a === "favorite-add") {
      const m = engine.history.find((m) => m.key === id),
        old = state().favorites.find(
          (f) => f.broker === m.broker && f.topic === m.topic,
        );
      if (old) {
        state().favorites = state().favorites.filter((f) => f !== old);
        toast("Favorit entfernt.");
      } else {
        state().favorites.push({ id: uid(), broker: m.broker, topic: m.topic });
        toast("Favorit gespeichert.");
      }
      engine.save();
      renderSidebar();
    }
    if (a === "favorite-open") {
      const f = state().favorites.find((f) => f.id === id);
      view = "messages";
      filter = {
        broker: f.broker,
        topic: f.topic,
        payload: "",
        from: "",
        to: "",
      };
      render();
    }
    if (a === "json-format") {
      const f = $("#publish-form");
      f.elements.payload.value = JSON.stringify(
        JSON.parse(f.elements.payload.value),
        null,
        2,
      );
      f.elements.format.value = "json";
      toast("JSON gültig und formatiert.");
    }
    if (a === "preset-save") {
      const d = Object.fromEntries(new FormData($("#publish-form")));
      if (!validTopic(d.topic)) throw Error("Gültiges Topic eingeben.");
      form(
        "Preset speichern",
        input("Name", "name", "", "text", "required"),
        (data) => {
          state().presets.push({
            ...d,
            id: uid(),
            name: data.get("name"),
            retain: d.retain === "on",
          });
        },
      );
    }
    if (a === "preset-load") {
      const p = state().presets.find((p) => p.id === id),
        f = $("#publish-form");
      for (const k of ["broker", "topic", "payload", "qos", "format"])
        if (p[k] !== undefined) f.elements[k].value = p[k];
      f.elements.retain.checked = !!p.retain;
      toast("Preset geladen. Zum Senden bestätigen.");
    }
    if (a === "preset-delete") {
      state().presets = state().presets.filter((p) => p.id !== id);
      engine.save();
      render();
    }
    if (a === "export-json") download("mqtt-history.json", filtered());
    if (a === "export-csv") {
      const cell = (x) =>
        '"' +
        String(x ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replace(/"/g, '""') +
        '"';
      download(
        "mqtt-history.csv",
        "\uFEFF" +
          [
            ["Zeit", "Broker", "Topic", "Payload", "QoS", "Retain", "Richtung"],
            ...filtered().map((m) => [
              new Date(m.time).toISOString(),
              bname(m.broker),
              m.topic,
              m.payload,
              m.qos,
              m.retain,
              m.direction,
            ]),
          ]
            .map((row) => row.map(cell).join(";"))
            .join("\r\n"),
        "text/csv;charset=utf-8",
      );
    }
    if (a === "config-export") {
      if (
        confirm(
          "Broker-Konfiguration ohne Passwörter als unverschlüsselte JSON-Datei exportieren?",
        )
      )
        download("mqtt-brokers.json", {
          version: 1,
          brokers: state().brokers.map(({ password, ...b }) => b),
        });
    }
    if (a === "config-import") importFile("config");
    if (a === "rule-add") ruleForm();
    if (a === "rule-edit") ruleForm(id);
    if (a === "rule-toggle") {
      const r = state().rules.find((r) => r.id === id);
      r.enabled = !r.enabled;
      engine.save();
      render();
    }
    if (a === "rule-delete") {
      state().rules = state().rules.filter((r) => r.id !== id);
      $("#modal").close();
      engine.save();
      render();
    }
    if (a === "notify-permission") {
      if (!("Notification" in window))
        throw Error("Benachrichtigungen werden hier nicht unterstützt.");
      toast("Benachrichtigungen: " + (await Notification.requestPermission()));
    }
    if (a === "record-start")
      form(
        "Aufnahme starten",
        input(
          "Name",
          "name",
          "Aufnahme " + new Date().toLocaleString("de-DE"),
          "text",
          "required",
        ),
        (d) => engine.startRecording(d.get("name")),
      );
    if (a === "record-stop") {
      engine.stopRecording();
      render();
    }
    if (a === "record-export") {
      if (confirm("Aufzeichnung mit Payloads unverschlüsselt exportieren?"))
        download(
          "mqtt-recording.json",
          engine.recordings.find((r) => r.id === id),
        );
    }
    if (a === "record-import") importFile("record");
    if (a === "record-delete" && confirm("Aufzeichnung löschen?")) {
      engine.deleteRecording(id);
      render();
    }
    if (a === "replay") replayForm(id);
    if (a === "replay-stop") {
      replayStopped = true;
      clearTimeout(replayTimer);
      render();
    }
    if (a === "settings") settings();
    if (a === "help") help();
    if (a === "vault-export") {
      await engine.flush();
      download("mqtt-dashboard.encrypted.json", await exportVault());
      toast("Verschlüsseltes Backup erstellt.");
    }
    if (a === "vault-password") {
      form(
        "Master-Passwort ändern",
        input(
          "Neues Master-Passwort (mindestens 12 Zeichen)",
          "password",
          "",
          "password",
          'required minlength="12" autocomplete="new-password"',
        ) +
          input(
            "Passwort wiederholen",
            "repeat",
            "",
            "password",
            'required minlength="12" autocomplete="new-password"',
          ),
        async (d) => {
          if (d.get("password") !== d.get("repeat"))
            throw Error("Passwörter stimmen nicht überein.");
          await changePassword(d.get("password"), engine.snapshot());
          toast("Master-Passwort geändert. Neues Backup erstellen.");
        },
      );
    }
    if (a === "lock") await lock();
  } catch (err) {
    toast(err.message || "Aktion fehlgeschlagen.");
  }
});
let lockTimer;
async function lock() {
  if (!engine) return;
  replayStopped = true;
  clearTimeout(replayTimer);
  for (const b of state().brokers) engine.disconnect(b.id);
  engine.stopRecording();
  await engine.flush();
  await lockVault();
  location.reload();
}
document.addEventListener("visibilitychange", () => {
  clearTimeout(lockTimer);
  if (document.hidden && engine) {
    engine.flush().catch((e) => toast(e.message));
    const mins = state().settings.autoLock ?? 5;
    if (mins)
      lockTimer = setTimeout(
        () => lock().catch((e) => toast(e.message)),
        mins * 60000,
      );
  }
});
const installApp = setupInstall({ button: $("#install"), notify: toast });
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .catch(() => toast("Offline-Modus konnte nicht aktiviert werden."));
function start(snapshot) {
  engine = new Engine(snapshot);
  engine.addEventListener("error", (e) => toast(e.detail));
  engine.addEventListener("change", () => {
    renderSidebar();
    if (view === "brokers" && !$("#modal").open) render();
  });
  engine.addEventListener("rule", (e) => {
    $("#footer-status").textContent = "Regel ausgeführt: " + e.detail;
  });
  engine.addEventListener("message", (e) => {
    $("#footer-status").textContent =
      (e.detail.sample ? "Demo-Beispiel" : time(e.detail.time)) +
      " · " +
      e.detail.topic;
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (
        $("#modal").open ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
      )
        return;
      if (
        view === "dashboard" ||
        view === "explorer" ||
        view === "recordings" ||
        (view === "messages" && !paused && state().settings.autoscroll)
      ) {
        page = 0;
        render();
      }
    }, 180);
  });
  $("#modal").close();
  $("#sidebar").inert = false;
  document.querySelector("main").inert = false;
  render();
  if (!engine.history.length && state().brokers.some((b) => b.id === "demo")) {
    for (let i = 0; i < 18; i++) engine.demo(true);
    render();
  }
  engine.save();
}
async function boot() {
  try {
    const exists = await openVault();
    $("#sidebar").inert = true;
    document.querySelector("main").inert = true;
    $("#modal").addEventListener("cancel", (e) => {
      if (!engine) e.preventDefault();
    });
    modal(
      exists ? "Workspace entsperren" : "Deinen sicheren Workspace einrichten",
      `<p>${exists ? "Deine MQTT-Daten sind verschlüsselt gespeichert." : "Broker, Zugangsdaten und Nachrichten bleiben verschlüsselt in diesem Browser."}</p><form id="unlock-form">${input("Master-Passwort", "password", "", "password", `required minlength="${exists ? 1 : 12}" autocomplete="${exists ? "current-password" : "new-password"}"`)}${exists ? "" : input("Master-Passwort wiederholen", "repeat", "", "password", 'required minlength="12" autocomplete="new-password"')}<p class="notice">${exists ? "Nach dem Entsperren kannst du deine Broker verbinden." : "Mindestens 12 Zeichen. Das Passwort wird nicht gespeichert und kann nicht zurückgesetzt werden. Ein verschlüsseltes Backup schützt vor Verlust des Browserspeichers."}</p><p id="unlock-error" role="alert" style="color:var(--red)"></p><div class="form-actions">${btn("vault-restore", "Backup wiederherstellen", 'type="button"')}<button class="primary" type="submit">${exists ? "Entsperren" : "Tresor erstellen"}</button></div></form>`,
    );
    $("#modal .dialog-head button").hidden = true;
    $("#unlock-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        d = new FormData(f),
        b = f.querySelector("[type=submit]");
      b.disabled = true;
      $("#unlock-error").textContent = "";
      try {
        if (!exists && d.get("password") !== d.get("repeat"))
          throw Error("Passwörter stimmen nicht überein.");
        const snapshot = exists
          ? await unlock(d.get("password"))
          : await createVault(d.get("password"), {
              state: initialState(),
              history: [],
              recordings: [],
            });
        f.reset();
        $("#modal .dialog-head button").hidden = false;
        start(snapshot);
      } catch (err) {
        $("#unlock-error").textContent = err.message;
        b.disabled = false;
      }
    };
  } catch (e) {
    $("#content").innerHTML = empty(
      "Sicherer Speicher nicht verfügbar",
      esc(e.message),
    );
  }
}
if (navigator.locks) {
  navigator.locks.request(
    "mqtt-dashboard-workspace",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        $("#content").innerHTML = empty(
          "Workspace bereits geöffnet",
          "Schließe den anderen Tab und lade diese Seite neu.",
        );
        return;
      }
      await boot();
      await new Promise(() => {});
    },
  );
} else {
  $("#content").innerHTML = empty(
    "Browser aktualisieren",
    "Für sicheren parallelen Zugriff wird ein Browser mit Web Locks benötigt.",
  );
}
