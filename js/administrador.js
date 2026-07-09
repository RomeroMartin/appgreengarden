// ============================================================
// administrador.js — Panel Administrador v3.0
// Retiro inteligente + Venta + Ajuste + Historial
// ============================================================

import { auth, db } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import { initImportador, abrirImportador, actualizarProductosImportador } from "./importador-ventas.js";
import { renderResumen, badgeProducto, calcularResumen, debeAvanzar } from "./corte-ventas.js";
import { initConteo, abrirConteo, setProductosConteo } from "./conteo-fisico.js";
import {
  escHtml, fmtN, esDespacho, sectoresDe, stockTotal, getBadge, acopioBajoOcero,
  origenRetiroActual, aDatetimeLocal, MOTIVOS_SALIDA_DEFAULT, poblarMotivosSalida
} from "./core-inventario.js";
import { icono } from "./iconos.js";
import {
  collection, doc, addDoc, updateDoc, getDocs,
  onSnapshot, query, orderBy, limit, serverTimestamp, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

protegerRuta("Administrador");

let productos     = [];
let movCache      = [];
let movIndex      = {};   // id -> movimiento (para corregir motivo)
let usuarioActual = null;

let motivosSalida = [...MOTIVOS_SALIDA_DEFAULT];


document.addEventListener("usuarioListo",(e)=>{
  usuarioActual=e.detail;
  document.getElementById("pantalla-carga").style.display="none";
  document.getElementById("contenido").style.display="flex";
  iniciar();
});

document.getElementById("btn-logout").addEventListener("click",logout);

document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
  });
});

function abrirModal(id){document.getElementById(id).classList.add("open");}
function cerrarModal(id){document.getElementById(id).classList.remove("open");}
document.querySelectorAll("[data-cerrar]").forEach(b=>b.addEventListener("click",()=>cerrarModal(b.dataset.cerrar)));
document.querySelectorAll(".modal-overlay").forEach(o=>o.addEventListener("click",e=>{if(e.target===o)cerrarModal(o.id);}));

function iniciar() {
  onSnapshot(collection(db,"motivos_salida"),snap=>{
    const lista=snap.docs.map(d=>({id:d.id,...d.data()}));
    motivosSalida=lista.length?lista:[...MOTIVOS_SALIDA_DEFAULT];
  });

  onSnapshot(collection(db,"sectores"),snap=>{
    const sects=snap.docs.map(d=>d.data().nombre);
    document.getElementById("filtro-sector").innerHTML='<option value="">Todos los sectores</option>'+sects.map(s=>`<option value="${s}">${s}</option>`).join("");
  });
  onSnapshot(collection(db,"rubros"),snap=>{
    const rubs=snap.docs.map(d=>d.data().nombre);
    document.getElementById("filtro-rubro").innerHTML='<option value="">Todos los rubros</option>'+rubs.map(r=>`<option value="${r}">${r}</option>`).join("");
  });
  onSnapshot(query(collection(db,"productos"),orderBy("nombre")),snap=>{
    productos=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderStock(); renderAlertas();
    actualizarProductosImportador(productos);
  });
  initImportador({ productos, usuarioActual, onTerminado: () => { cargarMovRecientes(); renderResumen("indicador-corte", productos); renderStock(); } });
  initConteo({ usuarioActual, onAplicado: () => { cargarMovRecientes(); } });
  cargarHistorial();
  cargarMovRecientes();
}

document.getElementById("filtro-sector").addEventListener("change",renderStock);
document.getElementById("filtro-rubro").addEventListener("change",renderStock);
document.getElementById("filtro-busqueda").addEventListener("input",renderStock);

let alertasAbierto=false;
function renderAlertas() {
  const alertas=productos.filter(p=>{const min=p.stock_minimo;return min!=null&&min!==""&&stockTotal(p)<=min;});
  const sec=document.getElementById("seccion-alertas"),lst=document.getElementById("lista-alertas");
  if(!alertas.length){sec.style.display="none";return;}
  sec.style.display="block";
  document.getElementById("alertas-count").textContent=`(${alertas.length})`;
  lst.innerHTML=alertas.map(p=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(217,83,79,0.15);"><span style="font-size:0.88rem;font-weight:600;">${escHtml(p.nombre)}</span><span style="font-weight:700;color:var(--critico-txt);">${fmtN(stockTotal(p))} / ${p.stock_minimo} ${escHtml(p.unidad_medida||"")}</span></div>`).join("");
  lst.style.display=alertasAbierto?"block":"none";
  document.getElementById("alertas-chevron").style.transform=alertasAbierto?"rotate(180deg)":"";
  const header=document.getElementById("alertas-header");
  if(header&&!header.dataset.wired){
    header.dataset.wired="1";
    header.addEventListener("click",()=>{
      alertasAbierto=!alertasAbierto;
      lst.style.display=alertasAbierto?"block":"none";
      document.getElementById("alertas-chevron").style.transform=alertasAbierto?"rotate(180deg)":"";
    });
  }
}

function renderStock() {
  const _resumen=calcularResumen(productos);
  const _masReciente=_resumen.masReciente;
  const sector=document.getElementById("filtro-sector").value;
  const rubro=document.getElementById("filtro-rubro").value;
  const busq=document.getElementById("filtro-busqueda").value.toLowerCase();
  const cont=document.getElementById("lista-stock");
  let lista=productos;
  if(sector)lista=lista.filter(p=>p.sector===sector);
  if(rubro) lista=lista.filter(p=>p.rubro===rubro);
  if(busq)  lista=lista.filter(p=>p.nombre.toLowerCase().includes(busq));
  if(!lista.length){cont.innerHTML='<div class="empty-state"><p>Sin resultados.</p></div>';return;}
  cont.innerHTML=lista.map(p=>{
    const dep=p.stock_deposito??0;const des=p.stock_despacho??{};
    const total=stockTotal(p);const badge=getBadge(p);
    const tipoBadge=esDespacho(p)
      ?`<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;display:inline-flex;align-items:center;">${icono("despacho",{size:12})}</span>`
      :`<span style="font-size:0.65rem;background:var(--bg-secondary);color:var(--texto-3);padding:2px 8px;border-radius:10px;font-weight:600;display:inline-flex;align-items:center;">${icono("materia",{size:12})}</span>`;
    const desglose=Object.entries(des).filter(([,v])=>v!==0).map(([k,v])=>{const neg=v<0;return `<span style="font-size:0.75rem;background:var(--bg-secondary);padding:2px 8px;border-radius:4px;margin:2px;${neg?'color:var(--critico-txt);':''}">${escHtml(k)}: <strong>${fmtN(v)}</strong></span>`;}).join("");
    return `<div class="item-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        <div><div class="item-nombre">${escHtml(p.nombre)} ${tipoBadge}</div><div class="item-meta">Acopio: ${escHtml(p.sector||"—")} · ${escHtml(p.rubro||"—")}</div></div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.9rem;font-weight:600;color:var(--texto-2);">Total: ${fmtN(total)} ${p.unidad_medida||""}</div>
          ${badge?`<span class="stock-badge ${badge.cls}">${badge.label}</span>`:""}
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--texto-3);display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${icono("acopio",{size:13})} Acopio: <strong style="color:var(--texto-2);">${fmtN(dep)}</strong> ${desglose?`· ${desglose}`:""}</div>
      ${badgeProducto(p,_masReciente)?`<div style="margin-top:2px;">${badgeProducto(p,_masReciente)}</div>`:""}
    </div>`;
  }).join("");
  renderResumen("indicador-corte", productos);
}

function setupCant(mId,maId,inId){
  const i=document.getElementById(inId);
  document.getElementById(mId).addEventListener("click",()=>{i.value=Math.max(0.1,parseFloat((parseFloat(i.value)||0)-1).toFixed(2));});
  document.getElementById(maId).addEventListener("click",()=>{i.value=parseFloat((parseFloat(i.value)||0)+1).toFixed(2);});
}
setupCant("ent-menos","ent-mas","ent-cantidad");
setupCant("sal-menos","sal-mas","sal-cantidad");
setupCant("vta-menos","vta-mas","vta-cantidad");

function poblarSelect(id,lista=productos){document.getElementById(id).innerHTML=lista.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("");}
function actualizarUnidad(sId,spanId){const p=productos.find(x=>x.id===document.getElementById(sId).value);document.getElementById(spanId).textContent=p?`(${p.unidad_medida})`:"";}
function ubicacionesDe(prod){const desp=prod.stock_despacho||{};const locs=[{key:"acopio",label:"Acopio",val:prod.stock_deposito??0}];const sectores=[...new Set([...(prod.sectores_asignados||[]),...Object.keys(desp)])];for(const s of sectores)locs.push({key:"desp:"+s,label:"Despacho · "+s,val:desp[s]??0});return locs;}
function poblarUbicacionesAjuste(){const prod=productos.find(p=>p.id===document.getElementById("ajt-producto").value);const sel=document.getElementById("ajt-ubicacion");if(!prod){sel.innerHTML="";document.getElementById("ajt-actual").textContent="";return;}sel.innerHTML=ubicacionesDe(prod).map(u=>`<option value="${u.key}">${u.label} (actual: ${fmtN(u.val)} ${prod.unidad_medida||""})</option>`).join("");actualizarActualAjuste();}
function actualizarActualAjuste(){const prod=productos.find(p=>p.id===document.getElementById("ajt-producto").value);const sel=document.getElementById("ajt-ubicacion");const hint=document.getElementById("ajt-actual");if(!prod||!sel.value){hint.textContent="";return;}const u=ubicacionesDe(prod).find(x=>x.key===sel.value);hint.textContent=u?`· actual: ${fmtN(u.val)}`:"";document.getElementById("ajt-stock").placeholder=u?String(fmtN(u.val)):"0";}
function setupBuscador(bId,sId,uId,extra,fuente){
  const lista=()=>fuente?fuente():productos;
  document.getElementById(bId).oninput=()=>{
    const t=document.getElementById(bId).value.toLowerCase();
    const f=t?lista().filter(p=>p.nombre.toLowerCase().includes(t)):lista();
    document.getElementById(sId).innerHTML=f.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("");
    actualizarUnidad(sId,uId); if(extra)extra();
  };
  document.getElementById(sId).onchange=()=>{actualizarUnidad(sId,uId);if(extra)extra();};
}

// ── ENTRADA ───────────────────────────────────────────────────
document.getElementById("btn-mov-entrada").addEventListener("click",()=>{
  poblarSelect("ent-producto");
  document.getElementById("ent-busqueda").value="";
  document.getElementById("ent-cantidad").value="1";
  document.getElementById("ent-obs").value="";
  actualizarUnidad("ent-producto","ent-unidad");
  setupBuscador("ent-busqueda","ent-producto","ent-unidad");
  document.getElementById("msg-entrada").classList.remove("show");
  abrirModal("modal-entrada");
});

document.getElementById("btn-confirmar-entrada").addEventListener("click",async()=>{
  const tipo=document.getElementById("ent-tipo").value;
  const prodId=document.getElementById("ent-producto").value;
  const cantidad=parseFloat(document.getElementById("ent-cantidad").value)||0;
  const motivo=tipo==="INGRESO_PROVEEDOR"?"Proveedor":"Producción";
  const obs=document.getElementById("ent-obs").value.trim();
  const msgEl=document.getElementById("msg-entrada");
  const btn=document.getElementById("btn-confirmar-entrada");
  const prod=productos.find(p=>p.id===prodId);
  if(!prod||cantidad<=0){mostrarMsg(msgEl,"error","Completá los campos.");return;}
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo,cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen:"externo",destino:"acopio"});
    await updateDoc(doc(db,"productos",prodId),{stock_deposito:increment(cantidad)});
    mostrarMsg(msgEl,"ok",`✓ ${cantidad} ${prod.unidad_medida} ingresados al acopio.`);
    document.getElementById("ent-cantidad").value="1"; cargarMovRecientes();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Registrar entrada";}
});

// ── RETIRO INTELIGENTE v3.5 ───────────────────────────────────
function actualizarInfoRetiro() {
  const prod=productos.find(p=>p.id===document.getElementById("sal-producto").value);
  poblarMotivosSalida(productos, motivosSalida);
  const grupoSector=document.getElementById("sal-grupo-sector");
  const infoDestino=document.getElementById("sal-info-destino");
  const grupoOrigen=document.getElementById("sal-grupo-origen");
  if(!prod){grupoSector.style.display="none";infoDestino.style.display="none";if(grupoOrigen)grupoOrigen.style.display="none";return;}

  let origenEsDespacho=false;
  if(grupoOrigen){
    const despConStock=esDespacho(prod)?Object.entries(prod.stock_despacho||{}).filter(([,v])=>(v||0)>0):[];
    if(acopioBajoOcero(prod)&&despConStock.length>0){
      const sel=document.getElementById("sal-origen");
      if(sel.dataset.prod!==prod.id){
        const opciones=[`<option value="acopio">Acopio (${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida||""})</option>`];
        despConStock.forEach(([s,v])=>opciones.push(`<option value="${s}">${s} (${v} ${prod.unidad_medida||""})</option>`));
        sel.innerHTML=opciones.join("");
        sel.dataset.prod=prod.id;
        sel.onchange=actualizarInfoRetiro;
      }
      grupoOrigen.style.display="";
      origenEsDespacho=origenRetiroActual()!=="acopio";
    }else{
      grupoOrigen.style.display="none";
      document.getElementById("sal-origen").dataset.prod="";
    }
  }

  const motivoObj=motivosSalida.find(m=>m.nombre===document.getElementById("sal-motivo").value);
  const transfiere=!!(motivoObj&&motivoObj.transfiere)&&!origenEsDespacho;

  if(origenEsDespacho){
    grupoSector.style.display="none";
    infoDestino.style.display="";
    const origen=origenRetiroActual();
    infoDestino.innerHTML=`<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">↓ Se descuenta de <strong>${origen}</strong> (sector de despacho). No suma a ningún otro lado.</div>`;
    return;
  }

  if(transfiere&&esDespacho(prod)){
    const sects=sectoresDe(prod);
    if(sects.length>1){
      grupoSector.style.display="";
      document.getElementById("sal-sector-destino").innerHTML=sects.map(s=>`<option value="${s}">${s}</option>`).join("");
      infoDestino.style.display="none";
    }else if(sects.length===1){
      grupoSector.style.display="none";
      infoDestino.style.display="";
      infoDestino.innerHTML=`<div style="background:var(--verde-claro);border:1px solid var(--verde-suave);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-2);">🔁 ${motivoObj.nombre} — el stock irá automáticamente a <strong style="color:var(--verde);">${sects[0]}</strong></div>`;
    }else{
      grupoSector.style.display="none";
      infoDestino.style.display="";
      infoDestino.innerHTML=`<div style="background:var(--bajo-bg);border:1px solid #F0D9B5;border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--bajo-txt);">⚠️ Producto de despacho sin sector asignado.</div>`;
    }
  }else{
    grupoSector.style.display="none";
    infoDestino.style.display="";
    infoDestino.innerHTML=`<div style="background:var(--bg-secondary);border:1px solid var(--borde);border-radius:var(--radio-input);padding:10px 14px;font-size:0.82rem;color:var(--texto-3);">↓ Solo descuenta del acopio${esDespacho(prod)?"":" (materia prima)"}</div>`;
  }
}

document.getElementById("btn-mov-salida").addEventListener("click",()=>{
  poblarSelect("sal-producto");
  document.getElementById("sal-busqueda").value="";
  document.getElementById("sal-cantidad").value="1";
  document.getElementById("sal-obs").value="";
  const go=document.getElementById("sal-grupo-origen");
  if(go)go.style.display="none";
  document.getElementById("sal-origen").dataset.prod="";
  document.getElementById("sal-motivo").onchange=actualizarInfoRetiro;
  actualizarUnidad("sal-producto","sal-unidad");
  setupBuscador("sal-busqueda","sal-producto","sal-unidad",actualizarInfoRetiro);
  actualizarInfoRetiro();
  document.getElementById("msg-salida").classList.remove("show");
  abrirModal("modal-salida");
});

document.getElementById("btn-confirmar-salida").addEventListener("click",async()=>{
  const prodId=document.getElementById("sal-producto").value;
  const cantidad=parseFloat(document.getElementById("sal-cantidad").value)||0;
  const motivo=document.getElementById("sal-motivo").value;
  const obs=document.getElementById("sal-obs").value.trim();
  const msgEl=document.getElementById("msg-salida");
  const btn=document.getElementById("btn-confirmar-salida");
  const prod=productos.find(p=>p.id===prodId);
  if(!prod||cantidad<=0){mostrarMsg(msgEl,"error","Completá los campos.");return;}

  const origen=origenRetiroActual();

  // ── Retiro desde un sector de despacho ──
  if(origen!=="acopio"){
    const stockSector=prod.stock_despacho?.[origen]??0;
    if(cantidad>stockSector){mostrarMsg(msgEl,"error",`Stock insuficiente en ${origen}. Hay ${stockSector} ${prod.unidad_medida}.`);return;}
    btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
    try{
      await updateDoc(doc(db,"productos",prodId),{[`stock_despacho.${origen}`]:increment(-cantidad)});
      await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen,destino:"consumo"});
      mostrarMsg(msgEl,"ok",`✓ Retiro de ${cantidad} ${prod.unidad_medida} desde ${origen}.`);
      document.getElementById("sal-cantidad").value="1"; cargarMovRecientes();
    }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
    finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
    return;
  }

  // ── Retiro desde acopio (flujo normal) ──
  if(cantidad>(prod.stock_deposito??0)){mostrarMsg(msgEl,"error",`Stock insuficiente en acopio. Hay ${prod.stock_deposito??0} ${prod.unidad_medida}.`);return;}
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    const motivoObj=motivosSalida.find(m=>m.nombre===motivo);
    const transfiere=!!(motivoObj&&motivoObj.transfiere);
    let destino="consumo";
    if(transfiere&&esDespacho(prod)){
      const sects=sectoresDe(prod);
      if(sects.length>1)destino=document.getElementById("sal-sector-destino").value;
      else if(sects.length===1)destino=sects[0];
      else throw new Error("El producto no tiene sector de despacho asignado.");
      const batch=writeBatch(db);
      batch.update(doc(db,"productos",prodId),{stock_deposito:increment(-cantidad),[`stock_despacho.${destino}`]:increment(cantidad)});
      await batch.commit();
    }else{
      await updateDoc(doc(db,"productos",prodId),{stock_deposito:increment(-cantidad)});
    }
    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen:"acopio",destino});
    mostrarMsg(msgEl,"ok",destino!=="consumo"?`✓ Retiro de ${cantidad} ${prod.unidad_medida} → ${destino}.`:`✓ Retiro registrado (${motivo}).`);
    document.getElementById("sal-cantidad").value="1"; cargarMovRecientes();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
});

// ── VENTA ─────────────────────────────────────────────────────
function actualizarSectoresVenta() {
  const prod=productos.find(p=>p.id===document.getElementById("vta-producto").value);
  const sel=document.getElementById("vta-sector");
  if(!prod||!esDespacho(prod)){sel.innerHTML='<option value="">—</option>';return;}
  sel.innerHTML=sectoresDe(prod).map(s=>{
    const stock=prod.stock_despacho?.[s]??0;
    return `<option value="${s}">${s} (${stock} ${prod.unidad_medida})</option>`;
  }).join("");
}

document.getElementById("btn-mov-venta").addEventListener("click",()=>{
  const soloDespacho=()=>productos.filter(esDespacho);
  poblarSelect("vta-producto",soloDespacho());
  document.getElementById("vta-busqueda").value="";
  document.getElementById("vta-cantidad").value="1";
  document.getElementById("vta-obs").value="";
  setupBuscador("vta-busqueda","vta-producto","vta-unidad",actualizarSectoresVenta,soloDespacho);
  actualizarUnidad("vta-producto","vta-unidad");
  actualizarSectoresVenta();
  const ahora=new Date();
  const inicioDia=new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate(),0,0);
  document.getElementById("vta-desde").value=aDatetimeLocal(inicioDia);
  document.getElementById("vta-hasta").value=aDatetimeLocal(ahora);
  document.getElementById("msg-venta").classList.remove("show");
  abrirModal("modal-venta");
});

document.getElementById("btn-confirmar-venta").addEventListener("click",async()=>{
  const prodId=document.getElementById("vta-producto").value;
  const cantidad=parseFloat(document.getElementById("vta-cantidad").value)||0;
  const sector=document.getElementById("vta-sector").value;
  const obs=document.getElementById("vta-obs").value.trim();
  const desdeVal=document.getElementById("vta-desde").value;
  const hastaVal=document.getElementById("vta-hasta").value;
  const msgEl=document.getElementById("msg-venta");
  const btn=document.getElementById("btn-confirmar-venta");
  const prod=productos.find(p=>p.id===prodId);
  if(!prod||cantidad<=0||!sector){mostrarMsg(msgEl,"error","Completá los campos.");return;}
  if(!hastaVal){mostrarMsg(msgEl,"error","Indicá hasta qué fecha y hora corresponde la venta.");return;}
  const fechaHasta=new Date(hastaVal);
  const stockSector=prod.stock_despacho?.[sector]??0;
  if(cantidad>stockSector){mostrarMsg(msgEl,"error",`Stock insuficiente en ${sector}. Hay ${stockSector} ${prod.unidad_medida}.`);return;}
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    await updateDoc(doc(db,"productos",prodId),{[`stock_despacho.${sector}`]:increment(-cantidad)});
    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"VENTA",cantidad,unidad:prod.unidad_medida,motivo:obs||"Venta",origen:sector,destino:"salon",periodo_desde:desdeVal?new Date(desdeVal):null,periodo_hasta:fechaHasta});
    if(debeAvanzar(prod.ventas_hasta,fechaHasta)){
      await updateDoc(doc(db,"productos",prodId),{ventas_hasta:fechaHasta});
    }
    mostrarMsg(msgEl,"ok",`✓ Venta registrada desde ${sector}.`);
    document.getElementById("vta-cantidad").value="1";
    actualizarSectoresVenta(); cargarMovRecientes();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Confirmar venta";}
});

// ── AJUSTE ────────────────────────────────────────────────────
document.getElementById("btn-mov-importar").addEventListener("click",abrirImportador);

document.getElementById("btn-mov-ajuste").addEventListener("click",()=>{
  abrirModal("modal-ajuste-tipo");
});

document.getElementById("btn-ajuste-rapido").addEventListener("click",()=>{
  cerrarModal("modal-ajuste-tipo");
  poblarSelect("ajt-producto");
  document.getElementById("ajt-busqueda").value="";
  document.getElementById("ajt-stock").value="";
  document.getElementById("ajt-motivo").value="";
  actualizarUnidad("ajt-producto","ajt-unidad");
  setupBuscador("ajt-busqueda","ajt-producto","ajt-unidad",poblarUbicacionesAjuste);
  poblarUbicacionesAjuste();
  document.getElementById("ajt-ubicacion").onchange=actualizarActualAjuste;
  document.getElementById("msg-ajuste").classList.remove("show");
  abrirModal("modal-ajuste");
});

document.getElementById("btn-ajuste-conteo").addEventListener("click",()=>{
  cerrarModal("modal-ajuste-tipo");
  document.getElementById("pantalla-movimientos-normal").style.display="none";
  document.getElementById("pantalla-conteo").style.display="";
  setProductosConteo(productos);
  abrirConteo();
});

document.getElementById("conteo-btn-volver").addEventListener("click",()=>{
  document.getElementById("pantalla-conteo").style.display="none";
  document.getElementById("pantalla-movimientos-normal").style.display="";
});

document.getElementById("btn-confirmar-ajuste").addEventListener("click",async()=>{
  const prodId=document.getElementById("ajt-producto").value;
  const nuevoStock=parseFloat(document.getElementById("ajt-stock").value);
  const motivo=document.getElementById("ajt-motivo").value.trim();
  const ubic=document.getElementById("ajt-ubicacion").value;
  const msgEl=document.getElementById("msg-ajuste");
  const btn=document.getElementById("btn-confirmar-ajuste");
  const prod=productos.find(p=>p.id===prodId);
  if(!prod||isNaN(nuevoStock)){mostrarMsg(msgEl,"error","Ingresá el nuevo stock.");return;}
  if(!ubic){mostrarMsg(msgEl,"error","Elegí la ubicación a ajustar.");return;}
  if(!motivo){mostrarMsg(msgEl,"error","El motivo es obligatorio.");return;}
  let stockAnterior,update,lugar;
  if(ubic==="acopio"){stockAnterior=prod.stock_deposito??0;update={stock_deposito:nuevoStock};lugar="acopio";}
  else{const sector=ubic.slice(5);const desp={...(prod.stock_despacho||{})};stockAnterior=desp[sector]??0;desp[sector]=nuevoStock;update={stock_despacho:desp};lugar=sector;}
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    await updateDoc(doc(db,"productos",prodId),update);
    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"AJUSTE",cantidad:Math.abs(nuevoStock-stockAnterior),unidad:prod.unidad_medida,motivo:`Ajuste ${lugar}: ${motivo} (${stockAnterior} → ${nuevoStock})`,origen:lugar,destino:lugar});
    mostrarMsg(msgEl,"ok",`✓ ${lugar} ajustado de ${stockAnterior} a ${nuevoStock} ${prod.unidad_medida}.`);
    cargarMovRecientes();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Aplicar ajuste";}
});

// ── MOVIMIENTOS Y HISTORIAL ───────────────────────────────────
const COLORES_MOV={INGRESO_PROVEEDOR:"var(--normal-txt)",INGRESO_PRODUCCION:"var(--normal-txt)",RETIRO:"var(--critico-txt)",VENTA:"var(--verde)",AJUSTE:"var(--texto-2)"};
const LABELS_MOV={INGRESO_PROVEEDOR:"↑ Proveedor",INGRESO_PRODUCCION:"↑ Producción",RETIRO:"↓ Retiro",VENTA:"💰 Venta",AJUSTE:"⚖ Ajuste"};

function filaMov(m){
  const ts=m.fecha_hora?.toDate?.();
  const fecha=ts?ts.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}):"—";
  const hora=ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"";
  const color=COLORES_MOV[m.tipo]||"var(--texto-2)";
  const label=LABELS_MOV[m.tipo]||escHtml(m.tipo);
  const destinoExtra=(m.tipo==="RETIRO"&&m.destino&&m.destino!=="produccion"&&m.destino!=="consumo")?` → ${escHtml(m.destino)}`:"";
  const corregido=m.corregido?` <span style="font-size:0.62rem;background:var(--bg-secondary);color:var(--texto-3);padding:1px 6px;border-radius:5px;display:inline-flex;align-items:center;gap:3px;">${icono("editar",{size:10})} corregido</span>`:"";
  const btnEditar=(m.tipo==="RETIRO"&&m.id)?`<button class="btn-icono" onclick="abrirEditarMotivo('${m.id}')" title="Corregir motivo" style="padding:2px 7px;">${icono("editar",{size:16})}</button>`:"";
  return `<div class="mov-row"><div class="mov-header"><span class="mov-producto">${escHtml(m.nombre_producto||"—")}</span><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:0.85rem;font-weight:700;color:${color};">${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</span>${btnEditar}</div></div><div class="mov-meta">${fecha} ${hora} · <span style="color:${color};font-weight:600;">${label}${destinoExtra}</span> · ${escHtml(m.nombre_usuario||"—")} · ${escHtml(m.motivo||"")}${corregido}</div></div>`;
}

async function cargarMovRecientes() {
  const cont=document.getElementById("lista-mov-recientes");
  const snap=await getDocs(query(collection(db,"movimientos"),orderBy("fecha_hora","desc"),limit(20)));
  if(snap.empty){cont.innerHTML='<div class="empty-state"><p>Sin movimientos.</p></div>';return;}
  const lista=snap.docs.map(d=>({id:d.id,...d.data()}));
  lista.forEach(m=>{movIndex[m.id]=m;});
  cont.innerHTML=lista.map(filaMov).join("");
}

async function cargarHistorial() {
  const snap=await getDocs(query(collection(db,"movimientos"),orderBy("fecha_hora","desc"),limit(200)));
  movCache=snap.docs.map(d=>({id:d.id,...d.data()}));
  movCache.forEach(m=>{movIndex[m.id]=m;});
  const usrs=[...new Set(movCache.map(m=>m.nombre_usuario).filter(Boolean))].sort();
  const prods=[...new Set(movCache.map(m=>m.nombre_producto).filter(Boolean))].sort();
  document.getElementById("filtro-hist-usuario").innerHTML='<option value="">Todos los usuarios</option>'+usrs.map(u=>`<option value="${u}">${u}</option>`).join("");
  document.getElementById("filtro-hist-producto").innerHTML='<option value="">Todos los productos</option>'+prods.map(p=>`<option value="${p}">${p}</option>`).join("");
  renderHistorial();
}

function aplicarFiltros() {
  const tipo=document.getElementById("filtro-hist-tipo").value;
  const usr=document.getElementById("filtro-hist-usuario").value;
  const prod=document.getElementById("filtro-hist-producto").value;
  const desde=document.getElementById("filtro-hist-desde").value;
  const hasta=document.getElementById("filtro-hist-hasta").value;
  let lista=[...movCache];
  if(tipo) lista=lista.filter(m=>m.tipo===tipo);
  if(usr)  lista=lista.filter(m=>m.nombre_usuario===usr);
  if(prod) lista=lista.filter(m=>m.nombre_producto===prod);
  if(desde)lista=lista.filter(m=>{const ts=m.fecha_hora?.toDate?.();return ts&&ts>=new Date(desde+"T00:00:00");});
  if(hasta)lista=lista.filter(m=>{const ts=m.fecha_hora?.toDate?.();return ts&&ts<=new Date(hasta+"T23:59:59");});
  return lista;
}

function renderHistorial() {
  const cont=document.getElementById("lista-historial");
  const lista=aplicarFiltros();
  if(!lista.length){cont.innerHTML='<div class="empty-state"><p>Sin resultados.</p></div>';return;}
  cont.innerHTML=lista.map(filaMov).join("");
}

// ── CORREGIR MOTIVO DE UN RETIRO (reverse + apply, contempla origen) ──
let edmMov=null;
const esDestinoSector=(x)=>!!x&&!["consumo","produccion","externo","salon","acopio",""].includes(x);
function efectoRetiro(origen,destino,cantidad){
  const ef={acopio:0,despacho:{}};
  if(!origen||origen==="acopio"){
    ef.acopio-=cantidad;
    if(esDestinoSector(destino))ef.despacho[destino]=(ef.despacho[destino]||0)+cantidad;
  }else{
    ef.despacho[origen]=(ef.despacho[origen]||0)-cantidad;
    if(esDestinoSector(destino))ef.despacho[destino]=(ef.despacho[destino]||0)+cantidad;
  }
  return ef;
}
window.abrirEditarMotivo=(id)=>{
  const m=movIndex[id];
  if(!m||m.tipo!=="RETIRO")return;
  edmMov=m;
  const prod=productos.find(p=>p.id===m.id_producto);
  const base=(m.motivo||"").split(" — ")[0];
  const desdeDespacho=!!(m.origen&&m.origen!=="acopio");
  document.getElementById("edm-info").innerHTML=`<div><strong>${escHtml(m.nombre_producto)}</strong> · ${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</div><div style="color:var(--texto-3);font-size:0.78rem;margin-top:2px;">Motivo actual: ${escHtml(m.motivo||"—")} · salió de <strong>${escHtml(m.origen||"acopio")}</strong>${esDestinoSector(m.destino)?" → "+escHtml(m.destino):""}</div>`;
  const sel=document.getElementById("edm-motivo");
  let opciones=motivosSalida;
  if((prod&&!esDespacho(prod))||desdeDespacho)opciones=motivosSalida.filter(x=>!x.transfiere);
  sel.innerHTML=opciones.map(x=>`<option value="${x.nombre}" ${x.nombre===base?"selected":""}>${x.nombre}${x.transfiere?" (→ despacho)":""}</option>`).join("");
  edmActualizar();
  document.getElementById("msg-editar-motivo").classList.remove("show");
  abrirModal("modal-editar-motivo");
};
function edmDestinoNuevo(prod,newTransf){
  if(!newTransf)return "consumo";
  const sects=sectoresDe(prod);
  if(!sects.length)return null;
  return sects.length>1?document.getElementById("edm-sector").value:sects[0];
}
function edmEsTransfNuevo(){
  const m=edmMov;if(!m)return false;
  const prod=productos.find(p=>p.id===m.id_producto);
  const origen=m.origen||"acopio";
  const mo=motivosSalida.find(x=>x.nombre===document.getElementById("edm-motivo").value);
  return !!(mo&&mo.transfiere)&&esDespacho(prod)&&origen==="acopio";
}
function edmActualizar(){
  const m=edmMov;if(!m)return;
  const prod=productos.find(p=>p.id===m.id_producto);
  const origen=m.origen||"acopio";
  const newTransf=edmEsTransfNuevo();
  const grupo=document.getElementById("edm-grupo-sector");
  if(newTransf){
    const sects=sectoresDe(prod);
    document.getElementById("edm-sector").innerHTML=sects.map(s=>`<option value="${s}" ${s===m.destino?"selected":""}>${s}</option>`).join("");
    grupo.style.display=sects.length>1?"":"none";
  }else{grupo.style.display="none";}
  const newDestino=newTransf?edmDestinoNuevo(prod,true):"consumo";
  const oldEf=efectoRetiro(origen,m.destino,m.cantidad);
  const newEf=efectoRetiro(origen,newDestino,m.cantidad);
  const u=m.unidad||"";
  const partes=[];
  const dAcopio=newEf.acopio-oldEf.acopio;
  if(dAcopio)partes.push(`acopio ${dAcopio>0?"+":""}${+dAcopio.toFixed(3)} ${u}`);
  new Set([...Object.keys(oldEf.despacho),...Object.keys(newEf.despacho)]).forEach(s=>{
    const d=(newEf.despacho[s]||0)-(oldEf.despacho[s]||0);
    if(d)partes.push(`${s} ${d>0?"+":""}${+d.toFixed(3)} ${u}`);
  });
  document.getElementById("edm-preview").textContent=partes.length
    ?`Se revierte el movimiento y se aplica el nuevo. Ajuste neto: ${partes.join(", ")}.`
    :"Sin cambios de stock — solo se corrige la etiqueta del motivo.";
}
document.getElementById("edm-motivo").addEventListener("change",edmActualizar);
document.getElementById("edm-sector").addEventListener("change",edmActualizar);
document.getElementById("btn-confirmar-editar-motivo").addEventListener("click",async()=>{
  const m=edmMov;
  const msgEl=document.getElementById("msg-editar-motivo");
  const btn=document.getElementById("btn-confirmar-editar-motivo");
  if(!m)return;
  const prod=productos.find(p=>p.id===m.id_producto);
  if(!prod){mostrarMsg(msgEl,"error","El producto de este movimiento ya no existe.");return;}
  const nuevo=document.getElementById("edm-motivo").value;
  const base=(m.motivo||"").split(" — ")[0];
  const obs=(m.motivo||"").includes(" — ")?(m.motivo||"").split(" — ").slice(1).join(" — "):"";
  if(nuevo===base){mostrarMsg(msgEl,"error","Elegí un motivo distinto al actual.");return;}
  const origen=m.origen||"acopio";
  const newTransf=edmEsTransfNuevo();
  const newDestino=newTransf?edmDestinoNuevo(prod,true):"consumo";
  if(newTransf&&!newDestino){mostrarMsg(msgEl,"error","El producto no tiene sector de despacho asignado.");return;}
  const oldEf=efectoRetiro(origen,m.destino,m.cantidad);
  const newEf=efectoRetiro(origen,newDestino,m.cantidad);
  const nuevoAcopio=+((prod.stock_deposito??0)+(newEf.acopio-oldEf.acopio)).toFixed(4);
  const despacho={...(prod.stock_despacho||{})};
  new Set([...Object.keys(oldEf.despacho),...Object.keys(newEf.despacho)]).forEach(s=>{
    despacho[s]=+((despacho[s]??0)+((newEf.despacho[s]||0)-(oldEf.despacho[s]||0))).toFixed(4);
  });
  // Escrituras atómicas: aplicamos los deltas con increment (no pisa cambios
  // concurrentes en otros sectores ni el valor real del acopio).
  const prodUpdate={};
  const dAcopio=newEf.acopio-oldEf.acopio;
  if(dAcopio)prodUpdate.stock_deposito=increment(dAcopio);
  new Set([...Object.keys(oldEf.despacho),...Object.keys(newEf.despacho)]).forEach(s=>{
    const d=(newEf.despacho[s]||0)-(oldEf.despacho[s]||0);
    if(d)prodUpdate[`stock_despacho.${s}`]=increment(d);
  });
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    const batch=writeBatch(db);
    if(Object.keys(prodUpdate).length)batch.update(doc(db,"productos",prod.id),prodUpdate);
    batch.update(doc(db,"movimientos",m.id),{motivo:obs?`${nuevo} — ${obs}`:nuevo,destino:newDestino,corregido:true,motivo_anterior:m.motivo,fecha_correccion:serverTimestamp()});
    await batch.commit();
    prod.stock_deposito=nuevoAcopio;
    prod.stock_despacho=despacho;
    m.motivo=obs?`${nuevo} — ${obs}`:nuevo;m.destino=newDestino;m.corregido=true;
    cerrarModal("modal-editar-motivo");
    cargarMovRecientes();renderStock();
    if(movCache.length)renderHistorial();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Aplicar corrección";}
});

document.getElementById("btn-aplicar-filtros").addEventListener("click",renderHistorial);
document.getElementById("btn-limpiar-filtros").addEventListener("click",()=>{
  ["filtro-hist-tipo","filtro-hist-usuario","filtro-hist-producto","filtro-hist-desde","filtro-hist-hasta"].forEach(id=>document.getElementById(id).value="");
  renderHistorial();
});

document.getElementById("btn-exportar-excel").addEventListener("click",async()=>{
  const lista=aplicarFiltros();
  if(!lista.length){alert("No hay datos para exportar.");return;}
  const btn=document.getElementById("btn-exportar-excel");
  btn.disabled=true;btn.textContent="Generando...";
  const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
  const filas=lista.map(m=>{const ts=m.fecha_hora?.toDate?.();return{"Fecha":ts?ts.toLocaleDateString("es-AR"):"—","Hora":ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"—","Producto":m.nombre_producto||"—","Tipo":m.tipo||"—","Cantidad":m.cantidad??0,"Unidad":m.unidad||"—","Origen":m.origen||"—","Destino":m.destino||"—","Motivo":m.motivo||"—","Usuario":m.nombre_usuario||"—"};});
  const ws=XLSX.utils.json_to_sheet(filas);ws["!cols"]=[{wch:12},{wch:8},{wch:28},{wch:20},{wch:10},{wch:10},{wch:15},{wch:15},{wch:35},{wch:20}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Historial");
  XLSX.writeFile(wb,`historial-administrador-${new Date().toLocaleDateString("es-AR").replace(/\//g,"-")}.xlsx`);
  btn.disabled=false;btn.textContent="📥 Exportar a Excel";
});

function mostrarMsg(el,tipo,texto){el.textContent=texto;el.className=`msg show msg-${tipo==="error"?"error":"ok"}`;}

// El sello de versión lo aplica js/version.js (cargado desde el HTML de la vista).
