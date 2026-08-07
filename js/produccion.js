// ============================================================
// produccion.js — Consumo de insumos al hacer un Ingreso Producción.
// Un producto puede tener una "receta de producción" (insumos por porción).
// Al producir N porciones, se descuenta insumo×N del ACOPIO de cada insumo y se
// deja un movimiento por insumo (RETIRO acopio → producción). El resumen también
// queda en el propio movimiento de Ingreso Producción (campo consumo_produccion),
// que es la fuente de verdad para revertir si se edita/elimina la producción.
// Compartido entre Gerente, Encargado y Cargador de Entradas.
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  collection, doc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Consumo TOTAL por insumo (cantidad por porción × porciones producidas).
// Devuelve [{ id, nombre, cantidad, unidad }]. No toca la base.
export function calcularConsumoProduccion(plato, cantidad) {
  const insumos = (plato && plato.receta_produccion) || [];
  const out = [];
  for (const ing of insumos) {
    const consumo = +(((ing.cantidad || 0) * cantidad)).toFixed(6);
    if (!consumo) continue;
    out.push({ id: ing.id, nombre: ing.nombre, cantidad: consumo, unidad: ing.unidad || "" });
  }
  return out;
}

// Agrega al batch el consumo de insumos: resta del acopio de cada insumo y deja un
// movimiento RETIRO (origen acopio → destino producción), enlazado a la producción
// por `produccion_id`. `existe(id)` evita tocar insumos borrados del catálogo.
export function agregarConsumoAlBatch(batch, { plato, consumos, produccionId, usuarioNombre, existe }) {
  for (const c of consumos) {
    if (existe && !existe(c.id)) continue;
    batch.update(doc(db, "productos", c.id), { stock_deposito: increment(-c.cantidad) });
    batch.set(doc(collection(db, "movimientos")), {
      fecha_hora: serverTimestamp(),
      id_usuario: auth.currentUser?.uid || null,
      nombre_usuario: usuarioNombre,
      id_producto: c.id,
      nombre_producto: c.nombre,
      tipo: "RETIRO",
      cantidad: c.cantidad,
      unidad: c.unidad,
      motivo: `Consumo producción: ${plato.nombre}`,
      origen: "acopio",
      destino: "produccion",
      produccion_id: produccionId
    });
  }
}
