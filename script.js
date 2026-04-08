(() => {
  "use strict";

  const KEY = "dc_space_control_v1";
  let db = null;

  // ===============================
  // SUPABASE (Cloud + Login)
  // ===============================
  const SUPABASE_URL = "https://awrgsfvgajekzrzaagbq.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cmdzZnZnYWpla3pyemFhZ2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NTE5MzIsImV4cCI6MjA5MTIyNzkzMn0.o5b_nSi2AhvVxejYD_QkBTq6lH0lAutCUZsbuVyjVA4";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  let session = null;
  let workspaceId = null;

  // ---------- helpers ----------
  const el = (id) => document.getElementById(id);
  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const pad2 = (n) => String(n).padStart(2, "0");
  const MT = (n) => `${Number(n || 0).toLocaleString("pt-PT")} MT`;

  const fmt = (iso) => {
    const d = new Date(iso);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  function showAuth() {
    const s = el("authScreen");
    const app = el("appRoot");
    if (s) {
      s.classList.remove("hidden");
      s.setAttribute("aria-hidden", "false");
    }
    if (app) app.classList.add("app-locked");
    document.body.style.overflow = "hidden";
  }

  function hideAuth() {
    const s = el("authScreen");
    const app = el("appRoot");
    if (s) {
      s.classList.add("hidden");
      s.setAttribute("aria-hidden", "true");
    }
    if (app) app.classList.remove("app-locked");
    document.body.style.overflow = "";
  }

  async function getSessionSafe() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return null;
      return data?.session || null;
    } catch {
      return null;
    }
  }

  async function refreshSession() {
    session = await getSessionSafe();
    return session;
  }

  async function getMyWorkspaceId() {
    const { data: u, error: e0 } = await supabase.auth.getUser();
    if (e0) throw e0;
    const user = u?.user;
    if (!user) return null;

  const { data, error } = await supabase
  .from("profiles")
  .select("workspace_id, role, active")
  .eq("user_id", user.id);

console.log("profiles found:", data, error);

    if (error) throw error;
    return data?.workspace_id || null;
  }

  async function joinWorkspaceByCode(code) {
    const cc = String(code || "").trim();
    if (!cc) throw new Error("Código da empresa é obrigatório.");

    const { data: u, error: e0 } = await supabase.auth.getUser();
    if (e0) throw e0;

    const user = u?.user;
    if (!user) throw new Error("Sem sessão.");

  const { data: ws, error: e1 } = await supabase
  .from("workspaces")
  .select("id, code")
  .eq("code", cc);

console.log("workspaces found:", ws, e1);
    
if (e1) {
  console.log("DEBUG workspaces select error:", e1);
  throw new Error(e1.message || "Erro ao validar código.");
}

    if (e1) throw new Error("Código inválido ou empresa não encontrada.");

    const { error: e2 } = await supabase
      .from("profiles")
      .upsert({ user_id: user.id, workspace_id: ws.id, role: "member", active: true });

    if (e2) throw e2;
    return ws.id;
  }

  async function signUp(email, pass, code) {
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) throw error;

    await refreshSession();
    if (!session) return { needsEmailConfirm: true };

    workspaceId = await joinWorkspaceByCode(code);
    return { ok: true };
  }

  async function signIn(email, pass, code) {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;

    await refreshSession();
    workspaceId = await getMyWorkspaceId();
    if (!workspaceId) workspaceId = await joinWorkspaceByCode(code);
    return { ok: true };
  }

  async function signOut() {
    await supabase.auth.signOut();
    session = null;
    workspaceId = null;
  }

  // ---------- db ----------
  const emptyDB = () => ({
    meta: { version: "1.1", updatedAt: new Date().toISOString() },
    resources: [
      { id: "r_meet", type: "room", name: "Sala de Reuniões", priceHour: 800, bufferMin: 10 },
      { id: "r_studio", type: "studio", name: "Estúdio", priceHour: 1500, bufferMin: 15 },
      { id: "r_cowork", type: "cowork", name: "Cowork", capacity: 20, priceMonth: 6000, priceDay: 300 }
    ],
    cowork_members: [],
    cowork_daypasses: [],
    bookings: []
  });

  const loadDB = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyDB();
      const x = JSON.parse(raw);

      x.meta ||= { version: "1.1", updatedAt: new Date().toISOString() };
      x.resources ||= emptyDB().resources;
      x.cowork_members ||= [];
      x.cowork_daypasses ||= [];
      x.bookings ||= [];
      return x;
    } catch {
      return emptyDB();
    }
  };

  const saveDB = () => {
    if (!db) return;
    db.meta ||= { version: "1.1", updatedAt: new Date().toISOString() };
    db.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(db));
    if (el("dbUpdated")) el("dbUpdated").textContent = `Atualizado: ${fmt(db.meta.updatedAt)}`;
    // 🔜 quando quiseres sincronizar sempre:
    // cloudPushSafe();
  };

function getResourceByCode(code) {
  return db?.resources?.find((r) => r.code === code) || null;
}
  
  const getResource = (id) => db?.resources?.find((r) => r.id === id);
  const getCowork = () => db?.resources?.find((r) => r.type === "cowork");
  // ------- SNAPSHOT CLOUD (db inteiro por empresa) -------
  async function cloudPull() {
    if (!workspaceId) return false;

    const { data, error } = await supabase
      .from("db_snapshots")
      .select("db")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) throw error;

    if (data?.db) {
      db = data.db;

      // compat
      db.meta ||= { version: "1.1", updatedAt: new Date().toISOString() };
      db.resources ||= emptyDB().resources;
      db.cowork_members ||= [];
      db.cowork_daypasses ||= [];
      db.bookings ||= [];

      saveDB(); // cache offline
      return true;
    }
    return false;
  }

  async function cloudPush() {
    if (!workspaceId) return;

    const { data: u } = await supabase.auth.getUser();
    const user = u?.user;

    const payload = {
      workspace_id: workspaceId,
      db: db,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null
    };

    const { error } = await supabase.from("db_snapshots").upsert(payload);
    if (error) console.warn("Cloud push falhou:", error.message);
  }

  async function cloudPullSafe() {
    try {
      if (!db) db = loadDB();
      await cloudPull();
    } catch (e) {
      console.warn("cloudPull falhou (offline/erro). Vou usar local.", e);
    }
  }

  async function cloudPushSafe() {
    try {
      await cloudPush();
    } catch (e) {
      console.warn("cloudPush falhou (offline/erro).", e);
    }
  }

  // ---------- datas/horas ----------
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfWeek = (d) => {
    const x = startOfDay(d);
    const day = x.getDay(); // 0=Dom
    const diff = (day === 0 ? -6 : 1) - day;
    x.setDate(x.getDate() + diff);
    return x;
  };
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  const hoursBetween = (aISO, bISO) => Math.max(0, (new Date(bISO) - new Date(aISO)) / 36e5);
  const overlaps = (aS, aE, bS, bE) => new Date(aS) < new Date(bE) && new Date(aE) > new Date(bS);
  const withBuffer = (sISO, eISO, bufferMin) => {
    const s = new Date(sISO), e = new Date(eISO);
    s.setMinutes(s.getMinutes() - bufferMin);
    e.setMinutes(e.getMinutes() + bufferMin);
    return { s: s.toISOString(), e: e.toISOString() };
  };
  const toISOfromLocal = (dtLocal) => new Date(dtLocal).toISOString();

  // ---------- selects ----------
  const fillSelects = () => {
    if (!db) return;

    const s1 = el("bkResource");
    if (s1) {
      s1.innerHTML = "";
      db.resources.filter((r) => ["room", "studio"].includes(r.type)).forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name;
        s1.appendChild(opt);
      });
    }

    const s2 = el("bkFilterResource");
    if (s2) {
      s2.innerHTML = `<option value="all">Todos</option>`;
      db.resources.filter((r) => ["room", "studio"].includes(r.type)).forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name;
        s2.appendChild(opt);
      });
    }

    const s3 = el("repResource");
    if (s3) {
      s3.innerHTML = `<option value="all">Todos</option>`;
      db.resources.filter((r) => ["room", "studio"].includes(r.type)).forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name;
        s3.appendChild(opt);
      });
    }
  };

  // ---------- router/menu (sem auth) ----------
  const showScreen = (id) => {
    // se não há sessão, só mostra overlay
    if (!session) {
      showAuth();
      return;
    }

    // troca telas da app
    const screens = ["dash", "bookings", "cowork", "reports"];
    screens.forEach((k) => {
      const node = el("scr-" + k);
      if (node) node.hidden = k !== id;
    });

    document.querySelectorAll(".m-item[data-go]").forEach((b) => b.classList.remove("active"));
    document.querySelector(`.m-item[data-go="${id}"]`)?.classList.add("active");

    if (id === "dash") renderDash();
    if (id === "bookings") renderBookings();
    if (id === "cowork") renderCowork();
    if (id === "reports") renderReports();
  };

  // ---------- render geral ----------
  function renderAll() {
    fillSelects();
    renderDash();
    // mantém a tela atual (se existir), senão dash
    const dash = el("scr-dash");
    const bookings = el("scr-bookings");
    const cowork = el("scr-cowork");
    const reports = el("scr-reports");
    if (dash && bookings && cowork && reports) {
      if (!dash.hidden) renderDash();
      else if (!bookings.hidden) renderBookings();
      else if (!cowork.hidden) renderCowork();
      else if (!reports.hidden) renderReports();
      else showScreen("dash");
    } else {
      showScreen("dash");
    }
  }
  // ---------- cowork (mensalistas) ----------
  const coworkUsedSeats = () =>
    db.cowork_members.filter((m) => m.active).reduce((acc, m) => acc + Number(m.seats || 0), 0);

  const coworkAvailability = () => {
    const cw = getCowork();
    const cap = Number(cw?.capacity || 0);
    const used = coworkUsedSeats();
    return { cap, used, free: Math.max(0, cap - used) };
  };

  const coworkMonthlyRevenue = () =>
    db.cowork_members.filter((m) => m.active).reduce((acc, m) => acc + Number(m.price || 0), 0);

  // ---------- cowork (diárias) ----------
  const seatsCoworkDaypassesOn = (dayYMD) =>
    db.cowork_daypasses.filter((x) => x.date === dayYMD).reduce((acc, x) => acc + Number(x.seats || 0), 0);

  const revenueCoworkDaypassesBetween = (from, to) => {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    return db.cowork_daypasses
      .filter((x) => {
        const t = new Date(x.date + "T12:00:00").getTime();
        return t >= a && t <= b;
      })
      .reduce((acc, x) => acc + Number(x.price || 0), 0);
  };

  const renderCoworkDaypasses = () => {
    if (!el("cwDayList")) return;
    const host = el("cwDayList");
    host.innerHTML = "";

    const day = el("cwDayDate")?.value || ymd(new Date());
    const rows = db.cowork_daypasses
      .filter((x) => x.date === day)
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    if (!rows.length) {
      if (el("cwDayMsg")) el("cwDayMsg").textContent = "Sem diárias registadas para esta data.";
      return;
    }

    const total = rows.reduce((acc, x) => acc + Number(x.price || 0), 0);
    if (el("cwDayMsg")) el("cwDayMsg").textContent = `${rows.length} diária(s) • Total: ${MT(total)}`;

    rows.forEach((x) => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <div class="item-title">${x.name} • ${x.seats} lugar(es)</div>
          <div class="item-meta">${x.date} • ${MT(x.price)} ${x.note ? "• " + x.note : ""}</div>
        </div>
        <button class="btn sm danger" data-del-day="${x.id}">Remover</button>
      `;
      host.appendChild(item);
    });

    host.querySelectorAll("[data-del-day]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-del-day");
        db.cowork_daypasses = db.cowork_daypasses.filter((x) => x.id !== id);
        saveDB();
        renderCoworkDaypasses();
        renderDash();
      };
    });
  };

  const addCoworkDaypass = () => {
    const cw = getCowork();
    const date = el("cwDayDate")?.value || ymd(new Date());
    const name = (el("cwDayName")?.value || "").trim();
    const seats = Math.max(1, Number(el("cwDaySeats")?.value || 1));
    const note = (el("cwDayNote")?.value || "").trim();

    const fallback = Number(cw?.priceDay || 0);
    const priceInput = el("cwDayPrice")?.value;
    const price = Math.max(0, Number(priceInput || fallback));

    if (!name) {
      if (el("cwDayMsg")) el("cwDayMsg").textContent = "Nome/Empresa obrigatório.";
      return;
    }

    const av = coworkAvailability();
    const daySeats = seatsCoworkDaypassesOn(date);
    const cap = Number(cw?.capacity || 0);

    if (av.used + daySeats + seats > cap) {
      const free = Math.max(0, cap - (av.used + daySeats));
      if (el("cwDayMsg")) el("cwDayMsg").textContent = `Sem lugares suficientes para ${date}. Livres: ${free}`;
      return;
    }

    db.cowork_daypasses.push({ id: uid(), date, name, seats, price, note });
    saveDB();

    if (el("cwDayName")) el("cwDayName").value = "";
    if (el("cwDaySeats")) el("cwDaySeats").value = 1;
    if (el("cwDayPrice")) el("cwDayPrice").value = "";
    if (el("cwDayNote")) el("cwDayNote").value = "";

    renderCoworkDaypasses();
    renderDash();
  };

  // ---------- bookings ----------
  const hasConflict = (resourceId, startISO, endISO, ignoreId = null) => {
    const r = getResource(resourceId);
    if (!r || r.type === "cowork") return false;

    const buf = Number(r.bufferMin || 0);
    const A = withBuffer(startISO, endISO, buf);

    return db.bookings
      .filter((b) => b.resourceId === resourceId)
      .filter((b) => b.id !== ignoreId)
      .filter((b) => ["confirmed", "pending", "checked_in"].includes(b.status))
      .some((b) => {
        const B = withBuffer(b.start, b.end, buf);
        return overlaps(A.s, A.e, B.s, B.e);
      });
  };

 

 

 

  // ---------- UI helper ----------
  const setStatusPill = (hostId, busy) => {
    const host = el(hostId);
    if (!host) return;
    const dot = `<span class="dot" style="background:${busy ? "var(--bad)" : "var(--ok)"}"></span>`;
    host.innerHTML = `${dot} ${busy ? "OCUPADA" : "LIVRE"}`;
    host.className = "status";
  };

  // ---------- Dashboard ----------




  const renderDash = async () => {
  const now = new Date();
  if (el("nowLabel")) el("nowLabel").textContent = `Agora: ${fmt(now.toISOString())}`;
  if (el("dashUpdated")) el("dashUpdated").textContent = `Atualizado: ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const av = coworkAvailability();
  if (el("cwOcc")) el("cwOcc").textContent = `${av.used}/${av.cap}`;
  if (el("cwFree")) el("cwFree").textContent = `${av.free} lugar(es) livres`;
  if (el("cwRevenue")) el("cwRevenue").textContent = `Receita mensal ativa: ${MT(coworkMonthlyRevenue())}`;

  try {
   const meet = getResourceByCode("r_meet");
const studio = getResourceByCode("r_studio");

const meetNow = meet ? await nowBookingFor(meet.id, now) : null;
const studioNow = studio ? await nowBookingFor(studio.id, now) : null;

    setStatusPill("meetStatus", !!meetNow);
    setStatusPill("studioStatus", !!studioNow);

    if (el("meetNow")) {
      el("meetNow").textContent = meetNow
        ? `Em uso por ${meetNow.client_name} até ${fmt(meetNow.end_at)}`
        : "Sem uso agora.";
    }

    if (el("studioNow")) {
      el("studioNow").textContent = studioNow
        ? `Em uso por ${studioNow.client_name} até ${fmt(studioNow.end_at)}`
        : "Sem uso agora.";
    }

  const meetNext = meet ? await nextBookingFor(meet.id, now) : null;
const studioNext = studio ? await nextBookingFor(studio.id, now) : null;

    if (el("meetNext")) {
      el("meetNext").textContent = meetNext
        ? `Próxima: ${fmt(meetNext.start_at)} (${meetNext.status})`
        : "Sem próximas reservas.";
    }

    if (el("studioNext")) {
      el("studioNext").textContent = studioNext
        ? `Próxima: ${fmt(studioNext.start_at)} (${studioNext.status})`
        : "Sem próximas reservas.";
    }

    if (!renderDash._rep) renderDash._rep = "today";
    await renderQuickReport(renderDash._rep);
    await renderTodayList();
  } catch (err) {
    console.error("Erro no dashboard:", err);
  }
};

  // ---------- Bookings screen ----------
  const setBookingDayDefault = () => {
    if (el("bkDay") && !el("bkDay").value) el("bkDay").value = ymd(new Date());
  };

  const bookingsForDay = async (dayYMD) => {
  return await fetchBookingsForDay(dayYMD);
};

const renderBookings = async () => {
  fillSelects();
  setBookingDayDefault();
  if (!el("bookingsList")) return;

  const day = el("bkDay").value;
  const rid = el("bkFilterResource")?.value || "all";
  const st = el("bkFilterStatus")?.value || "all";
  const q = (el("bkSearch")?.value || "").trim().toLowerCase();

  let rows = await bookingsForDay(day);

  rows = rows
    .filter((b) => ["room", "studio"].includes(getResource(b.resource_id)?.type))
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));

  if (rid !== "all") rows = rows.filter((b) => b.resource_id === rid);
  if (st !== "all") rows = rows.filter((b) => b.status === st);
  if (q) rows = rows.filter((b) => String(b.client_name || "").toLowerCase().includes(q));

  const host = el("bookingsList");
  host.innerHTML = "";

  if (!rows.length) {
    if (el("bookingsMsg")) el("bookingsMsg").textContent = "Sem reservas para os filtros atuais.";
    return;
  }

  if (el("bookingsMsg")) el("bookingsMsg").textContent = "";

  rows.forEach((bk) => {
    const r = getResource(bk.resource_id);
    const statusClass =
      bk.status === "confirmed" ? "ok" :
      bk.status === "pending" ? "warn" :
      bk.status === "cancelled" ? "bad" : "warn";

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div class="item-title">${r?.name || "—"} • ${bk.client_name}</div>
        <div class="item-meta">${fmt(bk.start_at)} → ${fmt(bk.end_at)} • ${MT(bk.total_price)} • <span class="badge ${statusClass}">${bk.status}</span></div>
      </div>
      <button class="btn sm" data-edit="${bk.id}">Abrir</button>
    `;
    host.appendChild(item);
  });

  host.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => openBookingModal(btn.getAttribute("data-edit"));
  });
};

const openBookingModal = async (id = null) => {
  fillSelects();
  if (!el("bookingModal")) return;

  if (el("bkMsg")) el("bkMsg").textContent = "—";
  el("bookingModal").style.display = "grid";

  if (!id) {
    if (el("bkModalTitle")) el("bkModalTitle").textContent = "Nova reserva";
    el("bkId").value = "";
    el("bkClient").value = "";
    el("bkStatus").value = "confirmed";
   const meet = getResourceByCode("r_meet");
el("bkResource").value = meet?.id || "";

    const day = el("bkDay")?.value || ymd(new Date());
    el("bkStart").value = `${day}T09:00`;
    el("bkEnd").value = `${day}T10:00`;

    autoPriceFor();
    if (el("btnDeleteBooking")) el("btnDeleteBooking").style.display = "none";
    return;
  }

  try {
    const bk = await fetchBookingById(id);

    if (el("bkModalTitle")) el("bkModalTitle").textContent = "Editar reserva";
    el("bkId").value = bk.id;
    el("bkResource").value = bk.resource_id;
    el("bkClient").value = bk.client_name || "";
    el("bkStatus").value = bk.status || "confirmed";
    el("bkPrice").value = Number(bk.total_price || 0);

    const s = new Date(bk.start_at);
    const e = new Date(bk.end_at);

    el("bkStart").value = `${ymd(s)}T${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
    el("bkEnd").value = `${ymd(e)}T${pad2(e.getHours())}:${pad2(e.getMinutes())}`;

    if (el("btnDeleteBooking")) el("btnDeleteBooking").style.display = "inline-flex";
  } catch (err) {
    if (el("bkMsg")) el("bkMsg").textContent = err.message || "Erro ao abrir reserva.";
  }
};

  const closeBookingModal = () => {
    if (el("bookingModal")) el("bookingModal").style.display = "none";
  };

  const autoPriceFor = () => {
    const rid = el("bkResource")?.value;
    const r = getResource(rid);
    if (!r) return;

    const s = el("bkStart")?.value;
    const e = el("bkEnd")?.value;
    if (!s || !e) return;

    const startISO = toISOfromLocal(s);
    const endISO = toISOfromLocal(e);

    const hrs = hoursBetween(startISO, endISO);
    const price = Math.round(hrs * Number(r.priceHour || 0));
    if (el("bkPrice")) el("bkPrice").value = isFinite(price) ? price : 0;
  };

const saveBooking = async () => {
  try {
    const id = (el("bkId")?.value || "").trim();
    const rid = el("bkResource")?.value;
    const client = (el("bkClient")?.value || "").trim();
    const s = el("bkStart")?.value;
    const e = el("bkEnd")?.value;
    const status = el("bkStatus")?.value;
    const price = Math.max(0, Number(el("bkPrice")?.value || 0));

    if (!rid || !client || !s || !e) {
      if (el("bkMsg")) el("bkMsg").textContent = "Preenche recurso, cliente, início e fim.";
      return;
    }

    const startISO = new Date(s).toISOString();
    const endISO = new Date(e).toISOString();

    if (new Date(endISO) <= new Date(startISO)) {
      if (el("bkMsg")) el("bkMsg").textContent = "Fim deve ser depois do início.";
      return;
    }

    const payload = {
      workspace_id: workspaceId,
      resource_id: rid,
      client_name: client,
      start_at: startISO,
      end_at: endISO,
      status,
      total_price: price
    };

    let error = null;

    if (!id) {
      ({ error } = await supabase.from("bookings").insert(payload));
    } else {
      ({ error } = await supabase
        .from("bookings")
        .update(payload)
        .eq("id", id));
    }

    if (error) throw error;

    if (el("bkMsg")) el("bkMsg").textContent = "Guardado ✅";
    closeBookingModal();
    await renderDash();
    await renderBookings();
  } catch (err) {
    if (el("bkMsg")) el("bkMsg").textContent = err.message || "Erro ao guardar reserva.";
  }
};

const deleteBooking = async () => {
  try {
    const id = (el("bkId")?.value || "").trim();
    if (!id) return;

    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", id);

    if (error) throw error;

    closeBookingModal();
    await renderDash();
    await renderBookings();
  } catch (err) {
    if (el("bkMsg")) el("bkMsg").textContent = err.message || "Erro ao apagar reserva.";
  }
};

  // ---------- Cowork screen ----------
  const renderCowork = () => {
    const cw = getCowork();

    if (el("cwCapacity")) el("cwCapacity").value = Number(cw?.capacity || 0);
    if (el("cwPriceMonth")) el("cwPriceMonth").value = Number(cw?.priceMonth || 0);
    if (el("cwPriceDay")) el("cwPriceDay").value = Number(cw?.priceDay || 0);

    if (el("cwDayDate") && !el("cwDayDate").value) el("cwDayDate").value = ymd(new Date());
    if (el("cwDayPrice") && !el("cwDayPrice").value) el("cwDayPrice").value = Number(cw?.priceDay || 0);

    const list = el("membersList");
    if (list) list.innerHTML = "";

    if (list) {
      if (!db.cowork_members.length) {
        if (el("membersMsg")) el("membersMsg").textContent = "Sem mensalistas ainda.";
      } else {
        if (el("membersMsg")) el("membersMsg").textContent = "";

        db.cowork_members
          .slice()
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .forEach((m) => {
            const badge = m.active ? `<span class="badge ok">Ativo</span>` : `<span class="badge warn">Inativo</span>`;
            const item = document.createElement("div");
            item.className = "item";
            item.innerHTML = `
              <div>
                <div class="item-title">${m.name}</div>
                <div class="item-meta">${m.seats} lugar(es) • ${MT(m.price)} / mês</div>
              </div>
              <div class="row" style="gap:8px">
                ${badge}
                <button class="btn sm danger" data-del="${m.id}">Remover</button>
              </div>
            `;
            list.appendChild(item);
          });

        list.querySelectorAll("[data-del]").forEach((btn) => {
          btn.onclick = () => {
            const id = btn.getAttribute("data-del");
            db.cowork_members = db.cowork_members.filter((x) => x.id !== id);
            saveDB();
            renderCowork();
            renderDash();
          };
        });
      }
    }

    if (el("cwMsg")) el("cwMsg").textContent = "—";
    renderCoworkDaypasses();
  };

  const saveCoworkCapacity = () => {
    const cw = getCowork();
    cw.capacity = Math.max(0, Number(el("cwCapacity")?.value || 0));
    saveDB();
    if (el("cwMsg")) el("cwMsg").textContent = "Capacidade guardada ✅";
    renderCowork();
    renderDash();
  };

  const saveCoworkPrices = () => {
    const cw = getCowork();
    cw.priceMonth = Math.max(0, Number(el("cwPriceMonth")?.value || 0));
    cw.priceDay = Math.max(0, Number(el("cwPriceDay")?.value || 0));
    saveDB();
    if (el("cwMsg")) el("cwMsg").textContent = "Preços guardados ✅";
    if (el("cwDayPrice") && !el("cwDayPrice").value) el("cwDayPrice").value = Number(cw.priceDay || 0);
    renderDash();
  };
  const openMemberModal = () => {
    const cw = getCowork();
    if (el("mName")) el("mName").value = "";
    if (el("mSeats")) el("mSeats").value = 1;
    if (el("mPrice")) el("mPrice").value = Number(cw?.priceMonth || 6000);
    if (el("mActive")) el("mActive").value = "true";
    if (el("mMsg")) el("mMsg").textContent = "—";
    if (el("memberModal")) el("memberModal").style.display = "grid";
  };

  const closeMemberModal = () => {
    if (el("memberModal")) el("memberModal").style.display = "none";
  };

  const saveMember = () => {
    const name = (el("mName")?.value || "").trim();
    const seats = Math.max(1, Number(el("mSeats")?.value || 1));
    const price = Math.max(0, Number(el("mPrice")?.value || 0));
    const active = el("mActive")?.value === "true";

    if (!name) {
      if (el("mMsg")) el("mMsg").textContent = "Nome obrigatório.";
      return;
    }

    if (active) {
      const av = coworkAvailability();
      if (av.used + seats > av.cap) {
        if (el("mMsg")) el("mMsg").textContent = `Sem lugares suficientes. Livres agora: ${av.free}`;
        return;
      }
    }

    db.cowork_members.push({ id: uid(), name, seats, price, active });
    saveDB();
    closeMemberModal();
    renderCowork();
    renderDash();
  };

  // ---------- Reports ----------
  const renderReports = () => {
    fillSelects();

    const now = new Date();
    if (el("repFrom") && !el("repFrom").value) el("repFrom").value = ymd(startOfMonth(now));
    if (el("repTo") && !el("repTo").value) el("repTo").value = ymd(endOfMonth(now));

    if (el("reportsList")) el("reportsList").innerHTML = "";
    if (el("reportsMsg")) el("reportsMsg").textContent = "Defina o intervalo e clique em Gerar.";
    if (el("repTotal2")) el("repTotal2").textContent = "—";
    if (el("repMeta2")) el("repMeta2").textContent = "—";
  };

  const runReports = () => {
    const from = el("repFrom")?.value;
    const to = el("repTo")?.value;
    const rid = el("repResource")?.value || "all";
    if (!from || !to) {
      if (el("reportsMsg")) el("reportsMsg").textContent = "Preencha De e Até.";
      return;
    }

    const fromD = new Date(from + "T00:00:00");
    const toD = new Date(to + "T23:59:59");

    let rows = db.bookings
      .filter((x) => ["confirmed", "checked_in", "checked_out"].includes(x.status))
      .filter((x) => {
        const s = new Date(x.start);
        return s >= fromD && s <= toD;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (rid !== "all") rows = rows.filter((x) => x.resourceId === rid);

    const totalBookings = rows.reduce((acc, x) => acc + Number(x.price || 0), 0);
    const totalCoworkDay = revenueCoworkDaypassesBetween(fromD, toD);
    const totalAll = totalBookings + totalCoworkDay;

    if (el("repTotal2")) el("repTotal2").textContent = MT(totalAll);
    if (el("repMeta2")) el("repMeta2").textContent = `${from} → ${to} • Cowork diárias: ${MT(totalCoworkDay)}`;

    const host = el("reportsList");
    if (!host) return;
    host.innerHTML = "";

    if (!rows.length && !db.cowork_daypasses.length) {
      if (el("reportsMsg")) el("reportsMsg").textContent = "Sem dados no intervalo.";
      return;
    }
    if (el("reportsMsg")) el("reportsMsg").textContent = "";

    rows.forEach((bk) => {
      const r = getResource(bk.resourceId);
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <div class="item-title">${r?.name || "—"} • ${bk.client}</div>
          <div class="item-meta">${fmt(bk.start)} → ${fmt(bk.end)} • ${MT(bk.price)}</div>
        </div>
        <button class="btn sm" data-edit="${bk.id}">Abrir</button>
      `;
      host.appendChild(item);
    });

    host.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.onclick = () => {
        showScreen("bookings");
        openBookingModal(btn.getAttribute("data-edit"));
      };
    });

    const dayRows = db.cowork_daypasses
      .filter((x) => {
        const t = new Date(x.date + "T12:00:00");
        return t >= fromD && t <= toD;
      })
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    dayRows.forEach((x) => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <div class="item-title">Cowork (diária) • ${x.name}</div>
          <div class="item-meta">${x.date} • ${x.seats} lugar(es) • ${MT(x.price)} ${x.note ? "• " + x.note : ""}</div>
        </div>
        <span class="badge ok">cowork-day</span>
      `;
      host.appendChild(item);
    });
  };

  const exportCSV = () => {
    const from = el("repFrom")?.value;
    const to = el("repTo")?.value;
    const rid = el("repResource")?.value || "all";
    if (!from || !to) return;

    const fromD = new Date(from + "T00:00:00");
    const toD = new Date(to + "T23:59:59");

    let rows = db.bookings
      .filter((x) => ["confirmed", "checked_in", "checked_out"].includes(x.status))
      .filter((x) => {
        const s = new Date(x.start);
        return s >= fromD && s <= toD;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (rid !== "all") rows = rows.filter((x) => x.resourceId === rid);

    const dayRows = db.cowork_daypasses
      .filter((x) => {
        const t = new Date(x.date + "T12:00:00");
        return t >= fromD && t <= toD;
      })
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    const header = ["type", "id", "resource", "client", "date", "start", "end", "status", "seats", "price", "note"];
    const lines = [header.join(",")];

    rows.forEach((bk) => {
      const r = getResource(bk.resourceId);
      const vals = [
        "booking",
        bk.id,
        `"${String(r?.name || "").replace(/"/g, '""')}"`,
        `"${String(bk.client || "").replace(/"/g, '""')}"`,
        "",
        bk.start,
        bk.end,
        bk.status,
        "",
        Number(bk.price || 0),
        ""
      ];
      lines.push(vals.join(","));
    });

    dayRows.forEach((x) => {
      const vals = [
        "cowork-day",
        x.id,
        `"Cowork"`,
        `"${String(x.name || "").replace(/"/g, '""')}"`,
        x.date,
        "",
        "",
        "confirmed",
        Number(x.seats || 0),
        Number(x.price || 0),
        `"${String(x.note || "").replace(/"/g, '""')}"`,
      ];
      lines.push(vals.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio_${from}_a_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------- backup/reset ----------
  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `space_control_backup_${ymd(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const factoryReset = () => {
    const ok = confirm("Tem certeza? Isto apaga todos os dados deste navegador.");
    if (!ok) return;
    localStorage.removeItem(KEY);
    db = emptyDB();
    saveDB();
    renderAll();
    showScreen("dash");
  };

  // ---------- bind ----------
  const bind = () => {
    // menu
    document.querySelectorAll(".m-item[data-go]").forEach((btn) => {
      btn.onclick = () => showScreen(btn.getAttribute("data-go"));
    });

    // dash report buttons
    document.querySelectorAll("[data-rep]").forEach((b) => {
      b.onclick = () => renderQuickReport(b.getAttribute("data-rep"));
    });

    // AUTH (overlay)
    if (el("btnLogin")) el("btnLogin").onclick = async () => {
      try {
        el("authMsg").textContent = "A entrar...";
        await signIn(el("authEmail").value, el("authPass").value, el("authCode").value);

        el("authMsg").textContent = "Login OK ✅ A carregar dados...";
        await cloudPullSafe();

        // mostra botão sair
        if (el("btnLogout")) el("btnLogout").style.display = "inline-flex";

        hideAuth();
        renderAll();
        showScreen("dash");
        el("authMsg").textContent = "—";
      } catch (e) {
        el("authMsg").textContent = e?.message || String(e);
      }
    };

    if (el("btnSignup")) el("btnSignup").onclick = async () => {
      try {
        el("authMsg").textContent = "A criar conta...";
        const r = await signUp(el("authEmail").value, el("authPass").value, el("authCode").value);
        if (r?.needsEmailConfirm) {
          el("authMsg").textContent = "Conta criada ✅ Confirma no email e depois faz login.";
          return;
        }

        el("authMsg").textContent = "Conta criada ✅ A carregar dados...";
        await cloudPullSafe();

        if (el("btnLogout")) el("btnLogout").style.display = "inline-flex";

        hideAuth();
        renderAll();
        showScreen("dash");
        el("authMsg").textContent = "—";
      } catch (e) {
        el("authMsg").textContent = e?.message || String(e);
      }
    };

    if (el("btnLogout")) el("btnLogout").onclick = async () => {
      await signOut();
      if (el("btnLogout")) el("btnLogout").style.display = "none";
      el("authMsg").textContent = "Sessão terminada.";
      showAuth();
    };

    // bookings filters
    if (el("bkDay")) el("bkDay").addEventListener("change", renderBookings);
    if (el("bkFilterResource")) el("bkFilterResource").addEventListener("change", renderBookings);
    if (el("bkFilterStatus")) el("bkFilterStatus").addEventListener("change", renderBookings);
    if (el("bkSearch"))
      el("bkSearch").addEventListener("input", () => {
        clearTimeout(bind._t);
        bind._t = setTimeout(renderBookings, 200);
      });

    // bookings modal
    if (el("btnOpenBooking")) el("btnOpenBooking").onclick = () => openBookingModal(null);
    if (el("btnCloseBooking")) el("btnCloseBooking").onclick = closeBookingModal;
    if (el("btnSaveBooking")) el("btnSaveBooking").onclick = saveBooking;
    if (el("btnDeleteBooking")) el("btnDeleteBooking").onclick = deleteBooking;

    if (el("bkStart")) el("bkStart").addEventListener("change", autoPriceFor);
    if (el("bkEnd")) el("bkEnd").addEventListener("change", autoPriceFor);
    if (el("bkResource")) el("bkResource").addEventListener("change", autoPriceFor);

    // cowork mensal
    if (el("btnSaveCowork")) el("btnSaveCowork").onclick = saveCoworkCapacity;
    if (el("btnSaveCoworkPrices")) el("btnSaveCoworkPrices").onclick = saveCoworkPrices;
    if (el("btnAddMember")) el("btnAddMember").onclick = openMemberModal;
    if (el("btnCloseMember")) el("btnCloseMember").onclick = closeMemberModal;
    if (el("btnSaveMember")) el("btnSaveMember").onclick = saveMember;

    // cowork diárias
    if (el("cwDayDate"))
      el("cwDayDate").addEventListener("change", () => {
        const cw = getCowork();
        if (el("cwDayPrice") && !el("cwDayPrice").value) el("cwDayPrice").value = Number(cw?.priceDay || 0);
        renderCoworkDaypasses();
      });
    if (el("btnAddCoworkDay")) el("btnAddCoworkDay").onclick = addCoworkDaypass;

    // reports
    if (el("btnRunReports")) el("btnRunReports").onclick = runReports;
    if (el("btnExportCSV")) el("btnExportCSV").onclick = exportCSV;

    // backup/reset
    if (el("btnBackup")) el("btnBackup").onclick = downloadBackup;
    if (el("btnFactoryReset")) el("btnFactoryReset").onclick = factoryReset;

    // close modals on background click
    if (el("bookingModal"))
      el("bookingModal").addEventListener("click", (e) => {
        if (e.target.id === "bookingModal") closeBookingModal();
      });
    if (el("memberModal"))
      el("memberModal").addEventListener("click", (e) => {
        if (e.target.id === "memberModal") closeMemberModal();
      });
  };

  // ---------- INIT (corrigido para overlay) ----------
  async function init() {
    // 1) carrega db SEMPRE primeiro
    db = loadDB();

    // labels base
    if (db?.meta?.updatedAt && el("dbUpdated")) el("dbUpdated").textContent = `Atualizado: ${fmt(db.meta.updatedAt)}`;
    if (el("bkDay")) el("bkDay").value = ymd(new Date());

    // relógio
    const tickNow = () => {
      if (el("nowLabel")) el("nowLabel").textContent = `Agora: ${fmt(new Date().toISOString())}`;
    };
    tickNow();
    setInterval(tickNow, 30 * 1000);

    // bind UI
    bind();

    // 2) sessão
    await refreshSession();

    // 3) se não logado → overlay e fim
    if (!session) {
      showAuth();
      return;
    }

    // 4) se logado → descobre workspace e puxa cloud (se der)
    workspaceId = await getMyWorkspaceId();
    hideAuth();
    if (el("btnLogout")) el("btnLogout").style.display = "inline-flex";

    if (workspaceId) await cloudPullSafe();

    // 5) renderiza e abre dash
    renderAll();
    showScreen("dash");

    // auto refresh dash
    setInterval(() => {
      const dash = el("scr-dash");
      if (dash && !dash.hidden) renderDash();
    }, 20 * 1000);

    if (workspaceId) {
  await cloudPullSafe();

  try {
    const resources = await fetchResources(workspaceId);

    db.resources = resources.map((r) => ({
      id: r.id, // UUID REAL
      code: r.code,
      type: r.resource_type,
      name: r.name,
      priceHour: Number(r.price_hour || 0),
      priceDay: Number(r.price_day || 0),
      priceMonth: Number(r.price_month || 0),
      capacity: Number(r.capacity || 0),
      bufferMin: Number(r.buffer_min || 0)
    }));

  } catch (err) {
    console.error("Erro ao carregar resources:", err);
  }
}
    
  }
  

  
async function getMyProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const user = userData?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, workspace_id, role, active')
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return data;
}

async function fetchResources(workspaceId) {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchBookingsByDay(workspaceId, day) {
  const start = new Date(day + 'T00:00:00');
  const end = new Date(day + 'T23:59:59');

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('start_at', start.toISOString())
    .lte('start_at', end.toISOString())
    .order('start_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchCoworkMembers(workspaceId) {
  const { data, error } = await supabase
    .from('cowork_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchCoworkDaypasses(workspaceId, date) {
  const { data, error } = await supabase
    .from('cowork_daypasses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('pass_date', date)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

  async function fetchBookingsForDay(dayYMD) {
  const day = new Date(dayYMD + "T00:00:00");
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);

  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      workspace_id,
      resource_id,
      client_name,
      start_at,
      end_at,
      status,
      total_price
    `)
    .eq("workspace_id", workspaceId)
    .gte("start_at", start.toISOString())
    .lte("start_at", end.toISOString())
    .order("start_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

  async function fetchBookingById(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

  async function fetchBookingsBetween(from, to) {
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      workspace_id,
      resource_id,
      client_name,
      start_at,
      end_at,
      status,
      total_price
    `)
    .eq("workspace_id", workspaceId)
    .gte("start_at", new Date(from).toISOString())
    .lte("start_at", new Date(to).toISOString())
    .order("start_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function nowBookingFor(resourceId, now = new Date()) {
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      resource_id,
      client_name,
      start_at,
      end_at,
      status,
      total_price
    `)
    .eq("workspace_id", workspaceId)
    .eq("resource_id", resourceId)
    .in("status", ["confirmed", "checked_in"])
    .lte("start_at", now.toISOString())
    .gt("end_at", now.toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function nextBookingFor(resourceId, now = new Date()) {
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      resource_id,
      client_name,
      start_at,
      end_at,
      status,
      total_price
    `)
    .eq("workspace_id", workspaceId)
    .eq("resource_id", resourceId)
    .in("status", ["confirmed", "pending"])
    .gt("start_at", now.toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function revenueBookingsBetween(from, to, resourceId = null) {
  let query = supabase
    .from("bookings")
    .select("total_price")
    .eq("workspace_id", workspaceId)
    .in("status", ["confirmed", "checked_in", "checked_out"])
    .gte("start_at", new Date(from).toISOString())
    .lte("start_at", new Date(to).toISOString());

  if (resourceId) query = query.eq("resource_id", resourceId);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).reduce((acc, x) => acc + Number(x.total_price || 0), 0);
}



  


  document.addEventListener("DOMContentLoaded", () => init());
})();
