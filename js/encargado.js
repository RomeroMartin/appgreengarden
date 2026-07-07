// ============================================================
// encargado.js — Panel Encargado v3.0
// Entradas + Retiro inteligente + Historial (sin Venta)
// ============================================================

import { auth, db } from "./firebase-config.js";
import { protegerRuta, logout } from "./auth.js";
import {
  collection, doc, addDoc, updateDoc, getDocs,
  onSnapshot, query, orderBy, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

protegerRuta("Encargado");

let productos     = [];
let movCache      = [];
let usuarioActual = null;

function stockTotal(p) {
  return (p.stock_deposito??0) + Object.values(p.stock_despacho??{}).reduce((a,b)=>a+(b||0),0);
}

function fmtN(n){const x=Number(n)||0;return +x.toFixed(2);}
// Escapa datos antes de inyectarlos por innerHTML (evita XSS via motivo/nombres).
function escHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function getBadge(p) {
  const total=stockTotal(p),min=p.stock_minimo;
  if(min==null||min==="")return null;
  if(total<=0)return{cls:"critico",label:"Sin stock"};
  if(total<=min)return{cls:"critico",label:"Bajo mínimo"};
  return null;
}
function esDespacho(p){return p.tipo==="Despacho";}
function sectoresDe(p){return p.sectores_asignados??[];}
function acopioBajoOcero(p){const dep=p.stock_deposito??0;const min=p.stock_minimo;if(dep<=0)return true;if(min!=null&&min!==""&&dep<=min)return true;return false;}
function origenRetiroActual(){const g=document.getElementById("sal-grupo-origen");if(g&&g.style.display!=="none")return document.getElementById("sal-origen").value||"acopio";return "acopio";}

const MOTIVOS_SALIDA_DEFAULT=[
  {nombre:"Retiro para uso",transfiere:false},
  {nombre:"Merma / Desperdicio",transfiere:false},
  {nombre:"Vencimiento",transfiere:false},
  {nombre:"Rotura",transfiere:false},
  {nombre:"Reposición",transfiere:true}
];
let motivosSalida=[...MOTIVOS_SALIDA_DEFAULT];

function poblarMotivosSalida(){
  const prod=productos.find(p=>p.id===document.getElementById("sal-producto")?.value);
  const sel=document.getElementById("sal-motivo");
  if(!sel)return;
  const actual=sel.value;
  const lista=(prod&&!esDespacho(prod))?motivosSalida.filter(m=>!m.transfiere):motivosSalida;
  sel.innerHTML=lista.map(m=>`<option value="${m.nombre}">${m.nombre}</option>`).join("");
  if(lista.some(m=>m.nombre===actual))sel.value=actual;
}


document.addEventListener("usuarioListo",(e)=>{
  usuarioActual=e.detail;
  document.getElementById("pantalla-carga").style.display="none";
  document.getElementById("contenido").style.display="flex";
  document.getElementById("saludo").textContent=`Hola, ${usuarioActual.nombre.split(" ")[0]} 👋`;
  document.getElementById("fecha-hoy").textContent=new Date().toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"});
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
    const sel=document.getElementById("filtro-sector");
    sel.innerHTML='<option value="">Todos los sectores</option>'+sects.map(s=>`<option value="${s}">${s}</option>`).join("");
  });
  onSnapshot(collection(db,"rubros"),snap=>{
    const rubs=snap.docs.map(d=>d.data().nombre);
    const sel=document.getElementById("filtro-rubro");
    sel.innerHTML='<option value="">Todos los rubros</option>'+rubs.map(r=>`<option value="${r}">${r}</option>`).join("");
  });
  onSnapshot(query(collection(db,"productos"),orderBy("nombre")),snap=>{
    productos=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderInventario(); renderAlertas();
  });
  cargarMovimientos();
}

document.getElementById("filtro-sector").addEventListener("change",renderInventario);
document.getElementById("filtro-rubro").addEventListener("change",renderInventario);
document.getElementById("filtro-busqueda").addEventListener("input",renderInventario);

function renderAlertas() {
  const alertas=productos.filter(p=>{const min=p.stock_minimo;return min!=null&&min!==""&&stockTotal(p)<=min;});
  const sec=document.getElementById("seccion-alertas"),lst=document.getElementById("lista-alertas");
  if(!alertas.length){sec.style.display="none";return;}
  sec.style.display="block";
  lst.innerHTML=alertas.map(p=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(217,83,79,0.15);"><span style="font-size:0.88rem;font-weight:600;">${escHtml(p.nombre)}</span><span style="font-weight:700;color:var(--critico-txt);">${fmtN(stockTotal(p))} / ${p.stock_minimo} ${escHtml(p.unidad_medida||"")}</span></div>`).join("");
}

function renderInventario() {
  const sector=document.getElementById("filtro-sector").value;
  const rubro=document.getElementById("filtro-rubro").value;
  const busq=document.getElementById("filtro-busqueda").value.toLowerCase();
  const cont=document.getElementById("lista-inventario");
  let lista=productos;
  if(sector)lista=lista.filter(p=>p.sector===sector);
  if(rubro) lista=lista.filter(p=>p.rubro===rubro);
  if(busq)  lista=lista.filter(p=>p.nombre.toLowerCase().includes(busq));
  if(!lista.length){cont.innerHTML='<div class="empty-state"><p>Sin resultados.</p></div>';return;}
  cont.innerHTML=lista.map(p=>{
    const total=stockTotal(p);const badge=getBadge(p);
    const dep=p.stock_deposito??0;const des=p.stock_despacho??{};
    const tipoBadge=esDespacho(p)?'<span style="font-size:0.65rem;background:var(--verde-claro);color:var(--verde);padding:2px 8px;border-radius:10px;font-weight:600;">🥤</span>':'<span style="font-size:0.65rem;background:var(--bg-secondary);color:var(--texto-3);padding:2px 8px;border-radius:10px;font-weight:600;">🌾</span>';
    const desglose=Object.entries(des).filter(([,v])=>v>0).map(([k,v])=>`<span style="font-size:0.75rem;background:var(--bg-secondary);padding:2px 8px;border-radius:4px;margin:2px;">${escHtml(k)}: <strong>${fmtN(v)}</strong></span>`).join("");
    return `<div class="item-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        <div><div class="item-nombre">${escHtml(p.nombre)} ${tipoBadge}</div><div class="item-meta">Acopio: ${escHtml(p.sector||"—")} · ${escHtml(p.rubro||"—")}</div></div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.9rem;font-weight:600;color:var(--texto-2);">Total: ${fmtN(total)} ${p.unidad_medida||""}</div>
          ${badge?`<span class="stock-badge ${badge.cls}">${badge.label}</span>`:""}
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--texto-3);">🏪 Acopio: <strong style="color:var(--texto-2);">${fmtN(dep)}</strong>${desglose?` · ${desglose}`:""}</div>
    </div>`;
  }).join("");
}

function setupCant(mId,maId,inId){
  const i=document.getElementById(inId);
  document.getElementById(mId).addEventListener("click",()=>{i.value=Math.max(0.1,parseFloat((parseFloat(i.value)||0)-1).toFixed(2));});
  document.getElementById(maId).addEventListener("click",()=>{i.value=parseFloat((parseFloat(i.value)||0)+1).toFixed(2);});
}
setupCant("ent-menos","ent-mas","ent-cantidad");
setupCant("sal-menos","sal-mas","sal-cantidad");

function poblarSelect(id,lista=productos){document.getElementById(id).innerHTML=lista.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("");}
function actualizarUnidad(sId,spanId){const p=productos.find(x=>x.id===document.getElementById(sId).value);document.getElementById(spanId).textContent=p?`(${p.unidad_medida})`:"";}
function setupBuscador(bId,sId,uId,extra){
  document.getElementById(bId).oninput=()=>{
    const t=document.getElementById(bId).value.toLowerCase();
    const f=t?productos.filter(p=>p.nombre.toLowerCase().includes(t)):productos;
    document.getElementById(sId).innerHTML=f.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join("");
    actualizarUnidad(sId,uId); if(extra)extra();
  };
  document.getElementById(sId).onchange=()=>{actualizarUnidad(sId,uId);if(extra)extra();};
}

// ── ENTRADA ───────────────────────────────────────────────────
document.getElementById("btn-abrir-entrada").addEventListener("click",()=>{
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
    await updateDoc(doc(db,"productos",prodId),{stock_deposito:(prod.stock_deposito??0)+cantidad});
    mostrarMsg(msgEl,"ok",`✓ ${cantidad} ${prod.unidad_medida} ingresados al acopio.`);
    document.getElementById("ent-cantidad").value="1"; cargarMovimientos();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Registrar entrada";}
});

// ── RETIRO INTELIGENTE ────────────────────────────────────────
function actualizarInfoRetiro() {
  const prod=productos.find(p=>p.id===document.getElementById("sal-producto").value);
  poblarMotivosSalida();
  const grupoSector=document.getElementById("sal-grupo-sector");
  const infoDestino=document.getElementById("sal-info-destino");
  const grupoOrigen=document.getElementById("sal-grupo-origen");
  if(!prod){grupoSector.style.display="none";infoDestino.style.display="none";if(grupoOrigen)grupoOrigen.style.display="none";return;}

  // ── Selector de origen inteligente ──
  let origenEsDespacho=false;
  if(grupoOrigen){
    const despachoConStock=esDespacho(prod)?Object.entries(prod.stock_despacho||{}).filter(([,v])=>(v||0)>0):[];
    if(acopioBajoOcero(prod)&&despachoConStock.length>0){
      const sel=document.getElementById("sal-origen");
      if(sel.dataset.prod!==prod.id){
        const ops=[`<option value="acopio">Acopio (${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida||""})</option>`];
        despachoConStock.forEach(([s,v])=>ops.push(`<option value="${s}">${s} (${fmtN(v)} ${prod.unidad_medida||""})</option>`));
        sel.innerHTML=ops.join("");
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

document.getElementById("btn-abrir-salida").addEventListener("click",()=>{
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
  // ── Retiro desde un sector de despacho (acopio sin stock) ──
  if(origen!=="acopio"){
    const stockSector=prod.stock_despacho?.[origen]??0;
    if(cantidad>stockSector){mostrarMsg(msgEl,"error",`Stock insuficiente en ${origen}. Hay ${fmtN(stockSector)} ${prod.unidad_medida}.`);return;}
    btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
    try{
      await updateDoc(doc(db,"productos",prodId),{[`stock_despacho.${origen}`]:Math.max(0,stockSector-cantidad)});
      if(!prod.stock_despacho)prod.stock_despacho={};
      prod.stock_despacho[origen]=Math.max(0,stockSector-cantidad);
      await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen,destino:"consumo"});
      mostrarMsg(msgEl,"ok",`✓ Retiro de ${cantidad} ${prod.unidad_medida} desde ${origen}.`);
      document.getElementById("sal-cantidad").value="1"; cargarMovimientos();
    }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
    finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
    return;
  }

  if(cantidad>(prod.stock_deposito??0)){mostrarMsg(msgEl,"error",`Stock insuficiente en acopio. Hay ${fmtN(prod.stock_deposito??0)} ${prod.unidad_medida}.`);return;}
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
      batch.update(doc(db,"productos",prodId),{stock_deposito:Math.max(0,(prod.stock_deposito??0)-cantidad),[`stock_despacho.${destino}`]:((prod.stock_despacho?.[destino]??0)+cantidad)});
      await batch.commit();
    }else{
      await updateDoc(doc(db,"productos",prodId),{stock_deposito:Math.max(0,(prod.stock_deposito??0)-cantidad)});
    }
    await addDoc(collection(db,"movimientos"),{fecha_hora:serverTimestamp(),id_usuario:auth.currentUser?.uid,nombre_usuario:usuarioActual.nombre,id_producto:prodId,nombre_producto:prod.nombre,tipo:"RETIRO",cantidad,unidad:prod.unidad_medida,motivo:obs?`${motivo} — ${obs}`:motivo,origen:"acopio",destino});
    mostrarMsg(msgEl,"ok",destino!=="consumo"?`✓ Retiro de ${cantidad} ${prod.unidad_medida} → ${destino}.`:`✓ Retiro registrado (${motivo}).`);
    document.getElementById("sal-cantidad").value="1"; cargarMovimientos();
  }catch(err){mostrarMsg(msgEl,"error","Error: "+err.message);}
  finally{btn.disabled=false;btn.innerHTML="Registrar retiro";}
});

// ── MOVIMIENTOS ───────────────────────────────────────────────
async function cargarMovimientos() {
  const snap=await getDocs(query(collection(db,"movimientos"),orderBy("fecha_hora","desc"),limit(200)));
  movCache=snap.docs.map(d=>d.data());
  const prods=[...new Set(movCache.map(m=>m.nombre_producto).filter(Boolean))].sort();
  document.getElementById("filtro-mov-producto").innerHTML='<option value="">Todos los productos</option>'+prods.map(p=>`<option value="${p}">${p}</option>`).join("");
  renderMovimientos();
}

function aplicarFiltrosMov() {
  const tipo=document.getElementById("filtro-mov-tipo").value;
  const prod=document.getElementById("filtro-mov-producto").value;
  const desde=document.getElementById("filtro-mov-desde").value;
  const hasta=document.getElementById("filtro-mov-hasta").value;
  let lista=[...movCache];
  if(tipo) lista=lista.filter(m=>m.tipo===tipo);
  if(prod) lista=lista.filter(m=>m.nombre_producto===prod);
  if(desde)lista=lista.filter(m=>{const ts=m.fecha_hora?.toDate?.();return ts&&ts>=new Date(desde);});
  if(hasta)lista=lista.filter(m=>{const ts=m.fecha_hora?.toDate?.();const h=new Date(hasta);h.setHours(23,59,59);return ts&&ts<=h;});
  return lista;
}

function renderMovimientos() {
  const cont=document.getElementById("lista-movimientos");
  const lista=aplicarFiltrosMov();
  if(!lista.length){cont.innerHTML='<div class="empty-state"><p>Sin resultados.</p></div>';return;}
  const colores={INGRESO_PROVEEDOR:"var(--normal-txt)",INGRESO_PRODUCCION:"var(--normal-txt)",RETIRO:"var(--critico-txt)",VENTA:"var(--verde)",AJUSTE:"var(--texto-2)"};
  const labels={INGRESO_PROVEEDOR:"↑ Proveedor",INGRESO_PRODUCCION:"↑ Producción",RETIRO:"↓ Retiro",VENTA:"💰 Venta",AJUSTE:"⚖ Ajuste"};
  cont.innerHTML=lista.map(m=>{
    const ts=m.fecha_hora?.toDate?.();
    const fecha=ts?ts.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"}):"—";
    const hora=ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"";
    const color=colores[m.tipo]||"var(--texto-2)";const label=labels[m.tipo]||escHtml(m.tipo);
    const destinoExtra=(m.tipo==="RETIRO"&&m.destino&&m.destino!=="produccion"&&m.destino!=="consumo")?` → ${escHtml(m.destino)}`:"";
    return `<div class="mov-row"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;"><span style="font-size:0.9rem;font-weight:600;">${escHtml(m.nombre_producto||"—")}</span><span style="font-size:0.85rem;font-weight:700;color:${color};">${escHtml(m.cantidad)} ${escHtml(m.unidad||"")}</span></div><div style="font-size:0.75rem;color:var(--texto-3);">${fecha} ${hora} · <span style="color:${color};font-weight:600;">${label}${destinoExtra}</span> · ${escHtml(m.nombre_usuario||"—")}</div></div>`;
  }).join("");
}

document.getElementById("btn-aplicar-mov").addEventListener("click",renderMovimientos);
document.getElementById("btn-limpiar-mov").addEventListener("click",()=>{
  ["filtro-mov-tipo","filtro-mov-producto","filtro-mov-desde","filtro-mov-hasta"].forEach(id=>document.getElementById(id).value="");
  renderMovimientos();
});

document.getElementById("btn-exportar-excel-enc").addEventListener("click",async()=>{
  const lista=aplicarFiltrosMov();
  if(!lista.length){alert("No hay datos.");return;}
  const btn=document.getElementById("btn-exportar-excel-enc");
  btn.disabled=true;btn.textContent="Generando...";
  const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
  const filas=lista.map(m=>{const ts=m.fecha_hora?.toDate?.();return{"Fecha":ts?ts.toLocaleDateString("es-AR"):"—","Hora":ts?ts.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}):"—","Producto":m.nombre_producto||"—","Tipo":m.tipo||"—","Cantidad":m.cantidad??0,"Unidad":m.unidad||"—","Origen":m.origen||"—","Destino":m.destino||"—","Motivo":m.motivo||"—","Usuario":m.nombre_usuario||"—"};});
  const ws=XLSX.utils.json_to_sheet(filas);ws["!cols"]=[{wch:12},{wch:8},{wch:28},{wch:20},{wch:10},{wch:10},{wch:15},{wch:15},{wch:35},{wch:20}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Movimientos");
  XLSX.writeFile(wb,`movimientos-encargado-${new Date().toLocaleDateString("es-AR").replace(/\//g,"-")}.xlsx`);
  btn.disabled=false;btn.textContent="📥 Exportar a Excel";
});

function mostrarMsg(el,tipo,texto){el.textContent=texto;el.className=`msg show msg-${tipo==="error"?"error":"ok"}`;}

// ── Sello de versión (autocontenido, no depende de version.js) ──
(function () {
  let v = document.querySelector(".app-version");
  if (!v) { v = document.createElement("div"); (document.body || document.documentElement).appendChild(v); }
  v.textContent = "v3.8.7";
  v.style.cssText = "position:fixed;bottom:8px;right:10px;font:600 11px/1 ui-monospace,monospace;color:#9a7f43;background:rgba(248,244,234,0.92);border:1px solid #ddd0b8;padding:3px 9px;border-radius:20px;z-index:99999;pointer-events:none;letter-spacing:0.5px;box-shadow:0 1px 4px rgba(0,0,0,0.08);";
})();
