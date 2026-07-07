// ============================================================
// version.js — Fuente única de la versión de la app.
// Cambiá APP_VERSION acá y se actualiza en todas las vistas.
// El sello se auto-estiliza (no depende de estilos.css).
// ============================================================

export const APP_VERSION = "3.8.7";

function aplicarVersion() {
  document.querySelectorAll(".app-version").forEach(el => {
    el.textContent = "v" + APP_VERSION;
    el.style.cssText =
      "position:fixed;bottom:8px;right:10px;" +
      "font:600 11px/1 ui-monospace,monospace;color:#9a7f43;" +
      "background:rgba(248,244,234,0.92);border:1px solid #ddd0b8;" +
      "padding:3px 9px;border-radius:20px;z-index:9999;" +
      "pointer-events:none;letter-spacing:0.5px;box-shadow:0 1px 4px rgba(0,0,0,0.08);";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", aplicarVersion);
} else {
  aplicarVersion();
}

console.log("%c🍃 Green Garden Inventario v" + APP_VERSION, "color:#2d6a4f;font-weight:bold;font-size:13px;");
