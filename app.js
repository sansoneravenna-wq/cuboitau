/* Cubo Itaú Eventos · sitio público y panel de administración (sin paso de compilación) */
(function () {
"use strict";

var CFG = window.CUBO_CONFIG || {};
var TZ = "America/Montevideo";
var BASE = [
  { id: "nombre", label: "Nombre", type: "text", required: true },
  { id: "apellido", label: "Apellido", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "empresa", label: "Empresa", type: "text", required: true }
];
var TYPES = { text: "Texto corto", textarea: "Texto largo", select: "Opción única", checkbox: "Casilla" };
var MAILDEF = {
  pendiente: { subj: "Recibimos tu solicitud para {evento}", body: "Tu inscripción quedó pendiente de aprobación. El equipo de Cubo Itaú la va a revisar y te avisamos por este medio." },
  aprobada: { subj: "¡Inscripción aprobada! {evento}", body: "Tu lugar está confirmado. Presentá el código QR de este correo en el ingreso." },
  rechazada: { subj: "Tu solicitud para {evento}", body: "Esta vez no pudimos confirmar tu lugar. Gracias por tu interés; te esperamos en los próximos eventos." }
};
var MAILNAME = { pendiente: "Al inscribirse", aprobada: "Al aprobar", rechazada: "Al rechazar" };
var STATUS = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };

var api = null;
var S = { events: [], counts: {}, regs: [], session: null, org: null, log: [], conf: null, ticket: undefined, ready: false };
var UI = { tab: "insc", filter: "todas", formOpen: false, err: "", sent: false, scan: null, mk: "pendiente", cur: null, loginErr: "" };
var cam = { stream: null, on: false, paused: false, timer: 0, canvas: null };

/* ───────── acceso a datos ───────── */
function makeApi(sb) {
  function un(p) { return p.then(function (r) { if (r.error) throw new Error(r.error.message || "Algo falló. Probá de nuevo."); return r.data; }); }
  return {
    session: function () { return sb.auth.getSession().then(function (r) { return r.data.session; }); },
    myOrg: function () { return un(sb.from("admins").select("org").maybeSingle()).then(function (d) { return d ? d.org : null; }); },
    login: function (e, p) { return sb.auth.signInWithPassword({ email: e, password: p }).then(function (r) { if (r.error) throw new Error("Email o contraseña incorrectos."); return r.data.session; }); },
    logout: function () { return sb.auth.signOut(); },
    events: function () { return un(sb.from("events").select("*").order("starts_at")); },
    counts: function () { return un(sb.rpc("public_counts")); },
    register: function (ev, data, hp) { return un(sb.rpc("register", { p_event: ev, p_data: data, p_hp: hp || "" })); },
    ticket: function (c) { return un(sb.rpc("ticket", { p_code: c })); },
    confirm: function (c) { return un(sb.rpc("confirm_attendance", { p_code: c })); },
    regs: function (ev) { var q = sb.from("registrations").select("*").order("created_at"); if (ev) q = q.eq("event_id", ev); return un(q); },
    review: function (id, action, qr) { return un(sb.rpc("review", { p_reg: id, p_action: action, p_qr_url: qr || null })); },
    createEvent: function (row) { return un(sb.from("events").insert(row).select().single()); },
    saveEvent: function (id, patch) { return un(sb.from("events").update(patch).eq("id", id).select().single()); },
    upload: function (bucket, path, blob, type) {
      return un(sb.storage.from(bucket).upload(path, blob, { upsert: true, contentType: type, cacheControl: "3600" }))
        .then(function () { return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl; });
    },
    validate: function (ev, code) { return un(sb.rpc("checkin_validate", { p_event: ev, p_code: code })); },
    mark: function (id, print) { return un(sb.rpc("checkin_mark", { p_reg: id, p_print: !!print })); },
    log: function (ev) { return un(sb.rpc("email_log_list", { p_event: ev })); },
    conf: function () { return un(sb.rpc("config_status")); },
    setConf: function (k, v) { return un(sb.rpc("set_config", { p_key: k, p_value: v })); },
    testMail: function (to) { return un(sb.rpc("send_test_mail", { p_to: to })); }
  };
}

/* ───────── utilidades ───────── */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function fmt(iso, o) { return new Intl.DateTimeFormat("es-UY", Object.assign({ timeZone: TZ }, o)).format(new Date(iso)); }
function when(e) { return fmt(e.starts_at, { weekday: "long", day: "numeric", month: "long" }); }
function hm(iso) { return fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
function hours(e) { return hm(e.starts_at) + " a " + hm(e.ends_at) + " h"; }
function cap1(s) { return s.replace(/^./, function (c) { return c.toUpperCase(); }); }
function loc(iso) { var d = new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString(); return { d: d.slice(0, 10), t: d.slice(11, 16) }; }
function toIso(d, t) { return new Date(d + "T" + t + ":00-03:00").toISOString(); }
function fieldsOf(e) { return BASE.concat(e.fields || []); }
function evById(id) { return S.events.find(function (e) { return e.id === id; }); }
function cur() { return evById(UI.cur); }
function fullName(r) { return (r.data.nombre || "") + " " + (r.data.apellido || ""); }
function toast(t) { var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 3200); }
function fail(e) { toast((e && e.message) || "Algo falló. Probá de nuevo."); }
function slugify(t) { return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "evento"; }
function route() {
  var p = location.hash.replace(/^#\/?/, "").split("/");
  if (p[0] === "e" && p[1]) return { v: "evento", slug: decodeURIComponent(p[1]) };
  if (p[0] === "entrada" && p[1]) return { v: "entrada", code: decodeURIComponent(p[1]).toUpperCase() };
  if (p[0] === "admin") return { v: "admin" };
  return { v: "agenda" };
}
function tpl(e, kind) { var m = (e.mails || {})[kind] || {}; return { subj: m.subj || MAILDEF[kind].subj, body: m.body || MAILDEF[kind].body }; }
function fill(t, e, d) {
  return t.replace(/\{(nombre|apellido|empresa|evento|fecha|hora|lugar)\}/g, function (_, k) {
    return { nombre: d.nombre, apellido: d.apellido, empresa: d.empresa, evento: e.title, fecha: when(e), hora: hours(e), lugar: e.place }[k] || "";
  });
}
function gcal(e, code) {
  var z = function (i) { return new Date(i).toISOString().replace(/[-:]/g, "").replace(".000", ""); };
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title + " · Cubo Itaú") +
    "&dates=" + z(e.starts_at) + "/" + z(e.ends_at) + "&location=" + encodeURIComponent(e.place + ", " + e.address) +
    "&details=" + encodeURIComponent("Presentá tu código QR en el ingreso." + (code ? " Código: " + code : ""));
}
function qrMatrix(text) { var q = qrcode(0, "M"); q.addData(text); q.make(); return q; }
function qrSvg(text) {
  if (typeof qrcode !== "function") return "";
  var q = qrMatrix(text), n = q.getModuleCount(), d = "";
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) d += "M" + x + " " + y + "h1v1h-1z";
  return '<svg viewBox="0 0 ' + n + " " + n + '" role="img" aria-label="Código QR ' + esc(text) + '" shape-rendering="crispEdges"><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
function qrBlob(text) {
  return new Promise(function (res, rej) {
    var q = qrMatrix(text), n = q.getModuleCount(), sc = 8, m = 4, c = document.createElement("canvas");
    c.width = c.height = (n + 2 * m) * sc;
    var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#000";
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + m) * sc, (r + m) * sc, sc, sc);
    c.toBlob(function (b) { b ? res(b) : rej(new Error("No se pudo generar el QR.")); }, "image/png");
  });
}
function cover(e, thumb) {
  if (e.image_url) return '<div class="cover' + (thumb ? " thumb" : "") + '" role="img" aria-label="' + esc(e.title) + '" style="background:#101012 url(&quot;' + esc(e.image_url) + '&quot;) center/cover"></div>';
  var hue = 0; for (var i = 0; i < e.title.length; i++) hue = (hue + e.title.charCodeAt(i) * 7) % 90;
  return '<div class="cover' + (thumb ? " thumb" : "") + '" style="background:linear-gradient(' + (120 + hue) + 'deg,#3a3a3f,#101012 70%)">' +
    '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".6">' +
    '<path d="M62 14 92 31v34L62 82 32 65V31z"/><path d="M32 31l30 17 30-17M62 48v34"/><path d="M62 2 104 26v48L62 98 20 74V26z"/></g></svg><span>' + esc(e.title) + "</span></div>";
}
function formHtml(e, pre, dis) {
  var a = dis ? " disabled" : "";
  return fieldsOf(e).map(function (f) {
    var id = pre + "-" + f.id, req = f.required ? ' <span class="note">(obligatorio)</span>' : "", c;
    if (f.type === "checkbox") return '<div class="field check"><input type="checkbox" id="' + id + '"' + a + '><label for="' + id + '">' + esc(f.label) + req + "</label></div>";
    if (f.type === "textarea") c = '<textarea id="' + id + '" rows="3" maxlength="2000"' + a + "></textarea>";
    else if (f.type === "select") c = '<select id="' + id + '"' + a + '><option value="">Elegí una opción</option>' + (f.options || []).map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select>";
    else c = '<input type="' + (f.type === "email" ? "email" : "text") + '" id="' + id + '" maxlength="120"' + (f.id === "email" ? ' autocomplete="email"' : "") + a + ">";
    return '<div class="field"><label for="' + id + '">' + esc(f.label) + req + "</label>" + c + "</div>";
  }).join("");
}
function labelHtml(r) {
  var e = evById(r.event_id) || { title: "" };
  return '<div class="label"><div class="n">' + esc(r.data.nombre) + "<br>" + esc(r.data.apellido) + '</div><div class="c">' + esc(r.data.empresa) + '</div><div class="e">' + esc(e.title) + " · Cubo Itaú</div></div>";
}
function asist(r) {
  if (r.status !== "aprobada") return '<span class="pill na">—</span>';
  return r.checkin_at ? '<span class="pill si">Asistió ' + hm(r.checkin_at) + (r.label_printed ? " · etiqueta" : "") + "</span>" : '<span class="pill no">No asistió</span>';
}

/* ───────── carga ───────── */
function loadEvents() {
  return Promise.all([api.events(), api.counts().catch(function () { return []; })]).then(function (r) {
    S.events = r[0] || []; S.counts = {};
    (r[1] || []).forEach(function (c) { S.counts[c.event_id] = Number(c.approved) || 0; });
    if (!cur()) {
      var now = new Date().toISOString(), up = S.events.find(function (e) { return e.ends_at >= now; });
      UI.cur = (up || S.events[S.events.length - 1] || {}).id || null;
    }
  });
}
function loadRegs() {
  if (!S.org || !UI.cur) { S.regs = []; return Promise.resolve(); }
  return api.regs(UI.cur).then(function (d) { S.regs = d || []; });
}
function loadMails() {
  if (!S.org) return Promise.resolve();
  return Promise.all([UI.cur ? api.log(UI.cur) : [], api.conf()]).then(function (r) {
    S.log = r[0] || []; S.conf = r[1] || {};
    if (!S.conf.site_url) {
      var url = location.origin + location.pathname.replace(/index\.html$/, "");
      return api.setConf("site_url", url).then(function () { S.conf.site_url = url; });
    }
  });
}
function loadAdmin() {
  var p = loadRegs();
  if (UI.tab === "mails") p = p.then(loadMails);
  return p.then(render).catch(function (e) { render(); fail(e); });
}
function onRoute() {
  var r = route();
  UI.formOpen = false; UI.err = ""; UI.sent = false; UI.scan = null;
  if (r.v !== "admin" || UI.tab !== "check") camStop();
  if (r.v === "entrada") {
    S.ticket = undefined; render();
    api.ticket(r.code).then(function (t) { S.ticket = t || null; render(); }).catch(function () { S.ticket = null; render(); });
  } else if (r.v === "admin" && S.org) { render(); loadAdmin(); }
  else render();
  window.scrollTo(0, 0);
}

/* ───────── vistas públicas ───────── */
function vAgenda() {
  var now = new Date().toISOString();
  var list = S.events.filter(function (e) { return e.published && e.ends_at >= now; });
  var rows = list.map(function (e) {
    var a = S.counts[e.id] || 0;
    return '<a class="ag" href="#/e/' + encodeURIComponent(e.slug) + '" style="text-decoration:none;color:inherit"><div class="day"><b>' + fmt(e.starts_at, { day: "numeric" }) + "</b><span>" + fmt(e.starts_at, { month: "short" }) + "</span></div>" + cover(e, true) +
      "<div><h3>" + esc(e.title) + '</h3><p class="note">' + esc(fmt(e.starts_at, { weekday: "long" })) + " · " + esc(hours(e)) + " · " + esc(e.place) + '</p></div><div class="cnt note">' + a + (a === 1 ? " confirmado" : " confirmados") + "</div></a>";
  }).join("");
  return '<div class="stack"><span class="lbl">Agenda</span><h1>Próximos eventos</h1></div><div class="agenda">' +
    (rows || '<p class="note" style="padding:24px 0">Todavía no hay eventos publicados. Volvé pronto.</p>') + "</div>";
}
function vEvento(slug) {
  var e = S.events.find(function (x) { return x.slug === slug; });
  if (!e) return '<div class="stack"><h2>No encontramos ese evento</h2><p class="note">Puede que el enlace esté mal o que el evento ya no esté publicado.</p><div><a class="btn" href="#/">Ver la agenda</a></div></div>';
  var going = S.counts[e.id] || 0, past = e.ends_at < new Date().toISOString(), box;
  if (UI.sent) {
    box = '<div class="reg-b stack"><div class="row"><h3>Solicitud enviada</h3><span class="pill pendiente">Pendiente de aprobación</span></div><p>Te escribimos al correo que dejaste para confirmar que la recibimos. Cuando el organizador la revise te llega otro correo con el resultado y, si se aprueba, tu código QR.</p><p class="note">Si no ves el correo en unos minutos, revisá la carpeta de spam.</p></div>';
  } else if (past) {
    box = '<div class="reg-b"><b>Este evento ya terminó</b><p class="note">Las inscripciones están cerradas.</p></div>';
  } else if (UI.formOpen) {
    box = '<form class="reg-b stack" id="regform" novalidate><h3>Tus datos</h3>' + formHtml(e, "f") +
      '<div class="hp" aria-hidden="true"><label for="f-web">No completar</label><input id="f-web" tabindex="-1" autocomplete="off"></div>' +
      (UI.err ? '<p class="err" role="alert">' + esc(UI.err) + "</p>" : "") + '<button class="btn wide" type="submit">Enviar solicitud</button></form>';
  } else {
    box = '<div class="reg-b stack"><div><b>Requiere aprobación</b><p class="note">Tu inscripción queda sujeta a la aprobación del organizador. Sin costo.</p></div><button class="btn wide" data-act="openform">Solicitar inscripción</button></div>';
  }
  return '<div class="ev"><aside class="stack">' + cover(e) +
    '<div class="stack" style="gap:4px"><span class="lbl">Organiza</span><b>Cubo Itaú</b></div>' +
    '<div class="stack" style="gap:4px"><span class="lbl">Asistentes</span><span>' + going + (going === 1 ? " confirmado" : " confirmados") + (e.capacity ? " de " + e.capacity + " lugares" : "") + "</span></div>" +
    (e.published ? "" : '<span class="pill pendiente">Borrador: solo lo ven los administradores</span>') + "</aside>" +
    '<section class="stack" style="gap:20px"><h1>' + esc(e.title) + "</h1>" +
    '<div class="stack"><div class="fact"><div class="ic"><div><small>' + fmt(e.starts_at, { month: "short" }) + "</small>" + fmt(e.starts_at, { day: "numeric" }) + "</div></div><div><b>" + esc(cap1(when(e))) + '</b><p class="note">' + esc(hours(e)) + "</p></div></div>" +
    '<div class="fact"><div class="ic">◎</div><div><b>' + esc(e.place) + '</b><p class="note">' + esc(e.address) + ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.place + ", " + e.address) + '">ver mapa</a></p></div></div></div>' +
    '<div class="card reg"><div class="reg-h">Inscripción</div>' + box + "</div>" +
    (e.description ? '<div class="stack" style="gap:8px"><span class="lbl">Sobre el evento</span><p class="desc" style="white-space:pre-line">' + esc(e.description) + "</p></div>" : "") + "</section></div>";
}
function vEntrada(code) {
  var t = S.ticket;
  if (t === undefined) return '<p class="spin">Buscando tu entrada…</p>';
  if (!t) return '<div class="stack"><h2>No encontramos esa entrada</h2><p class="note">Revisá que el enlace sea el del correo de aprobación. Si tu inscripción todavía está pendiente, la entrada aparece cuando el organizador la aprueba.</p><div><a class="btn" href="#/">Ver la agenda</a></div></div>';
  var e = t.event;
  return '<div class="stack" style="max-width:420px;margin:0 auto;width:100%"><span class="lbl">Tu entrada</span>' +
    '<div class="pass" style="max-width:none"><div class="row" style="justify-content:space-between">' + (document.querySelector(".logo") ? document.querySelector(".logo").outerHTML : "") + '<span class="lbl">Entrada</span></div>' +
    '<div class="pt">' + esc(e.title) + '</div><div class="grid2"><div><span class="lbl">Asistente</span><br>' + esc(t.nombre + " " + t.apellido) + '</div><div><span class="lbl">Empresa</span><br>' + esc(t.empresa) +
    '</div><div><span class="lbl">Fecha</span><br>' + esc(fmt(e.starts_at, { weekday: "short", day: "numeric", month: "short" })) + '</div><div><span class="lbl">Hora</span><br>' + esc(hours(e)) + "</div></div>" +
    '<div><span class="lbl">Lugar</span><br>' + esc(e.place + ", " + e.address) + '</div><div class="qr" style="margin:0 auto;width:200px;height:200px">' + qrSvg(t.code) + '</div><div class="mono" style="text-align:center">' + esc(t.code) + "</div></div>" +
    (t.checkin ? '<span class="pill si" style="align-self:flex-start">Ya ingresaste al evento</span>' :
      t.confirmed ? '<span class="pill si" style="align-self:flex-start">Asistencia confirmada</span>' : '<button class="btn wide" data-act="confirm" data-id="' + esc(t.code) + '">Confirmo mi asistencia</button>') +
    '<a class="btn ghost" target="_blank" rel="noopener" href="' + gcal(e, t.code) + '">Agregar a Google Calendar</a>' +
    '<p class="note">Mostrá este código QR en el ingreso. Podés guardar esta página o hacerle una captura.</p></div>';
}

/* ───────── administración ───────── */
function vLogin() {
  if (S.session && !S.org) return '<div class="card login stack"><h2>Sin permiso</h2><p class="note">Tu usuario inició sesión pero no figura como administrador. Pedile a RedTickets que te habilite.</p><button class="btn ghost" data-act="logout">Cerrar sesión</button></div>';
  return '<form class="card login stack" id="loginform"><h2>Administración</h2><p class="note">Acceso para Cubo Itaú y RedTickets.</p>' +
    '<div class="field"><label for="lg-email">Email</label><input type="email" id="lg-email" autocomplete="username" required value="' + esc(UI.loginEmail || "") + '"></div>' +
    '<div class="field"><label for="lg-pass">Contraseña</label><input class="inp" type="password" id="lg-pass" autocomplete="current-password" required></div>' +
    (UI.loginErr ? '<p class="err" role="alert">' + esc(UI.loginErr) + "</p>" : "") + '<button class="btn wide" type="submit">Ingresar</button></form>';
}
function vAdmin() {
  if (!S.org) return vLogin();
  var e = cur();
  var top = '<div class="row" style="justify-content:space-between"><div class="stack" style="gap:4px"><span class="lbl">Administración · ' + esc(S.org) + "</span><h2>" + esc(e ? e.title : "Eventos") + "</h2></div>" +
    '<div class="row">' + (S.events.length ? '<div class="field"><label for="selev">Evento</label><select id="selev" class="inp">' + S.events.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === UI.cur ? " selected" : "") + ">" + esc(x.title) + (x.published ? "" : " (borrador)") + "</option>";
    }).join("") + "</select></div>" : "") + '<button class="btn sm" data-act="newev" style="align-self:flex-end">Crear evento</button></div></div>';
  if (!e) return top + '<p class="note">Todavía no hay eventos. Creá el primero con el botón de arriba.</p>';
  var rs = S.regs, n = function (f) { return rs.filter(f).length; };
  return top +
    '<div class="stats"><div><b>' + rs.length + "</b><span>Inscriptos</span></div><div><b>" + n(function (r) { return r.status === "pendiente"; }) + "</b><span>Pendientes</span></div><div><b>" + n(function (r) { return r.status === "aprobada"; }) + "</b><span>Aprobados</span></div><div><b>" + n(function (r) { return r.checkin_at; }) + "</b><span>Asistieron</span></div></div>" +
    '<div class="tabs">' + [["insc", "Inscripciones"], ["datos", "Datos del evento"], ["form", "Formulario"], ["mails", "Correos"], ["check", "Check-in"]].map(function (t) {
      return '<button data-act="tab" data-id="' + t[0] + '" aria-current="' + (UI.tab === t[0]) + '">' + t[1] + "</button>";
    }).join("") + "</div>" +
    (UI.tab === "insc" ? tInsc(e, rs) : UI.tab === "datos" ? tDatos(e) : UI.tab === "form" ? tForm(e) : UI.tab === "mails" ? tMails(e, rs) : tCheck(e, rs));
}
function tInsc(e, rs) {
  var list = rs.filter(function (r) { return UI.filter === "todas" || r.status === UI.filter; });
  var rows = list.map(function (r) {
    var d = r.data, acts = "";
    if (r.status !== "aprobada") acts += '<button class="btn sm" data-act="approve" data-id="' + r.id + '">Aprobar</button>';
    if (r.status !== "rechazada" && !r.checkin_at) acts += '<button class="btn ghost sm" data-act="reject" data-id="' + r.id + '">Rechazar</button>';
    acts += '<button class="btn ghost sm" data-act="detail" data-id="' + r.id + '">Ver</button>';
    return "<tr><td><b>" + esc(fullName(r)) + "</b></td><td>" + esc(d.empresa) + "</td><td>" + esc(d.email) + '</td><td><span class="pill ' + r.status + '">' + STATUS[r.status] + "</span></td><td>" + asist(r) + '</td><td class="acts">' + acts + "</td></tr>";
  }).join("");
  return '<div class="row" style="justify-content:space-between"><div class="tabs" style="border:0;padding:0">' + ["todas", "pendiente", "aprobada", "rechazada"].map(function (f) {
    return '<button data-act="filter" data-id="' + f + '" aria-current="' + (UI.filter === f) + '">' + ({ todas: "Todas", pendiente: "Pendientes", aprobada: "Aprobadas", rechazada: "Rechazadas" })[f] + "</button>";
  }).join("") + '</div><div class="row"><button class="btn ghost sm" data-act="reload">Actualizar</button><button class="btn sm" data-act="xls" data-id="one">Descargar Excel del evento</button><button class="btn ghost sm" data-act="xls" data-id="all">Excel de todos los eventos</button></div></div>' +
    '<div class="scroll"><table><thead><tr><th>Nombre</th><th>Empresa</th><th>Email</th><th>Estado</th><th>Asistencia</th><th>Acciones</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" class="note">' + (rs.length ? "No hay inscripciones con este filtro." : "Todavía no hay inscripciones. Compartí el enlace del evento para recibir las primeras.") + "</td></tr>") + "</tbody></table></div>" +
    '<p class="note">Enlace público del evento: <a href="#/e/' + encodeURIComponent(e.slug) + '">' + esc(location.origin + location.pathname + "#/e/" + e.slug) + "</a>" + (e.published ? "" : " (todavía en borrador)") + "</p>";
}
function tDatos(e) {
  var s = loc(e.starts_at), f = loc(e.ends_at);
  function inp(id, label, k, val, type, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="inp" type="' + (type || "text") + '" id="' + id + '" data-e="' + k + '" value="' + esc(val) + '"' + (extra || "") + "></div>"; }
  return '<div class="fb"><div class="stack"><div class="row"><h3>Datos del evento</h3><span class="pill ' + (e.published ? "aprobada" : "pendiente") + '">' + (e.published ? "Publicado" : "Borrador") + "</span></div>" +
    inp("ed-title", "Título", "title", e.title, "text", ' maxlength="120"') +
    '<div class="grid3">' + inp("ed-date", "Fecha", "date", s.d, "date") + inp("ed-from", "Desde", "from", s.t, "time") + inp("ed-to", "Hasta", "to", f.t, "time") + "</div>" +
    '<div class="grid2">' + inp("ed-place", "Lugar", "place", e.place) + inp("ed-addr", "Dirección", "address", e.address) + "</div>" +
    inp("ed-cap", "Cupo (opcional)", "capacity", e.capacity || "", "number", ' min="1" placeholder="Sin límite"') +
    '<div class="field"><label for="ed-desc">Descripción</label><textarea class="inp" id="ed-desc" data-e="description" rows="5">' + esc(e.description) + "</textarea></div>" +
    '<div class="field"><label for="ed-img">Imagen del evento</label><input type="file" id="ed-img" accept="image/*"><span class="note">Cuadrada, JPG o PNG. Se usa en la página del evento y como miniatura en la Agenda.</span></div>' +
    '<div class="row">' + (e.published ? '<button class="btn ghost sm" data-act="unpublish">Pasar a borrador</button>' : '<button class="btn" data-act="publish">Publicar evento</button>') +
    (e.image_url ? '<button class="btn ghost sm" data-act="rmimg">Quitar imagen</button>' : "") + '<button class="btn ghost sm" data-act="tab" data-id="form">Armar el formulario</button><a class="btn ghost sm" href="#/e/' + encodeURIComponent(e.slug) + '">Ver página del evento</a></div>' +
    (e.published ? "" : '<p class="note">Mientras está en borrador no aparece en la Agenda pública ni acepta inscripciones.</p>') + "</div>" +
    '<div class="stack"><span class="lbl">Así se ve</span><div style="max-width:300px">' + cover(e) + "</div><b>" + esc(e.title) + '</b><span class="note">' + esc(when(e)) + " · " + esc(hours(e)) + "<br>" + esc(e.place + ", " + e.address) + "</span></div></div>";
}
function tForm(e) {
  var fixed = BASE.map(function (f) { return '<div class="frow"><b>' + f.label + '</b><span class="note">' + (f.type === "email" ? "Email" : "Texto corto") + '</span><span class="note">Fijo</span></div>'; }).join("");
  var cust = (e.fields || []).map(function (f, i) {
    return '<div class="frow"><input class="inp" id="fl-' + f.id + '" data-f="label" data-i="' + i + '" value="' + esc(f.label) + '" aria-label="Nombre del campo" maxlength="120">' +
      '<select class="inp" id="ft-' + f.id + '" data-f="type" data-i="' + i + '" aria-label="Tipo">' + Object.keys(TYPES).map(function (t) { return '<option value="' + t + '"' + (t === f.type ? " selected" : "") + ">" + TYPES[t] + "</option>"; }).join("") + "</select>" +
      '<div class="ctl"><label class="note"><input type="checkbox" id="fr-' + f.id + '" data-f="required" data-i="' + i + '"' + (f.required ? " checked" : "") + "> Oblig.</label>" +
      '<button class="btn ghost sm" data-act="fup" data-id="' + i + '" aria-label="Subir"' + (i === 0 ? " disabled" : "") + '>↑</button><button class="btn ghost sm" data-act="fdown" data-id="' + i + '" aria-label="Bajar"' + (i === e.fields.length - 1 ? " disabled" : "") + '>↓</button><button class="btn ghost sm" data-act="fdel" data-id="' + i + '">Quitar</button></div>' +
      (f.type === "select" ? '<input class="inp opts" id="fo-' + f.id + '" data-f="options" data-i="' + i + '" value="' + esc((f.options || []).join(", ")) + '" aria-label="Opciones separadas por coma" placeholder="Opciones separadas por coma">' : "") + "</div>";
  }).join("");
  return '<div class="fb"><div class="stack"><h3>Campos del formulario</h3><p class="note">Nombre, apellido, email y empresa son fijos porque se usan en la etiqueta y en los correos. El resto se arma por evento.</p><div>' + fixed + cust + '</div><div><button class="btn sm" data-act="fadd">Agregar campo</button></div></div>' +
    '<div class="card stack"><span class="lbl">Vista previa</span>' + formHtml(e, "pv", true) + "</div></div>";
}
function tMails(e, rs) {
  var d = (rs[0] || { data: { nombre: "Lucía", apellido: "Fernández", empresa: "Estudio Prisma", email: "lucia@ejemplo.com" } }).data, t = tpl(e, UI.mk), c = S.conf || {};
  var log = S.log.map(function (o) {
    var st = o.note ? '<span class="pill ' + (/^No enviado|^Error/.test(o.note) || o.status_code >= 300 ? "no" : "na") + '">' + esc(o.note.slice(0, 60)) + "</span>" :
      o.status_code ? '<span class="pill si">Enviado</span>' : '<span class="pill na">En cola</span>';
    return "<tr><td>" + fmt(o.created_at, { day: "2-digit", month: "2-digit" }) + " " + hm(o.created_at) + "</td><td>" + esc(o.recipient) + "</td><td>" + esc(o.subject) + "</td><td>" + st + "</td></tr>";
  }).join("");
  return '<div class="fb"><div class="stack"><h3>Correos automáticos</h3>' +
    '<div class="tabs" style="border:0;padding:0">' + Object.keys(MAILNAME).map(function (k) { return '<button data-act="mk" data-id="' + k + '" aria-current="' + (UI.mk === k) + '">' + MAILNAME[k] + "</button>"; }).join("") + "</div>" +
    '<div class="field"><label for="ms">Asunto</label><input class="inp" id="ms" data-m="' + UI.mk + '" data-mk="subj" value="' + esc(t.subj) + '"></div>' +
    '<div class="field"><label for="mb">Mensaje</label><textarea class="inp" id="mb" rows="5" data-m="' + UI.mk + '" data-mk="body">' + esc(t.body) + "</textarea></div>" +
    '<p class="note">Variables: {nombre} {apellido} {empresa} {evento} {fecha} {hora} {lugar}.' + (UI.mk === "aprobada" ? " Los datos del evento, el QR, el enlace a la entrada y la invitación de calendario se agregan solos." : "") + "</p>" +
    '<div class="field"><label for="ntfto">Avisar al organizador de cada inscripción (email, opcional)</label><input class="inp" type="email" id="ntfto" value="' + esc(e.notify_to || "") + '" placeholder="eventos@empresa.com"></div>' +
    '<div class="card stack"><span class="lbl">Vista previa</span><div class="mail"><div class="mail-h">Para: ' + esc(d.email) + "<b>" + esc(fill(t.subj, e, d)) + '</b></div><div class="mail-b"><p>Hola ' + esc(d.nombre) + ":</p><p>" + esc(fill(t.body, e, d)).replace(/\n/g, "<br>") + "</p>" +
    (UI.mk === "aprobada" ? '<p class="note">+ datos del evento, código QR, botón «Ver mi entrada» y Google Calendar.</p>' : "") + "</div></div></div></div>" +
    '<div class="stack"><h3>Envío de correos</h3>' +
    '<form id="confform" class="card stack"><p class="note">Se configura una sola vez y vale para todos los eventos.</p>' +
    '<div class="field"><label for="cf-key">Clave de Resend ' + (c.has_key ? '<span class="pill si">Cargada</span>' : '<span class="pill no">Falta cargar</span>') + '</label><input class="inp" type="password" id="cf-key" autocomplete="off" placeholder="' + (c.has_key ? "Dejar vacío para mantener la actual" : "re_...") + '"></div>' +
    '<div class="field"><label for="cf-from">Remitente</label><input class="inp" id="cf-from" value="' + esc(c.mail_from || "") + '" placeholder="Cubo Itaú Eventos &lt;onboarding@resend.dev&gt;"></div>' +
    '<div class="field"><label for="cf-site">Dirección del sitio (para los enlaces de los correos)</label><input class="inp" id="cf-site" value="' + esc(c.site_url || "") + '"></div>' +
    '<div class="row"><button class="btn sm" type="submit">Guardar</button></div></form>' +
    '<form id="testform" class="row"><input class="inp" type="email" id="cf-test" placeholder="tu@email.com" aria-label="Email para la prueba" style="flex:1;min-width:160px" value="' + esc((S.session && S.session.user && S.session.user.email) || "") + '"><button class="btn ghost sm" type="submit">Enviar correo de prueba</button></form>' +
    '<div class="row" style="justify-content:space-between"><h3>Enviados</h3><button class="btn ghost sm" data-act="reload">Actualizar</button></div>' +
    '<div class="scroll"><table><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Estado</th></tr></thead><tbody>' + (log || '<tr><td colspan="4" class="note">Todavía no salió ningún correo de este evento.</td></tr>') + "</tbody></table></div></div></div>";
}
function tCheck(e, rs) {
  var sc = UI.scan, res = "", r;
  if (sc) {
    r = sc.reg;
    if (sc.kind === "ok") res = '<div class="res ok">QR válido. ' + esc(fullName(r)) + " puede ingresar.</div>" + labelHtml(r) + '<div class="row"><button class="btn" data-act="cin" data-id="' + r.id + '" data-print="1">Imprimir etiqueta y registrar ingreso</button><button class="btn ghost" data-act="cin" data-id="' + r.id + '">Registrar ingreso sin etiqueta</button></div>';
    else if (sc.kind === "done") res = '<div class="res ok">Ingreso de ' + esc(fullName(r)) + " registrado a las " + hm(r.checkin_at) + (r.label_printed ? ", con etiqueta." : ", sin etiqueta.") + '</div><div class="row"><button class="btn" data-act="next">Leer otro código</button></div>';
    else if (sc.kind === "dup") res = '<div class="res warn">Este QR ya se usó: ' + esc(fullName(r)) + " ingresó a las " + hm(r.checkin_at) + ".</div>" + labelHtml(r) + '<div class="row"><button class="btn ghost" data-act="reprint" data-id="' + r.id + '">Reimprimir etiqueta</button><button class="btn" data-act="next">Leer otro código</button></div>';
    else res = '<div class="res bad">' + esc(sc.msg) + '</div><div class="row"><button class="btn" data-act="next">Leer otro código</button></div>';
  }
  var ok = rs.filter(function (x) { return x.status === "aprobada"; });
  var rows = ok.map(function (x) {
    return "<tr><td><b>" + esc(fullName(x)) + '</b><br><span class="note">' + esc(x.data.empresa) + '</span></td><td class="mono">' + esc(x.code) + "</td><td>" + asist(x) + "</td><td>" + (x.checkin_at ? "" : '<button class="btn ghost sm" data-act="scan" data-id="' + esc(x.code) + '">Ingresar</button>') + "</td></tr>";
  }).join("");
  return '<div class="scan"><div class="stack"><h3>Leer código QR</h3>' +
    (cam.on ? '<div class="video"><video id="camv" playsinline muted></video></div><div class="row"><button class="btn ghost sm" data-act="camoff">Apagar cámara</button></div>' :
      '<div class="row"><button class="btn" data-act="camon">Abrir cámara</button><span class="note">También sirve un lector USB o escribir el código.</span></div>') +
    '<form id="scanform" class="row"><input class="inp mono" id="scancode" placeholder="CI-XXXXXXXXXX" style="flex:1;min-width:140px" aria-label="Código del QR" autocomplete="off" autocapitalize="characters"><button class="btn ghost" type="submit">Validar</button></form>' + res + "</div>" +
    '<div class="stack"><div class="row" style="justify-content:space-between"><h3>Aprobados de este evento</h3><button class="btn ghost sm" data-act="reload">Actualizar</button></div><div class="scroll"><table><thead><tr><th>Persona</th><th>Código</th><th>Asistencia</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="4" class="note">Todavía no hay inscripciones aprobadas.</td></tr>') + "</tbody></table></div></div></div>";
}

function render() {
  var r = route();
  $("nav").innerHTML = '<a class="nb" href="#/" aria-current="' + (r.v === "agenda" || r.v === "evento") + '">Agenda</a>' +
    '<a class="nb" href="#/admin" aria-current="' + (r.v === "admin") + '">Administrador</a>' +
    (S.session ? '<button data-act="logout">Salir</button>' : "");
  if (!S.ready) return;
  $("app").innerHTML = r.v === "evento" ? vEvento(r.slug) : r.v === "entrada" ? vEntrada(r.code) : r.v === "admin" ? vAdmin() : vAgenda();
  document.title = r.v === "evento" && S.events.find(function (x) { return x.slug === r.slug; }) ? S.events.find(function (x) { return x.slug === r.slug; }).title + " · Cubo Itaú" : "Cubo Itaú Eventos";
  camAttach();
}

/* ───────── cámara ───────── */
function camStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("Este navegador no permite usar la cámara. Abrí el sitio con https en Chrome o Safari.");
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false }).then(function (st) {
    cam.stream = st; cam.on = true; cam.paused = false; render();
  }).catch(function () { toast("No se pudo abrir la cámara. Revisá que el navegador tenga permiso para usarla."); });
}
function camStop() {
  clearTimeout(cam.timer);
  if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
  cam.stream = null; cam.on = false;
}
function camAttach() {
  var v = $("camv"); if (!v || !cam.stream) return;
  v.srcObject = cam.stream; var p = v.play(); if (p && p.catch) p.catch(function () {});
  clearTimeout(cam.timer); cam.timer = setTimeout(camTick, 250);
}
function camTick() {
  var v = $("camv"); if (!v || !cam.on) return;
  if (!cam.paused && v.readyState >= 2 && v.videoWidth && typeof jsQR === "function") {
    var c = cam.canvas || (cam.canvas = document.createElement("canvas")), k = Math.min(1, 800 / v.videoWidth);
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(v, 0, 0, c.width, c.height);
    var hit = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "dontInvert" });
    if (hit && hit.data) { cam.paused = true; if (navigator.vibrate) navigator.vibrate(80); doScan(hit.data); return; }
  }
  cam.timer = setTimeout(camTick, 160);
}
function doScan(raw) {
  var code = String(raw || "").trim(); if (code.indexOf("/") >= 0) code = code.split("/").pop();
  api.validate(UI.cur, code).then(function (res) { UI.scan = res; render(); }).catch(function (e) { UI.scan = { kind: "bad", msg: e.message }; render(); });
}
function printLabel(r) {
  var L = CFG.label || { w: 90, h: 55 }, st = $("pgsize") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "pgsize" }));
  st.textContent = "@page{size:" + L.w + "mm " + L.h + "mm;margin:0}";
  $("printarea").innerHTML = labelHtml(r);
  setTimeout(function () { window.print(); }, 80);
}

/* ───────── acciones ───────── */
function patchEvent(patch, msg) {
  var e = cur(); if (!e) return Promise.resolve();
  return api.saveEvent(e.id, patch).then(function (row) {
    var i = S.events.findIndex(function (x) { return x.id === e.id; }); S.events[i] = row; render(); if (msg) toast(msg);
  }).catch(function (err) { render(); fail(err); });
}
function putReg(row) { var i = S.regs.findIndex(function (x) { return x.id === row.id; }); if (i >= 0) S.regs[i] = row; else S.regs.push(row); }
function rowsFor(evs, regs, pred) {
  var out = [];
  evs.forEach(function (e) {
    regs.filter(function (r) { return r.event_id === e.id; }).filter(pred).forEach(function (r) {
      var o = { Evento: e.title, Fecha: fmt(e.starts_at, { day: "2-digit", month: "2-digit", year: "numeric" }) };
      fieldsOf(e).forEach(function (f) { var v = r.data[f.id]; o[f.label] = f.type === "checkbox" ? (v ? "Sí" : "No") : (v == null ? "" : v); });
      o["Estado"] = STATUS[r.status]; o["Gestionado por"] = r.reviewed_by || ""; o["Inscripto el"] = fmt(r.created_at, { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + hm(r.created_at);
      o["Confirmó asistencia"] = r.confirmed_at ? "Sí" : "No"; o["Asistió"] = r.checkin_at ? "Sí" : "No"; o["Hora de ingreso"] = r.checkin_at ? hm(r.checkin_at) : "";
      o["Etiqueta impresa"] = r.label_printed ? "Sí" : "No"; o["Código QR"] = r.code;
      out.push(o);
    });
  });
  return out;
}
function exportXls(scope) {
  if (typeof XLSX === "undefined") return toast("No se pudo cargar el generador de Excel. Recargá la página.");
  var p = scope === "all" ? api.regs(null) : Promise.resolve(S.regs);
  p.then(function (regs) {
    var evs = scope === "all" ? S.events : [cur()], wb = XLSX.utils.book_new();
    [["Asistieron", function (r) { return !!r.checkin_at; }], ["No asistieron", function (r) { return r.status === "aprobada" && !r.checkin_at; }], ["Todos los inscriptos", function () { return true; }]].forEach(function (s) {
      var rows = rowsFor(evs, regs, s[1]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Evento: "Sin registros" }]), s[0]);
    });
    XLSX.writeFile(wb, (scope === "all" ? "cubo-itau-todos-los-eventos" : "cubo-itau-" + cur().slug) + "-asistencia.xlsx");
  }).catch(fail);
}
function submitReg() {
  var r = route(), e = S.events.find(function (x) { return x.slug === r.slug; }), d = {}, bad = "";
  fieldsOf(e).forEach(function (f) {
    var el = $("f-" + f.id); if (!el) return;
    var v = f.type === "checkbox" ? el.checked : el.value.trim(); d[f.id] = v;
    if (f.required && !v && !bad) bad = "Falta completar: " + f.label + ".";
  });
  if (!bad && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) bad = "Revisá el email: tiene que tener el formato nombre@dominio.com.";
  function keep(msg) {
    UI.err = msg; render();
    fieldsOf(e).forEach(function (f) { var el = $("f-" + f.id); if (el) { if (f.type === "checkbox") el.checked = !!d[f.id]; else el.value = d[f.id] || ""; } });
  }
  if (bad) return keep(bad);
  var btn = document.querySelector("#regform button[type=submit]"); if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
  api.register(e.id, d, ($("f-web") || {}).value || "").then(function () { UI.sent = true; UI.formOpen = false; UI.err = ""; render(); window.scrollTo(0, 0); })
    .catch(function (err) { keep(err.message); });
}
function showDetail(r) {
  var e = evById(r.event_id), rows = fieldsOf(e).map(function (f) { var v = r.data[f.id]; return "<dt>" + esc(f.label) + "</dt><dd>" + esc(f.type === "checkbox" ? (v ? "Sí" : "No") : (v || "—")) + "</dd>"; }).join("");
  var d = $("dlg");
  d.innerHTML = '<div class="stack"><div class="row" style="justify-content:space-between"><h3>' + esc(fullName(r)) + '</h3><button class="btn ghost sm" data-act="close">Cerrar</button></div>' +
    '<div class="row"><span class="pill ' + r.status + '">' + STATUS[r.status] + "</span>" + asist(r) + (r.confirmed_at ? '<span class="pill si">Confirmó asistencia</span>' : "") + "</div>" +
    '<dl class="kv">' + rows + "<dt>Código</dt><dd class=\"mono\">" + esc(r.code) + "</dd><dt>Inscripto el</dt><dd>" + fmt(r.created_at, { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + hm(r.created_at) + "</dd>" +
    (r.reviewed_by ? "<dt>Gestionado por</dt><dd>" + esc(r.reviewed_by) + "</dd>" : "") + "</dl>" +
    '<div class="row"><button class="btn ghost sm" data-act="resend" data-id="' + r.id + '">Reenviar correo</button>' +
    (r.status === "aprobada" ? '<a class="btn ghost sm" target="_blank" rel="noopener" href="#/entrada/' + esc(r.code) + '">Ver entrada</a>' : "") + "</div></div>";
  if (!d.open) d.showModal();
}
function reg(id) { return S.regs.find(function (r) { return r.id === id; }); }

document.addEventListener("click", function (x) {
  var b = x.target.closest("[data-act]"); if (!b || b.disabled) return;
  var a = b.dataset.act, id = b.dataset.id, e = cur(), r, i = +id, fs, t;
  if (a === "openform") { UI.formOpen = true; UI.err = ""; return render(); }
  if (a === "close") return $("dlg").close();
  if (a === "confirm") { b.disabled = true; return api.confirm(id).then(function () { if (S.ticket) S.ticket.confirmed = true; render(); toast("Asistencia confirmada. ¡Te esperamos!"); }).catch(fail); }
  if (a === "logout") { camStop(); return api.logout().then(function () { S.session = null; S.org = null; S.regs = []; return loadEvents(); }).then(render).catch(fail); }
  if (!S.org) return;
  if (a === "tab") { UI.tab = id; UI.scan = null; if (id !== "check") camStop(); render(); return loadAdmin(); }
  if (a === "filter") { UI.filter = id; return render(); }
  if (a === "reload") { b.disabled = true; return loadEvents().then(loadAdmin); }
  if (a === "mk") { UI.mk = id; return render(); }
  if (a === "xls") return exportXls(id);
  if (a === "detail") return showDetail(reg(id));
  if (a === "approve" || a === "reject" || a === "resend") {
    r = reg(id); b.disabled = true;
    var wantQr = a === "approve" || (a === "resend" && r.status === "aprobada");
    var p = wantQr ? qrBlob(r.code).then(function (bl) { return api.upload("qr", r.code + ".png", bl, "image/png"); }).catch(function () { return null; }) : Promise.resolve(null);
    return p.then(function (url) { return api.review(id, a === "approve" ? "aprobar" : a === "reject" ? "rechazar" : "reenviar", url); }).then(function () {
      if ($("dlg").open) $("dlg").close();
      toast(a === "approve" ? "Aprobada. Sale el correo con el QR a " + r.data.email : a === "reject" ? "Rechazada. Se avisa por correo a " + r.data.email : "Correo reenviado a " + r.data.email);
      return Promise.all([loadRegs(), api.counts().then(function (c) { S.counts = {}; c.forEach(function (k) { S.counts[k.event_id] = Number(k.approved) || 0; }); }).catch(function () {})]);
    }).then(render).catch(function (err) { render(); fail(err); });
  }
  if (a === "newev") {
    b.disabled = true;
    var d0 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    return api.createEvent({ slug: "evento-" + Math.random().toString(36).slice(2, 8), title: "Nuevo evento", starts_at: toIso(d0, "18:00"), ends_at: toIso(d0, "20:00"), published: false })
      .then(function (row) { S.events.push(row); UI.cur = row.id; UI.tab = "datos"; S.regs = []; render(); toast("Evento creado como borrador. Completá los datos."); }).catch(function (err) { render(); fail(err); });
  }
  if (!e) return;
  if (a === "publish") return patchEvent({ published: true, slug: /^evento-[a-z0-9]{6}$/.test(e.slug) ? slugify(e.title) + "-" + e.slug.slice(-4) : e.slug }, "Evento publicado en la Agenda");
  if (a === "unpublish") return patchEvent({ published: false }, "Evento en borrador");
  if (a === "rmimg") return patchEvent({ image_url: null });
  if (a === "fadd" || a === "fdel" || a === "fup" || a === "fdown") {
    fs = (e.fields || []).slice();
    if (a === "fadd") fs.push({ id: "c" + Date.now().toString(36), label: "Nuevo campo", type: "text", required: false });
    else if (a === "fdel") fs.splice(i, 1);
    else { var j = a === "fup" ? i - 1 : i + 1; t = fs[i]; fs[i] = fs[j]; fs[j] = t; }
    return patchEvent({ fields: fs });
  }
  if (a === "camon") return camStart();
  if (a === "camoff") { camStop(); return render(); }
  if (a === "next") { UI.scan = null; cam.paused = false; render(); var inp = $("scancode"); if (inp && !cam.on) inp.focus(); return; }
  if (a === "scan") return doScan(id);
  if (a === "cin") {
    b.disabled = true; var pr = !!b.dataset.print;
    return api.mark(id, pr).then(function (row) { putReg(row); UI.scan = { kind: "done", reg: row }; render(); if (pr) printLabel(row); }).catch(function (err) { render(); fail(err); });
  }
  if (a === "reprint") { r = reg(id) || (UI.scan && UI.scan.reg); return api.mark(id, true).then(function (row) { putReg(row); printLabel(row); }).catch(fail); }
});

document.addEventListener("change", function (x) {
  var el = x.target, e = cur();
  if (!S.org) return;
  if (el.id === "selev") { UI.cur = el.value; UI.scan = null; S.regs = []; S.log = []; render(); return loadAdmin(); }
  if (!e) return;
  if (el.id === "ed-img") {
    if (!el.files || !el.files[0]) return;
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var n = Math.min(im.width, im.height), c = document.createElement("canvas"); c.width = c.height = Math.min(1000, n);
        c.getContext("2d").drawImage(im, (im.width - n) / 2, (im.height - n) / 2, n, n, 0, 0, c.width, c.height);
        c.toBlob(function (bl) {
          api.upload("eventos", e.id + "-" + Date.now() + ".jpg", bl, "image/jpeg").then(function (url) { return patchEvent({ image_url: url }, "Imagen cargada"); }).catch(fail);
        }, "image/jpeg", 0.85);
      };
      im.onerror = function () { toast("No se pudo leer la imagen. Probá con un JPG o PNG."); };
      im.src = fr.result;
    };
    return fr.readAsDataURL(el.files[0]);
  }
  if (el.id === "ntfto") {
    var nv = el.value.trim();
    if (nv && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nv)) return toast("Ese email no parece válido.");
    return patchEvent({ notify_to: nv || null }, nv ? "Se avisa a " + nv + " en cada inscripción" : "Aviso al organizador desactivado");
  }
  if (el.dataset.m) {
    var mails = JSON.parse(JSON.stringify(e.mails || {})); mails[el.dataset.m] = mails[el.dataset.m] || {}; mails[el.dataset.m][el.dataset.mk] = el.value.trim();
    return patchEvent({ mails: mails }, "Correo guardado");
  }
  if (el.dataset.e) {
    var k = el.dataset.e, v = el.value.trim(), s0 = loc(e.starts_at), f0 = loc(e.ends_at), patch = {};
    if (k === "date") { if (!v) return render(); patch.starts_at = toIso(v, s0.t); patch.ends_at = toIso(v, f0.t); }
    else if (k === "from") { if (!v) return render(); patch.starts_at = toIso(s0.d, v); patch.ends_at = e.ends_at; }
    else if (k === "to") { if (!v) return render(); patch.ends_at = toIso(s0.d, v); patch.starts_at = e.starts_at; }
    else if (k === "capacity") patch.capacity = +v > 0 ? Math.floor(+v) : null;
    else if (k === "title") patch.title = v || "Evento sin título";
    else patch[k] = v;
    if (patch.ends_at && patch.ends_at <= patch.starts_at) { patch.ends_at = new Date(new Date(patch.starts_at).getTime() + 3600e3).toISOString(); toast("La hora de fin quedó una hora después del inicio"); }
    return patchEvent(patch);
  }
  if (el.dataset.f) {
    var fs = JSON.parse(JSON.stringify(e.fields || [])), f = fs[+el.dataset.i], fk = el.dataset.f;
    if (fk === "required") f.required = el.checked;
    else if (fk === "options") f.options = el.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    else if (fk === "label") f.label = el.value.trim() || "Campo sin nombre";
    else { f.type = el.value; if (f.type === "select" && !(f.options && f.options.length)) f.options = ["Opción 1", "Opción 2"]; }
    return patchEvent({ fields: fs });
  }
});

document.addEventListener("submit", function (x) {
  x.preventDefault();
  var id = x.target.id;
  if (id === "regform") return submitReg();
  if (id === "loginform") {
    UI.loginEmail = $("lg-email").value.trim();
    return api.login(UI.loginEmail, $("lg-pass").value).then(function (s) { S.session = s; return api.myOrg(); })
      .then(function (org) { S.org = org; UI.loginErr = ""; return loadEvents(); }).then(function () { render(); if (S.org) loadAdmin(); })
      .catch(function (e) { UI.loginErr = e.message; render(); });
  }
  if (!S.org) return;
  if (id === "scanform") return doScan($("scancode").value);
  if (id === "confform") {
    var jobs = [api.setConf("mail_from", $("cf-from").value), api.setConf("site_url", $("cf-site").value)];
    if ($("cf-key").value.trim()) jobs.push(api.setConf("resend_api_key", $("cf-key").value));
    return Promise.all(jobs).then(loadMails).then(function () { render(); toast("Configuración guardada"); }).catch(fail);
  }
  if (id === "testform") {
    return api.testMail($("cf-test").value).then(function () { toast("Prueba enviada. En unos segundos tocá Actualizar para ver el resultado."); return loadMails(); }).then(render).catch(fail);
  }
});

window.addEventListener("hashchange", onRoute);

/* ───────── arranque ───────── */
function boot() {
  if (window.MOCK_API) api = window.MOCK_API;
  else {
    if (!CFG.supabaseUrl || /TU-PROYECTO/.test(CFG.supabaseUrl) || !window.supabase) {
      $("app").innerHTML = '<div class="card stack" style="max-width:560px"><h2>Falta conectar la base de datos</h2><p class="note">Completá <span class="mono">config.js</span> con la dirección y la clave pública de tu proyecto de Supabase. Los pasos están en el archivo README del repositorio.</p></div>';
      return;
    }
    api = makeApi(window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey));
  }
  api.session().then(function (s) { S.session = s; return s ? api.myOrg() : null; })
    .then(function (org) { S.org = org; return loadEvents(); })
    .then(function () { S.ready = true; onRoute(); })
    .catch(function (e) { $("app").innerHTML = '<div class="card stack" style="max-width:560px"><h2>No pudimos cargar los eventos</h2><p class="note">' + esc(e.message) + '</p><p class="note">Revisá que el esquema de la base esté instalado y que config.js tenga los datos correctos.</p></div>'; });
}
boot();
})();
