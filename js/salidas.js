// ============================================================
// salidas.js — Cargador de Salidas v3.0
// Retiro inteligente: despacho automático según tipo de producto
// ============================================================

import { auth, db } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import {
  escHtml, fmtN, esDespacho, sectoresDe, acopioBajoOcero,
  origenRetiroActual, MOTIVOS_SALIDA_DEFAULT, poblarMotivosSalida
} from "./core-inventario.js";
import { icono } from "./iconos.js";
import {
  collection, doc, addDoc, updateDoc, getDocs,
  query, orderBy, limit, where, serverTimestamp, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

protegerRuta("Cargador Salidas");

let productos     = [];
let usuarioActual = null;

let motivosSalida = [...MOTIVOS_SALIDA_DEFAULT];


document.addEventListener("usuarioListo", async (e) => {
  usuarioActual = e.detail;
  document.getElementById("pantalla-carga").style.display = "none";
  document.getElementById("contenido").style.display      = "flex";
  document.getElementById("saludo").textContent = `Hola, ${usuarioActual.nombre.split(" ")[0]} 👋`;
  await cargarProductos();
  cargarHoy();
});

document.getElementById("btn-logout").addEventListener("click", logout);

async function cargarProductos() {
  const snap = await getDocs(query(collection(db,"productos"), orderBy("nombre")));
  productos  = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  try {
    const snapM = await getDocs(collection(db,"motivos_salida"));
    const listaM = snapM.docs.map(d => ({ id:d.id, ...d.data() }));
    if (listaM.length) motivosSalida = listaM;
  } catch(e) { /* usa defaults */ }

  poblarSelect(productos);
  document.getElementById("sal-producto").addEventListener("change", actualizarInfo);
  document.getElementById("sal-busqueda").addEventListener("input", () => {
    const t = document.getElementById("sal-busqueda").value.toLowerCase();
    poblarSelect(t ? productos.filter(p=>p.nombre.toLowerCase().includes(t)) : productos);
    actualizarInfo();
  });
  document.getElementById("sal-motivo").addEventListener("change", actualizarInfo);
  actualizarInfo();
}

function poblarSelect(lista) {
  document.getElementById("sal-producto").innerHTML = lista.length
    ? lista.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("")
    : '<option value="">Sin resultados</option>';
}

function actualizarInfo() {
  const prod = productos.find(p => p.id === document.getElementById("sal-producto").value);
  const info        = document.getElementById("sal-producto-info");
  const grupoSector = document.getElementById("sal-grupo-sector");
  const infoDestino = document.getElementById("sal-info-destino");
  const grupoOrigen = document.getElementById("sal-grupo-origen");
  if (!prod) {
    info.style.display = "none"; grupoSector.style.display = "none"; infoDestino.style.display = "none";
    if (grupoOrigen) grupoOrigen.style.display = "none";
    document.getElementById("sal-unidad").textContent = "";
    return;
  }
  info.style.display = "";
  document.getElementById("sal-stock-display").textContent = `${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida}`;
  document.getElementById("sal-unidad").textContent = `(${prod.unidad_medida})`;
  poblarMotivosSalida(productos, motivosSalida);

  // ── Selector de origen inteligente: cuando el acopio está sin stock pero hay en despacho ──
  let origenEsDespacho = false;
  if (grupoOrigen) {
    const despachoConStock = esDespacho(prod)
      ? Object.entries(prod.stock_despacho || {}).filter(([,v]) => (v||0) > 0)
      : [];
    if (acopioBajoOcero(prod) && despachoConStock.length > 0) {
      const sel = document.getElementById("sal-origen");
      if (sel.dataset.prod !== prod.id) {
        const ops = [`<option value="acopio">Acopio (${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida||""})</option>`];
        despachoConStock.forEach(([s,v]) => ops.push(`<option value="${s}">${s} (${fmtN(v)} ${prod.unidad_medida||""})</option>`));
        sel.innerHTML = ops.join("");
        sel.dataset.prod = prod.id;
        sel.onchange = actualizarInfo;
      }
      grupoOrigen.style.display = "";
      origenEsDespacho = origenRetiroActual() !== "acopio";
    } else {
      grupoOrigen.style.display = "none";
      document.getElementById("sal-origen").dataset.prod = "";
    }
  }

  const motivoObj  = motivosSalida.find(m => m.nombre === document.getElementById("sal-motivo").value);
  const transfiere = !!(motivoObj && motivoObj.transfiere) && !origenEsDespacho;

  if (origenEsDespacho) {
    grupoSector.style.display = "none";
    infoDestino.style.display = "";
    const origen = origenRetiroActual();
    infoDestino.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">↓ Se descuenta de <strong>${origen}</strong> (sector de despacho). No suma a ningún otro lado.</div>`;
    return;
  }

  if (transfiere && esDespacho(prod)) {
    const sects = sectoresDe(prod);
    if (sects.length > 1) {
      grupoSector.style.display = "";
      document.getElementById("sal-sector-destino").innerHTML = sects.map(s=>`<option value="${s}">${s}</option>`).join("");
      infoDestino.style.display = "none";
    } else if (sects.length === 1) {
      grupoSector.style.display = "none";
      infoDestino.style.display = "";
      infoDestino.innerHTML = `<div style="background:var(--verde-claro);border:1px solid var(--verde-suave);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-2);">${icono("reposicion",{size:14})} ${motivoObj.nombre} — el stock irá automáticamente a <strong style="color:var(--verde);">${sects[0]}</strong></div>`;
    } else {
      grupoSector.style.display = "none";
      infoDestino.style.display = "";
      infoDestino.innerHTML = `<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">${icono("alerta",{size:13})} Producto de despacho sin sector asignado. Avisale al Gerente.</div>`;
    }
  } else {
    grupoSector.style.display = "none";
    infoDestino.style.display = "";
    infoDestino.innerHTML = `<div style="background:var(--bg-secondary);border:1px solid var(--borde);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-3);">↓ Solo descuenta del acopio${esDespacho(prod)?"":" (materia prima)"}</div>`;
  }
}

const inputCant = document.getElementById("sal-cantidad");
document.getElementById("sal-menos").addEventListener("click",()=>{ inputCant.value=Math.max(0.1,parseFloat((parseFloat(inputCant.value)||0)-1).toFixed(2)); });
document.getElementById("sal-mas").addEventListener("click",()=>{ inputCant.value=parseFloat((parseFloat(inputCant.value)||0)+1).toFixed(2); });

document.getElementById("btn-confirmar-salida").addEventListener("click", async () => {
  const prodId   = document.getElementById("sal-producto").value;
  const cantidad = parseFloat(document.getElementById("sal-cantidad").value)||0;
  const motivo   = document.getElementById("sal-motivo").value;
  const obs      = document.getElementById("sal-obs").value.trim();
  const msgEl    = document.getElementById("msg-salida");
  const btn      = document.getElementById("btn-confirmar-salida");
  const prod     = productos.find(p=>p.id===prodId);
  if (!prod||cantidad<=0) { mostrarMsg(msgEl,"error","Completá los campos."); return; }

  const origen = origenRetiroActual();

  // ── Retiro desde un sector de despacho (acopio sin stock) ──
  if (origen !== "acopio") {
    const stockSector = prod.stock_despacho?.[origen] ?? 0;
    if (cantidad > stockSector) { mostrarMsg(msgEl,"error",`Stock insuficiente en ${origen}. Hay ${fmtN(stockSector)} ${prod.unidad_medida}.`); return; }
    btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
    try {
      await updateDoc(doc(db,"productos",prodId), { [`stock_despacho.${origen}`]: increment(-cantidad) });
      if(!prod.stock_despacho)prod.stock_despacho={};
      prod.stock_despacho[origen]=Math.max(0,stockSector-cantidad);
      await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen,destino:"consumo"});
      actualizarInfo();
      mostrarFlash(`↓ Retiro desde ${origen}`);
      document.getElementById("sal-cantidad").value="1";
      document.getElementById("sal-obs").value="";
      msgEl.classList.remove("show");
      cargarHoy();
    } catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
    finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
    return;
  }

  // ── Retiro desde acopio (flujo normal) ──
  if (cantidad>(prod.stock_deposito??0)) { mostrarMsg(msgEl,"error",`Stock insuficiente en acopio. Hay ${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida}.`); return; }

  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try {
    const motivoObj  = motivosSalida.find(m => m.nombre === motivo);
    const transfiere = !!(motivoObj && motivoObj.transfiere);
    let destino = "consumo";
    if (transfiere && esDespacho(prod)) {
      const sects = sectoresDe(prod);
      if (sects.length > 1) destino = document.getElementById("sal-sector-destino").value;
      else if (sects.length === 1) destino = sects[0];
      else throw new Error("El producto no tiene sector de despacho asignado.");

      const batch = writeBatch(db);
      batch.update(doc(db,"productos",prodId), {
        stock_deposito: increment(-cantidad),
        [`stock_despacho.${destino}`]: increment(cantidad)
      });
      await batch.commit();
      if(!prod.stock_despacho)prod.stock_despacho={};
      prod.stock_despacho[destino]=(prod.stock_despacho[destino]??0)+cantidad;
    } else {
      await updateDoc(doc(db,"productos",prodId),{stock_deposito:increment(-cantidad)});
    }
    prod.stock_deposito=Math.max(0,(prod.stock_deposito??0)-cantidad);

    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen:"acopio",destino});

    actualizarInfo();
    mostrarFlash(destino !== "consumo" ? `↓ Retiro → ${destino}` : `↓ ${motivo} registrado`);
    document.getElementById("sal-cantidad").value="1";
    document.getElementById("sal-obs").value="";
    msgEl.classList.remove("show");
    cargarHoy();
  } catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
});

async function cargarHoy() {
  const cont = document.getElementById("lista-salidas-hoy");
  const hoy=new Date();hoy.setHours(0,0,0,0);
  // Filtramos por fecha (solo hoy) en Firestore → evita descargar todo el historial.
  // Es un rango sobre un solo campo, no requiere índice compuesto. El orden y el
  // filtro por usuario/tipo se hacen en el código.
  const snap=await getDocs(query(collection(db,"movimientos"),where("fecha_hora",">=",hoy)));
  const retiros=snap.docs
    .filter(d=>{const m=d.data();const ts=m.fecha_hora?.toDate?.();return ts&&ts>=hoy&&m.id_usuario===auth.currentUser?.uid&&m.tipo==="RETIRO";})
    .sort((a,b)=>(b.data().fecha_hora?.toDate?.()||0)-(a.data().fecha_hora?.toDate?.()||0));
  if(!retiros.length){cont.innerHTML='<div class="empty-state"><p>Sin retiros hoy.</p></div>';return;}
  cont.innerHTML=retiros.map(d=>{
    const m=d.data();const ts=m.fecha_hora?.toDate?.();
    const hora=ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"";
    const destinoTxt=(m.destino==="produccion"||m.destino==="consumo")?"consumo":m.destino;
    return `<div class="mov-mini"><div><div style="font-size:0.88rem;font-weight:600;">${escHtml(m.nombre_producto)}</div><div style="font-size:0.72rem;color:var(--texto-3);">${hora} → ${escHtml(destinoTxt)} · ${escHtml(m.motivo||"—")}</div></div><span style="font-size:0.9rem;font-weight:700;color:var(--critico-txt);">-${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</span></div>`;
  }).join("");
}

function mostrarFlash(texto="✓ Registrado"){const el=document.getElementById("flash-ok");el.textContent=texto;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2500);}
function mostrarMsg(el,tipo,texto){el.textContent=texto;el.className=`msg show msg-${tipo==="error"?"error":"ok"}`;}

// El sello de versión lo aplica js/version.js (cargado desde el HTML de la vista).
