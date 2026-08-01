// Registra el resolve hook antes de importar cualquier vista.
// Uso:  node --import ./test/harness/register.mjs --test test/e2e/*.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
