// Uli: Installation is progressive enhancement; never interrupt an active MQTT session.
export function setupInstall({ button, notify }) {
  let deferredPrompt;
  const display = window.matchMedia?.("(display-mode: standalone)");
  let installed = !!display?.matches || navigator.standalone === true;
  function update() {
    button.hidden = installed;
    button.textContent = deferredPrompt
      ? "↓ App installieren"
      : "↓ Installation";
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    update();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = undefined;
    installed = true;
    update();
    notify("App installiert. Du findest sie jetzt im App-Menü.");
  });
  display?.addEventListener?.("change", (event) => {
    installed = event.matches;
    update();
  });
  update();
  return async function install() {
    if (installed) return;
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = undefined;
      update();
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "dismissed")
        notify(
          "Installation abgebrochen. Sie bleibt über das Browser-Menü möglich.",
        );
      return;
    }
    if (!window.isSecureContext) {
      notify(
        "Für die Installation diese App über HTTPS oder localhost öffnen.",
      );
    } else if (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    ) {
      notify("In Safari: Teilen → Zum Home-Bildschirm → Hinzufügen.");
    } else {
      notify(
        "Im Browser-Menü „App installieren“ wählen. Fehlt der Eintrag: vollständigen Browser, HTTPS und Zugriff auf Manifest/Icons prüfen.",
      );
    }
  };
}
