// ============================================================
// iconos.js — Set de iconos SVG propios de Green Garden.
// Un solo lugar para todos los iconos → se ven IGUAL en cualquier
// navegador/celular (antes eran emojis, que cada sistema dibuja distinto).
//
// Uso:  icono("despacho")                 → <svg ...>…</svg>  (string)
//       icono("editar", { size: 16 })     → tamaño 16
//       icono("alerta", { cls: "warn" })  → agrega clase
// El color sale de `currentColor` (se hereda del texto/CSS).
// ============================================================

const TRAZOS = {
  // Tipos de producto
  despacho:   '<path d="M4.5 16.5a7.5 7.5 0 0 1 15 0"/><path d="M3 16.5h18"/><path d="M12 9V7.4"/><circle cx="12" cy="6.4" r=".9"/>',
  materia:    '<path d="M12 21v-8.5"/><path d="M12 13.5C8.2 13.7 6 11 6.2 7.2 10 7 12.2 9.7 12 13.5Z"/><path d="M12 11.5c-.2-3.6 1.9-6.2 5.6-6.4.2 3.7-2 6.2-5.6 6.4Z"/>',
  receta:     '<path d="M9 4.2h6a1 1 0 0 1 1 1v.6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-.6a1 1 0 0 1 1-1Z"/><path d="M8 5.4H6.5a1.5 1.5 0 0 0-1.5 1.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6.9a1.5 1.5 0 0 0-1.5-1.5H16"/><path d="M8.5 11h7"/><path d="M8.5 14.5h4.5"/>',
  // Ubicaciones / stock
  acopio:     '<path d="M3.5 21V9.6a1 1 0 0 1 .5-.9l7.5-4.4a1 1 0 0 1 1 0l7.5 4.4a1 1 0 0 1 .5.9V21"/><path d="M3.5 21h17"/><path d="M9.5 21v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5"/>',
  stock:      '<path d="M12 3.2 4.2 7.4a1 1 0 0 0-.5.9v7.4a1 1 0 0 0 .5.9L12 20.8l7.8-4.2a1 1 0 0 0 .5-.9V8.3a1 1 0 0 0-.5-.9L12 3.2Z"/><path d="M4 7.8 12 12l8-4.2"/><path d="M12 12v8.6"/>',
  // Movimientos
  entrada:    '<path d="M12 15.5V4.5"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M5.5 20h13"/>',
  salida:     '<path d="M12 4.5v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5.5 20h13"/>',
  venta:      '<path d="M4.5 6.5h15a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5Z"/><circle cx="12" cy="12" r="2.4"/><path d="M6.5 10v4"/><path d="M17.5 10v4"/>',
  ajuste:     '<path d="M4 8h8"/><path d="M17 8h3"/><circle cx="14.5" cy="8" r="2.3"/><path d="M4 16h4"/><path d="M13 16h7"/><circle cx="10.5" cy="16" r="2.3"/>',
  reposicion: '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  // Acciones
  editar:     '<path d="M12.5 20H21"/><path d="M16.8 3.7a2 2 0 0 1 2.8 2.8L7.5 18.6 3.5 20l1.4-4L16.8 3.7Z"/>',
  eliminar:   '<path d="M4 6.5h16"/><path d="M8.5 6.5V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M18 6.5 17 19a2 2 0 0 1-2 1.9H9A2 2 0 0 1 7 19L6 6.5"/><path d="M10.5 10.5v6"/><path d="M13.5 10.5v6"/>',
  buscar:     '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4-4"/>',
  importar:   '<path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/><path d="M12 3.5v10.5"/><path d="M8.5 10.5 12 14l3.5-3.5"/>',
  exportar:   '<path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/><path d="M12 14V3.5"/><path d="M8.5 7 12 3.5 15.5 7"/>',
  // Secciones / navegación
  historial:  '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>',
  usuarios:   '<path d="M15.5 20.5v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5v1.5"/><circle cx="9.5" cy="8" r="3.5"/><path d="M20.5 20.5v-1.5a3.5 3.5 0 0 0-2.6-3.4"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
  config:     '<path d="M12 3.3 19.5 7.6v8.8L12 20.7 4.5 16.4V7.6Z"/><circle cx="12" cy="12" r="3.2"/>',
  corte:      '<path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z"/><path d="M4 9.5h16"/><path d="M8.5 3.5v3"/><path d="M15.5 3.5v3"/>',
  // Estado / marca
  alerta:     '<path d="M10.6 4 3 17.5a1.6 1.6 0 0 0 1.4 2.4h15.2a1.6 1.6 0 0 0 1.4-2.4L13.4 4a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  ok:         '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2 11 14.7l4.6-5.2"/>',
  hoja:       '<path d="M5.5 20C5 12.5 9.8 5.5 20 4.5c1 10-5 15.5-14.5 15.5Z"/><path d="M8.5 17c2.2-4.3 5.4-7 9.5-8.2"/>'
};

// Devuelve el SVG (string) listo para meter en innerHTML / template literals.
export function icono(nombre, opts = {}) {
  const { size = 20, sw = 1.7, cls = "" } = opts;
  const trazo = TRAZOS[nombre];
  if (!trazo) return "";
  return `<svg class="ico${cls ? " " + cls : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-.15em;flex-shrink:0">${trazo}</svg>`;
}

// Lista de nombres disponibles (para tests / referencia).
export const NOMBRES_ICONOS = Object.keys(TRAZOS);
