// Uli: AES-GCM authenticates every saved snapshot; the derived key is never persisted.
const enc = new TextEncoder(),
  dec = new TextDecoder();
let db,
  key,
  salt,
  writing = Promise.resolve();
const get = () =>
  new Promise((resolve, reject) => {
    const r = db.transaction("vault").objectStore("vault").get("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const put = (value) =>
  new Promise((resolve, reject) => {
    const t = db.transaction("vault", "readwrite");
    t.objectStore("vault").put(value, "workspace");
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
async function derive(password, s) {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: s, iterations: 600000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function openVault() {
  if (!crypto.subtle)
    throw Error("Verschlüsselung benötigt HTTPS oder localhost.");
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("mqtt-dashboard-vault", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vault");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return !!(await get());
}
export async function unlock(password) {
  const record = await get();
  if (!record) throw Error("Tresor nicht vorhanden.");
  salt = record.salt;
  const candidate = await derive(password, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.iv,
        additionalData: enc.encode("MQTT-PWA-DASHBOARD/v1"),
      },
      candidate,
      record.data,
    );
    const snapshot = JSON.parse(dec.decode(plain));
    key = candidate;
    return snapshot;
  } catch {
    throw Error("Passwort falsch oder Tresor beschädigt.");
  }
}
export async function createVault(password, snapshot) {
  salt = crypto.getRandomValues(new Uint8Array(16));
  key = await derive(password, salt);
  await saveVault(snapshot);
  return snapshot;
}
export function saveVault(snapshot) {
  const plain = enc.encode(JSON.stringify(snapshot));
  writing = writing
    .catch(() => {})
    .then(async () => {
      if (!key) throw Error("Tresor ist gesperrt.");
      const snapshotKey = key,
        snapshotSalt = salt;
      const iv = crypto.getRandomValues(new Uint8Array(12)),
        data = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: enc.encode("MQTT-PWA-DASHBOARD/v1"),
          },
          snapshotKey,
          plain,
        );
      await put({
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations: 600000,
        salt: snapshotSalt,
        iv,
        data,
      });
    });
  return writing;
}
export async function exportVault() {
  await writing;
  const r = await get();
  return JSON.stringify({
    ...r,
    salt: Array.from(r.salt),
    iv: Array.from(r.iv),
    data: Array.from(new Uint8Array(r.data)),
  });
}
export async function restoreVault(text) {
  const r = JSON.parse(text);
  if (
    r.version !== 1 ||
    r.kdf !== "PBKDF2-SHA256" ||
    r.iterations !== 600000 ||
    !Array.isArray(r.salt) ||
    r.salt.length !== 16 ||
    !Array.isArray(r.iv) ||
    r.iv.length !== 12 ||
    !Array.isArray(r.data) ||
    r.data.length < 16 ||
    r.data.length > 50000000 ||
    [...r.salt, ...r.iv, ...r.data].some(
      (n) => !Number.isInteger(n) || n < 0 || n > 255,
    )
  )
    throw Error("Ungültiges Tresor-Backup.");
  await put({
    ...r,
    salt: new Uint8Array(r.salt),
    iv: new Uint8Array(r.iv),
    data: new Uint8Array(r.data).buffer,
  });
}
export async function changePassword(password, snapshot) {
  await writing;
  const nextSalt = crypto.getRandomValues(new Uint8Array(16));
  const nextKey = await derive(password, nextSalt);
  salt = nextSalt;
  key = nextKey;
  await saveVault(snapshot);
}
export async function lockVault() {
  await writing;
  key = null;
}
