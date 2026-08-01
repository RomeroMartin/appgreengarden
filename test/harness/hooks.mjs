// ============================================================
// hooks.mjs — Resolve hook de Node: intercepta las URLs del SDK de
// Firebase y de SheetJS y las apunta a los mocks locales.
// ============================================================
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const toFile = (f) => pathToFileURL(join(here, f)).href;

const MAP = [
  [/firebase-app(\.[^/]*)?\.js$/,       "mock-app.mjs"],
  [/firebase-auth(\.[^/]*)?\.js$/,      "mock-auth.mjs"],
  [/firebase-firestore(\.[^/]*)?\.js$/, "mock-firestore.mjs"],
  [/xlsx(\.[^/]*)?\.mjs$/,              "mock-xlsx.mjs"],
];

export async function resolve(specifier, context, nextResolve) {
  if (/^https?:\/\//.test(specifier)) {
    for (const [re, file] of MAP) {
      if (re.test(specifier)) return { url: toFile(file), shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
