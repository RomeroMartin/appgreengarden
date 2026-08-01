// ============================================================
// mock-app.mjs — Reemplaza a firebase-app.js.
// ============================================================
const apps = [];
export function initializeApp(config, name = "[DEFAULT]") {
  const app = { name, options: config };
  apps.push(app);
  return app;
}
export function getApps() { return apps; }
export function getApp(name = "[DEFAULT]") { return apps.find(a => a.name === name) || apps[0]; }
export function deleteApp(app) { const i = apps.indexOf(app); if (i >= 0) apps.splice(i, 1); }
