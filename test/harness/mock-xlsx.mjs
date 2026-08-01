// ============================================================
// mock-xlsx.mjs — Reemplaza al SDK de SheetJS (xlsx.mjs).
// El test inyecta las filas del "Excel" en globalThis.__XLSX_ROWS
// (array de arrays, como sheet_to_json con header:1).
// ============================================================
export function read() {
  const rows = globalThis.__XLSX_ROWS || [];
  return { SheetNames: ["Hoja1"], Sheets: { Hoja1: { __rows: rows } } };
}
export const utils = {
  sheet_to_json(ws) { return ws.__rows || []; }
};
export const SSF = {
  // Número de serie de Excel → {y,m,d} (epoch 1899-12-30)
  parse_date_code(serial) {
    if (typeof serial !== "number") return null;
    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
};
export default { read, utils, SSF };
