(() => {
  "use strict";

  const SUPABASE_URL = "https://etjkuqdaadiehdpttkon.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0amt1cWRhYWRpZWhkcHR0a29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDY0ODIsImV4cCI6MjA5NzcyMjQ4Mn0.uS2olKKCvrgLgwjr2yjj27Mm0ZXoSIp5LI9w5yPLlac";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  let session = null;
  let profile = null;
  let company = null;
  let resources = [];
  let profiles = [];
  const schemaSupport = { coworkPayments: true, taskApprovals: true };


  const el = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmt = (v) => new Date(v).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
  const money = (v) => `${Number(v || 0).toLocaleString("pt-PT")} MT`;
  const isActiveReservation = (r) => !["cancelled", "checked_out"].includes(r.status);
  const csvEscape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const dateRangeDays = (from, to) => Math.max(1, Math.ceil((to - from) / 86400000));
  const html = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const isAdmin = () => profile?.role === "admin";
  const currentUserId = () => session?.user?.id || null;

  function message(id, text) { const node = el(id); if (node) node.textContent = text; }
  function isMissingSchemaError(error) {
    const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLowerCase();
    return ["does not exist", "could not find", "schema cache", "relationship", "column", "table"].some((term) => text.includes(term));
  }

  function showAuth(text = "—") { el("authScreen")?.classList.remove("hidden"); el("appRoot")?.classList.add("app-locked"); message("authMsg", text); }
  function hideAuth() { el("authScreen")?.classList.add("hidden"); el("appRoot")?.classList.remove("app-locked"); }
  function openModal(id) { const node = el(id); if (node) node.style.display = "grid"; }
  function closeModal(id) { const node = el(id); if (node) node.style.display = "none"; }

  async function loadSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
    return session;
  }

  async function loadProfile() {
    const userId = currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase.from("profiles").select("*, companies(id,name,code)").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    profile = data;
    company = data?.companies || null;
    if (company) message("companyLabel", `Empresa: ${company.name}`);
    return data;
  }

  function isExistingSignup(data, error) {
    const messageText = `${error?.message || ""} ${error?.code || ""} ${error?.name || ""}`.toLowerCase();
    if (error && (messageText.includes("already") || messageText.includes("registered") || messageText.includes("exists") || messageText.includes("conflict-user-id"))) return true;
    return Boolean(data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
  }

  async function saveSignupProfile(userId, email) {
    if (!userId) throw new Error("Não foi possível obter o ID do utilizador criado pelo Supabase Auth.");
    const { data: existingProfile, error: readError } = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
    if (readError) throw readError;
    if (existingProfile) return;

    const { data: defaultCompany, error: companyError } = await supabase.from("companies").select("id").eq("code", "XHUB-26").maybeSingle();
    if (companyError) throw companyError;
    if (!defaultCompany) throw new Error("Empresa padrão não encontrada. Contacte o administrador.");

    const { error: insertError } = await supabase.from("profiles").insert({
      user_id: userId,
      company_id: defaultCompany.id,
      name: email.split("@")[0] || "utilizador",
      role: "user",
      status: "pending"
    });
    if (insertError) throw insertError;
  }

  async function signup() {
    const email = el("authEmail").value.trim().toLowerCase();
    const password = el("authPass").value;
    if (!email || !password) throw new Error("Preencha email e senha.");

    const name = email.split("@")[0] || "utilizador";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name
        }
      }
    });

    if (isExistingSignup(data, error)) throw new Error("Já existe uma conta com este email. Faça login ou use outro email.");
    if (error) throw error;

    const user = data?.user;
    if (!user?.id) throw new Error("Não foi possível confirmar a criação do utilizador no Supabase Auth.");

    if (data.session) {
      session = data.session;
      await saveSignupProfile(user.id, email);
      await supabase.auth.signOut();
      session = null;
    }

    throw new Error("Conta criada. Aguarde aprovação do administrador.");
  }

  async function login() {
    const email = el("authEmail").value.trim().toLowerCase();
    const password = el("authPass").value;
    if (!email || !password) throw new Error("Preencha email e senha.");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Email ou senha inválidos.");
    session = data.session;

    const loaded = await loadProfile();
    if (!loaded?.company_id) throw new Error("Perfil não encontrado. Contacte o administrador.");
    if (loaded.status !== "approved") throw new Error("Conta pendente de aprovação.");
  }

  async function logout() {
    await supabase.auth.signOut();
    session = null; profile = null; company = null; resources = []; profiles = [];
    showAuth("Sessão terminada.");
  }

  async function loadBaseData() {
    if (!profile?.company_id) return;
    const [resourceResult, profileResult] = await Promise.all([
      supabase.from("resources").select("*").eq("company_id", profile.company_id).eq("active", true).order("name"),
      supabase.from("profiles").select("user_id,name,role,status").eq("company_id", profile.company_id).order("name")
    ]);
    if (resourceResult.error) throw resourceResult.error;
    if (profileResult.error) throw profileResult.error;
    resources = resourceResult.data || [];
    profiles = profileResult.data || [];
    fillResourceSelects();
    fillPeopleSelect();
  }

  const BOOKABLE_RESOURCE_CODES = new Set(["r_green_studio", "r_blue_studio", "r_meeting_room", "r_stage"]);

  function operationalResources() {
    return resources.filter((r) => r.active !== false && BOOKABLE_RESOURCE_CODES.has(r.code));
  }

  function resourceCategoryName(resourceId) {
    const code = resources.find((r) => r.id === resourceId)?.code;
    if (code === "r_green_studio") return "A. Reservas de Estúdio Verde";
    if (code === "r_blue_studio") return "B. Reservas de Estúdio Azul";
    if (code === "r_meeting_room") return "C. Reservas de Sala de Reuniões";
    if (code === "r_stage") return "D. Reservas de Palco / Espaço para Actividades";
    return "H. Outras receitas";
  }

  function memberBalance(m) { return Number(m.total_value || 0) - Number(m.amount_paid || 0); }
  function memberComputedStatus(m, now = new Date()) {
    if (["cancelled", "expired"].includes(m.status)) return m.status;
    if (m.end_date && new Date(`${m.end_date}T23:59:59`) < now) return "expired";
    if (m.next_payment_date && memberBalance(m) > 0 && new Date(`${m.next_payment_date}T23:59:59`) < now) return "overdue";
    return m.status || "active";
  }

  function fillResourceSelects() {
    ["resFilterResource", "reservationResource"].forEach((id) => {
      const node = el(id); if (!node) return;
      node.innerHTML = id === "resFilterResource" ? '<option value="all">Todos</option>' : "";
      operationalResources().forEach((r) => node.insertAdjacentHTML("beforeend", `<option value="${r.id}">${html(r.name)}</option>`));
    });
  }

  function fillPeopleSelect() {
    const node = el("taskResponsible"); if (!node) return;
    node.innerHTML = "";
    profiles.filter((p) => p.status === "approved").forEach((p) => node.insertAdjacentHTML("beforeend", `<option value="${p.user_id}">${html(p.name)}</option>`));
    if (currentUserId()) node.value = currentUserId();
  }

  async function queryReservations(from, to) {
    const { data, error } = await supabase.from("reservations").select("*").eq("company_id", profile.company_id).lt("start_at", to.toISOString()).gt("end_at", from.toISOString()).order("start_at");
    if (error) throw error;
    return data || [];
  }

  function resourceName(id) {
    return resources.find((r) => r.id === id)?.name || "Espaço";
  }

  function statusBadge(label, kind = "ok") {
    return `<span class="badge ${kind}">${html(label)}</span>`;
  }

  function buildSpaceStatus(rows, now = new Date()) {
    return operationalResources().map((resource) => {
      const related = rows.filter((r) => r.resource_id === resource.id && isActiveReservation(r));
      const current = related.find((r) => new Date(r.start_at) <= now && new Date(r.end_at) > now);
      const next = related.find((r) => new Date(r.start_at) > now);
      return { resource, current, next };
    });
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob([rows.map((row) => row.map(csvEscape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function queryCoworkMembers() {
    let result = await supabase.from("cowork_members").select("*, cowork_payments(*)").eq("company_id", profile.company_id).order("name");
    if (result.error && isMissingSchemaError(result.error)) {
      schemaSupport.coworkPayments = false;
      result = await supabase.from("cowork_members").select("*").eq("company_id", profile.company_id).order("name");
    } else {
      schemaSupport.coworkPayments = true;
    }
    return result;
  }

  async function queryTasks(options = {}) {
    const { excludeRejected = false, pendingOnly = false, orderCreatedDesc = false, all = false } = options;
    let q = supabase.from("tasks").select("*").eq("company_id", profile.company_id);
    if (excludeRejected) q = q.neq("approval_status", "rejected");
    if (pendingOnly) q = q.eq("approval_status", "pending");
    if (!all && !isAdmin()) q = q.or(`responsible_id.eq.${currentUserId()},created_by.eq.${currentUserId()}`);
    q = orderCreatedDesc ? q.order("created_at", { ascending: false }) : q.order("due_date");
    let result = await q;
    if (result.error && isMissingSchemaError(result.error) && (excludeRejected || pendingOnly)) {
      schemaSupport.taskApprovals = false;
      q = supabase.from("tasks").select("*").eq("company_id", profile.company_id);
      if (!all && !isAdmin()) q = q.or(`responsible_id.eq.${currentUserId()},created_by.eq.${currentUserId()}`);
      result = orderCreatedDesc ? await q.order("created_at", { ascending: false }) : await q.order("due_date");
    } else if (!result.error) {
      schemaSupport.taskApprovals = true;
    }
    return result;
  }

  async function getOperationalData(from, to) {
    const [{ data: reservations, error: er }, { data: members, error: em }, { data: passes, error: ep }, { data: tasks, error: et }] = await Promise.all([
      supabase.from("reservations").select("*").eq("company_id", profile.company_id).lt("start_at", to.toISOString()).gt("end_at", from.toISOString()).order("start_at"),
      queryCoworkMembers(),
      supabase.from("cowork_daypasses").select("*").eq("company_id", profile.company_id).gte("date", ymd(from)).lte("date", ymd(to)).order("date", { ascending: false }),
      queryTasks({ excludeRejected: true, all: true })
    ]);
    if (er) throw er; if (em) throw em; if (ep) throw ep; if (et) throw et;
    return { reservations: reservations || [], members: members || [], passes: passes || [], tasks: tasks || [] };
  }

  async function renderDashboard() {
    message("nowLabel", `Agora: ${fmt(new Date())}`);
    const today = new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    const weekEnd = new Date(start); weekEnd.setDate(weekEnd.getDate() + 7);
    const { reservations: rows, members, passes, tasks } = await getOperationalData(start, end);
    const activeMembers = members.filter((m) => memberComputedStatus(m, today) === "active");
    const overdueMembers = members.filter((m) => memberComputedStatus(m, today) === "overdue");
    const expiredMembers = members.filter((m) => ["expired", "cancelled"].includes(memberComputedStatus(m, today)));
    const daypassesToday = passes.filter((p) => p.date === ymd(today));
    const reservationRevenue = rows.reduce((a, r) => a + Number(r.total_price || 0), 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const coworkPaymentsMonth = members.flatMap((m) => m.cowork_payments || []).filter((p) => new Date(p.payment_date) >= monthStart);
    const coworkRevenue = coworkPaymentsMonth.reduce((a, p) => a + Number(p.amount || 0), 0) + daypassesToday.reduce((a, p) => a + Number(p.amount_paid || 0), 0);
    const pendingTasks = tasks.filter((t) => t.approval_status === "pending").length;

    el("dashMetrics").innerHTML = [
      ["Cowork activo", activeMembers.length, "ok"],
      ["Cowork em atraso", overdueMembers.length, overdueMembers.length ? "warn" : "ok"],
      ["Reservas hoje", rows.length, "ok"],
      ["Pagamentos mês", money(coworkRevenue), "ok"],
      ["Actividades pendentes", pendingTasks, pendingTasks ? "warn" : "ok"]
    ].map(([label, value, kind]) => `<div class="metric-card"><span>${label}</span><strong>${html(value)}</strong>${statusBadge(kind === "warn" ? "Atenção" : "Operacional", kind)}</div>`).join("");

    message("todayMeta", `${rows.length} reserva(s) • ${money(reservationRevenue)}`);
    el("todayList").innerHTML = rows.map((r) => `<div class="item"><div><div class="item-title">${html(r.client_name)} ${statusBadge(r.status, r.status === "cancelled" ? "bad" : "ok")}</div><div class="item-meta">${html(resourceName(r.resource_id))} • ${fmt(r.start_at)} → ${fmt(r.end_at)} • ${money(r.total_price)}</div></div></div>`).join("") || '<p class="muted">Sem reservas hoje.</p>';
    message("cwOcc", `${activeMembers.length} activo(s), ${overdueMembers.length} em atraso, ${expiredMembers.length} expirado(s), ${daypassesToday.length} daypass(es) hoje`);
    message("cwRevenue", `Pagamentos de cowork recebidos no mês: ${money(coworkRevenue)}`);

    const weekReservations = await queryReservations(start, weekEnd);
    el("spaceStatusList").innerHTML = buildSpaceStatus(weekReservations).map(({ resource, current, next }) => {
      const free = !current;
      return `<div class="item space-state"><div><div class="item-title">${html(resource.name)} ${statusBadge(free ? "Livre agora" : "Ocupado agora", free ? "ok" : "bad")}</div><div class="item-meta">${current ? `${html(current.client_name)} até ${fmt(current.end_at)}` : "Disponível neste momento"}</div><div class="item-meta">Próxima reserva: ${next ? `${html(next.client_name)} • ${fmt(next.start_at)}` : "sem reserva nos próximos 7 dias"}</div></div></div>`;
    }).join("") || '<p class="muted">Sem espaços operacionais.</p>';
    el("taskDigest").innerHTML = tasks.filter((t) => t.approval_status !== "rejected").slice(0, 4).map((t) => `<div class="item compact"><div><div class="item-title">${html(t.title)} ${t.approval_status === "pending" ? statusBadge("Aguardando aprovação", "warn") : ""}</div><div class="item-meta">${html(t.status)} • ${t.due_date ? fmt(t.due_date) : "sem prazo"}</div></div></div>`).join("") || '<p class="muted">Sem actividades recentes.</p>';
  }

  async function renderReservations() {
    const day = el("resDay").value || ymd(new Date()); el("resDay").value = day;
    const start = new Date(`${day}T00:00:00`); const end = new Date(`${day}T23:59:59`);
    let rows = await queryReservations(start, end);
    const rid = el("resFilterResource").value;
    if (rid && rid !== "all") rows = rows.filter((r) => r.resource_id === rid);
    message("reservasMsg", `${rows.length} reserva(s).`);
    el("reservasList").innerHTML = rows.map((r) => `<div class="item"><div><div class="item-title">${html(r.client_name)}</div><div class="item-meta">${fmt(r.start_at)} → ${fmt(r.end_at)} • ${html(r.status)} • ${money(r.total_price)}</div></div><button class="btn sm" data-edit-res="${r.id}">Abrir</button></div>`).join("") || '<p class="muted">Sem reservas.</p>';
    document.querySelectorAll("[data-edit-res]").forEach((b) => b.onclick = () => openReservation(b.dataset.editRes));
  }

  async function openReservation(id = "") {
    el("reservationId").value = id;
    message("reservationMsg", "—");
    if (!id) {
      el("reservationClient").value = ""; el("reservationStatus").value = "confirmed"; el("reservationPrice").value = 0;
      const day = el("resDay").value || ymd(new Date()); el("reservationStart").value = `${day}T09:00`; el("reservationEnd").value = `${day}T10:00`;
      if (operationalResources()[0]) el("reservationResource").value = operationalResources()[0]?.id || "";
    } else {
      const { data, error } = await supabase.from("reservations").select("*").eq("id", id).single();
      if (error) throw error;
      el("reservationResource").value = data.resource_id; el("reservationClient").value = data.client_name; el("reservationStatus").value = data.status; el("reservationPrice").value = data.total_price;
      const s = new Date(data.start_at); const e = new Date(data.end_at);
      el("reservationStart").value = `${ymd(s)}T${pad2(s.getHours())}:${pad2(s.getMinutes())}`; el("reservationEnd").value = `${ymd(e)}T${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
    }
    openModal("reservationModal");
  }

  async function saveReservation() {
    const id = el("reservationId").value;
    const payload = { company_id: profile.company_id, resource_id: el("reservationResource").value, client_name: el("reservationClient").value.trim(), start_at: new Date(el("reservationStart").value).toISOString(), end_at: new Date(el("reservationEnd").value).toISOString(), status: el("reservationStatus").value, total_price: Number(el("reservationPrice").value || 0) };
    if (!payload.resource_id || !payload.client_name) throw new Error("Preencha recurso e cliente.");
    const result = id ? await supabase.from("reservations").update(payload).eq("id", id) : await supabase.from("reservations").insert(payload);
    if (result.error) throw result.error;
    closeModal("reservationModal"); await renderReservations(); await renderDashboard();
  }

  async function deleteReservation() {
    const id = el("reservationId").value; if (!id) return;
    const { error } = await supabase.from("reservations").delete().eq("id", id);
    if (error) throw error;
    closeModal("reservationModal"); await renderReservations(); await renderDashboard();
  }

  function renderAgenda(rows) {
    const grouped = operationalResources().map((resource) => ({
      resource,
      rows: rows.filter((r) => r.resource_id === resource.id).sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    }));
    el("agendaList").innerHTML = grouped.map(({ resource, rows }) => `<div class="card agenda-card"><div class="topline"><h3>${html(resource.name)}</h3><span class="pill">${rows.length} reserva(s)</span></div>${rows.map((r) => `<div class="item compact"><div><div class="item-title">${html(r.client_name)} ${statusBadge(r.status, r.status === "cancelled" ? "bad" : "ok")}</div><div class="item-meta">${fmt(r.start_at)} → ${fmt(r.end_at)} • ${money(r.total_price)}</div></div></div>`).join("") || '<p class="muted">Sem reservas neste período.</p>'}</div>`).join("");
  }

  async function renderAgendaView() {
    const day = el("agendaDay").value || ymd(new Date()); el("agendaDay").value = day;
    const mode = el("agendaMode").value || "day";
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(start); end.setDate(end.getDate() + (mode === "week" ? 7 : 1));
    renderAgenda(await queryReservations(start, end));
  }

  async function renderCowork() {
    const [{ data: members, error: e1 }, { data: passes, error: e2 }] = await Promise.all([
      queryCoworkMembers(),
      supabase.from("cowork_daypasses").select("*").eq("company_id", profile.company_id).order("date", { ascending: false })
    ]);
    if (e1) throw e1; if (e2) throw e2;
    el("membersList").innerHTML = (members || []).map((m) => `<div class="item"><div><div class="item-title">${html(m.name)} ${statusBadge(memberComputedStatus(m), memberComputedStatus(m) === "overdue" ? "warn" : memberComputedStatus(m) === "active" ? "ok" : "bad")}</div><div class="item-meta">Plano ${html(m.plan)} • pagamento ${html(m.payment_type || "mensal")} • pago ${money(m.amount_paid)} • saldo ${money(memberBalance(m))} • próxima cobrança ${m.next_payment_date || "—"}</div></div><button class="btn sm" data-edit-member="${m.id}">Perfil</button></div>`).join("") || '<p class="muted">Sem membros.</p>';
    document.querySelectorAll("[data-edit-member]").forEach((b) => b.onclick = () => openMember(b.dataset.editMember));
    el("daypassList").innerHTML = (passes || []).map((p) => `<div class="item"><div><div class="item-title">${html(p.client_name)}</div><div class="item-meta">${p.date} • ${money(p.amount_paid)}</div></div></div>`).join("") || '<p class="muted">Sem diárias.</p>';
  }

  async function openMember(id = "") {
    el("memberId").value = id; message("memberMsg", "—");
    if (!id) { ["memberName", "memberStart", "memberEnd", "memberTotal", "memberAmount", "memberNext", "paymentAmount", "paymentReference", "paymentNotes"].forEach((x) => el(x).value = ""); el("memberPlan").value = "monthly"; el("memberPaymentType").value = "monthly"; el("memberStatus").value = "active"; el("memberPaymentsList").innerHTML = '<p class="muted">Guarde o membro para registar pagamentos.</p>'; }
    else { let { data, error } = await supabase.from("cowork_members").select("*, cowork_payments(*)").eq("id", id).single(); if (error && isMissingSchemaError(error)) { schemaSupport.coworkPayments = false; const fallback = await supabase.from("cowork_members").select("*").eq("id", id).single(); data = fallback.data; error = fallback.error; } if (error) throw error; el("memberName").value = data.name; el("memberPlan").value = data.plan; el("memberPaymentType").value = data.payment_type || "monthly"; el("memberStart").value = data.start_date || ""; el("memberEnd").value = data.end_date || ""; el("memberTotal").value = data.total_value || 0; el("memberAmount").value = data.amount_paid; el("memberNext").value = data.next_payment_date || ""; el("memberStatus").value = memberComputedStatus(data); el("memberPaymentsList").innerHTML = (data.cowork_payments || []).sort((a,b) => new Date(b.payment_date) - new Date(a.payment_date)).map((p) => `<div class="item compact"><div><div class="item-title">${money(p.amount)} • ${html(p.payment_method || "—")}</div><div class="item-meta">${p.payment_date} • ${html(p.reference || "sem referência")} • ${html(p.notes || "")}</div></div></div>`).join("") || '<p class="muted">Sem pagamentos registados.</p>'; }
    openModal("memberModal");
  }

  async function saveMember() {
    const id = el("memberId").value;
    const payload = { company_id: profile.company_id, name: el("memberName").value.trim(), plan: el("memberPlan").value, payment_type: el("memberPaymentType").value, start_date: el("memberStart").value || null, end_date: el("memberEnd").value || null, total_value: Number(el("memberTotal").value || 0), amount_paid: Number(el("memberAmount").value || 0), next_payment_date: el("memberNext").value || null, status: el("memberStatus").value };
    if (!payload.name) throw new Error("Nome obrigatório.");
    let result = id ? await supabase.from("cowork_members").update(payload).eq("id", id) : await supabase.from("cowork_members").insert(payload);
    if (result.error && isMissingSchemaError(result.error)) {
      const legacyStatus = { expired: "ended", cancelled: "inactive", pending: "active", overdue: "active" }[payload.status] || payload.status;
      const legacyPayload = { company_id: payload.company_id, name: payload.name, plan: payload.plan, start_date: payload.start_date, end_date: payload.end_date, amount_paid: payload.amount_paid, status: legacyStatus };
      result = id ? await supabase.from("cowork_members").update(legacyPayload).eq("id", id) : await supabase.from("cowork_members").insert(legacyPayload);
    }
    if (result.error) throw result.error;
    closeModal("memberModal"); await renderCowork(); await renderDashboard();
  }

  async function addCoworkPayment() {
    const memberId = el("memberId").value;
    if (!memberId) throw new Error("Abra um membro guardado para registar pagamento.");
    const amount = Number(el("paymentAmount").value || 0);
    if (amount <= 0) throw new Error("Informe o valor pago.");
    const { data: member, error: readError } = await supabase.from("cowork_members").select("amount_paid,total_value").eq("id", memberId).single();
    if (readError) throw readError;
    if (schemaSupport.coworkPayments) {
      const { error } = await supabase.from("cowork_payments").insert({ cowork_member_id: memberId, company_id: profile.company_id, payment_date: ymd(new Date()), amount, payment_method: el("paymentMethod").value, reference: el("paymentReference").value.trim(), notes: el("paymentNotes").value.trim(), created_by: currentUserId() });
      if (error && isMissingSchemaError(error)) schemaSupport.coworkPayments = false;
      else if (error) throw error;
    }
    const { error: updateError } = await supabase.from("cowork_members").update({ amount_paid: Number(member.amount_paid || 0) + amount }).eq("id", memberId);
    if (updateError) throw updateError;
    await openMember(memberId); await renderCowork(); await renderDashboard();
  }

  async function addDaypass() {
    const payload = { company_id: profile.company_id, client_name: el("daypassName").value.trim(), date: el("daypassDate").value || ymd(new Date()), amount_paid: Number(el("daypassAmount").value || 0) };
    if (!payload.client_name) throw new Error("Nome do cliente obrigatório.");
    const { error } = await supabase.from("cowork_daypasses").insert(payload);
    if (error) throw error;
    el("daypassName").value = ""; el("daypassAmount").value = ""; await renderCowork();
  }

  async function fetchTasks(all = false) {
    const { data, error } = await queryTasks({ all });
    if (error) throw error;
    return data || [];
  }

  function taskItem(t) {
    const person = profiles.find((p) => p.user_id === t.responsible_id)?.name || "—";
    const approval = t.approval_status === "pending" ? statusBadge("Aguardando aprovação", "warn") : t.approval_status === "rejected" ? statusBadge("Rejeitada", "bad") : statusBadge("Aprovada", "ok");
    return `<div class="item"><div><div class="item-title">${html(t.title)} ${approval}</div><div class="item-meta">${html(person)} • ${html(t.status)} • ${html(t.priority)} • ${t.due_date ? fmt(t.due_date) : "sem prazo"}</div></div><button class="btn sm" data-edit-task="${t.id}">Abrir</button></div>`;
  }

  async function renderTasks() {
    let rows = await fetchTasks(false);
    const status = el("taskStatusFilter").value;
    if (status !== "all") rows = rows.filter((t) => t.status === status);
    message("tasksMsg", `${rows.length} actividade(s).`);
    el("tasksList").innerHTML = rows.map(taskItem).join("") || '<p class="muted">Sem actividades.</p>';
    document.querySelectorAll("[data-edit-task]").forEach((b) => b.onclick = () => openTask(b.dataset.editTask));
  }

  async function renderTeam() {
    if (!isAdmin()) { message("teamMsg", "Área reservada a administradores."); el("teamList").innerHTML = ""; return; }
    const rows = await fetchTasks(true);
    message("teamMsg", `${rows.length} actividade(s) da empresa.`);
    el("teamList").innerHTML = rows.map(taskItem).join("") || '<p class="muted">Sem actividades.</p>';
  }

  async function openTask(id = "") {
    el("taskId").value = id; message("taskMsg", "—"); fillPeopleSelect();
    if (!id) { ["taskTitle", "taskDescription", "taskDue", "taskNote"].forEach((x) => el(x).value = ""); el("taskPriority").value = "medium"; el("taskStatus").value = "todo"; el("taskResponsible").value = currentUserId(); }
    else { const { data, error } = await supabase.from("tasks").select("*").eq("id", id).single(); if (error) throw error; el("taskTitle").value = data.title; el("taskDescription").value = data.description || ""; el("taskPriority").value = data.priority; el("taskStatus").value = data.status; el("taskResponsible").value = data.responsible_id || ""; el("taskDue").value = data.due_date ? `${ymd(new Date(data.due_date))}T${pad2(new Date(data.due_date).getHours())}:${pad2(new Date(data.due_date).getMinutes())}` : ""; el("taskNote").value = ""; }
    openModal("taskModal");
  }

  async function saveTask() {
    const id = el("taskId").value;
    const payload = { company_id: profile.company_id, title: el("taskTitle").value.trim(), description: el("taskDescription").value.trim(), priority: el("taskPriority").value, due_date: el("taskDue").value ? new Date(el("taskDue").value).toISOString() : null, status: el("taskStatus").value, responsible_id: el("taskResponsible").value || null };
    if (!id) {
      payload.created_by = currentUserId();
      if (schemaSupport.taskApprovals) { payload.approval_status = isAdmin() ? "approved" : "pending"; payload.approved_by = isAdmin() ? currentUserId() : null; payload.approved_at = isAdmin() ? new Date().toISOString() : null; }
    }
    if (!payload.title) throw new Error("Título obrigatório.");
    let result = id ? await supabase.from("tasks").update(payload).eq("id", id).select("id").single() : await supabase.from("tasks").insert(payload).select("id").single();
    if (result.error && isMissingSchemaError(result.error) && ("approval_status" in payload || "approved_by" in payload || "approved_at" in payload)) {
      schemaSupport.taskApprovals = false;
      delete payload.approval_status; delete payload.approved_by; delete payload.approved_at;
      result = id ? await supabase.from("tasks").update(payload).eq("id", id).select("id").single() : await supabase.from("tasks").insert(payload).select("id").single();
    }
    if (result.error) throw result.error;
    const note = el("taskNote").value.trim();
    if (note) { const { error } = await supabase.from("task_updates").insert({ task_id: result.data.id, user_id: currentUserId(), note }); if (error) throw error; }
    closeModal("taskModal"); await renderTasks(); await renderTeam(); await renderDashboard();
  }

  async function requestTaskRemoval() {
    const id = el("taskId").value; if (!id) return;
    const reason = prompt("Motivo do pedido de remoção:"); if (!reason) return;
    const { error } = await supabase.from("task_delete_requests").insert({ task_id: id, requested_by: currentUserId(), reason, status: "pending" });
    if (error) throw error;
    message("taskMsg", "Pedido enviado.");
  }

  async function renderApprovals() {
    if (!isAdmin()) { message("approvalsMsg", "Área reservada a administradores."); return; }
    const pending = profiles.filter((p) => p.status === "pending");
    const { data: pendingTasks, error: taskApprovalError } = await queryTasks({ pendingOnly: true, orderCreatedDesc: true, all: true });
    if (taskApprovalError) throw taskApprovalError;
    const taskApprovalRows = schemaSupport.taskApprovals ? (pendingTasks || []) : [];
    message("approvalsMsg", `${pending.length} utilizador(es) e ${taskApprovalRows.length} actividade(s) pendente(s).${schemaSupport.taskApprovals ? "" : " Execute supabase_migration_v2.sql para activar aprovações de actividades."}`);
    el("approvalsList").innerHTML = pending.map((p) => `<div class="item"><div><div class="item-title">${html(p.name)}</div><div class="item-meta">${p.user_id}</div></div><div class="row"><button class="btn sm primary" data-approve="${p.user_id}">Aprovar</button><button class="btn sm danger" data-reject="${p.user_id}">Rejeitar</button></div></div>`).join("") || '<p class="muted">Sem pendentes.</p>';
    document.querySelectorAll("[data-approve]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("profiles").update({ status: "approved" }).eq("user_id", b.dataset.approve).eq("company_id", profile.company_id); if (error) throw error; await loadBaseData(); await renderApprovals(); });
    document.querySelectorAll("[data-reject]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("profiles").update({ status: "rejected" }).eq("user_id", b.dataset.reject).eq("company_id", profile.company_id); if (error) throw error; await loadBaseData(); await renderApprovals(); });
    el("taskApprovalsList").innerHTML = taskApprovalRows.map((t) => `<div class="item"><div><div class="item-title">${html(t.title)}</div><div class="item-meta">${html(t.description || "Sem descrição")} • ${t.due_date ? fmt(t.due_date) : "sem prazo"}</div></div><div class="row"><button class="btn sm primary" data-approve-task="${t.id}">Aprovar</button><button class="btn sm danger" data-reject-task="${t.id}">Rejeitar</button></div></div>`).join("") || `<p class="muted">${schemaSupport.taskApprovals ? "Sem actividades pendentes." : "Aprovações de actividades ainda não migradas."}</p>`;
    document.querySelectorAll("[data-approve-task]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("tasks").update({ approval_status: "approved", approved_by: currentUserId(), approved_at: new Date().toISOString() }).eq("id", b.dataset.approveTask).eq("company_id", profile.company_id); if (error) throw error; await renderApprovals(); await renderTasks(); await renderDashboard(); });
    document.querySelectorAll("[data-reject-task]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("tasks").update({ approval_status: "rejected", approved_by: currentUserId(), approved_at: new Date().toISOString() }).eq("id", b.dataset.rejectTask).eq("company_id", profile.company_id); if (error) throw error; await renderApprovals(); await renderTasks(); await renderDashboard(); });
    const { data, error } = await supabase.from("task_delete_requests").select("*, tasks(company_id,title)").order("created_at", { ascending: false });
    if (error) throw error;
    const requests = (data || []).filter((r) => r.tasks?.company_id === profile.company_id && r.status === "pending");
    el("deleteReqList").innerHTML = requests.map((r) => `<div class="item"><div><div class="item-title">${html(r.tasks?.title || r.task_id)}</div><div class="item-meta">${html(r.reason)}</div></div><button class="btn sm danger" data-del-task="${r.task_id}" data-request="${r.id}">Aprovar remoção</button></div>`).join("") || '<p class="muted">Sem pedidos.</p>';
    document.querySelectorAll("[data-del-task]").forEach((b) => b.onclick = async () => { await supabase.from("tasks").delete().eq("id", b.dataset.delTask); await supabase.from("task_delete_requests").update({ status: "approved" }).eq("id", b.dataset.request); await renderApprovals(); });
  }

  function reportLine(row) {
    return `<tr><td>${html(row.date)}</td><td>${html(row.client)}</td><td>${html(row.service)}</td><td>${html(row.period)}</td><td>${html(row.status)}</td><td class="num">${money(row.amount)}</td></tr>`;
  }

  async function renderReports() {
    const from = el("repFrom").value || ymd(new Date()); const to = el("repTo").value || from; el("repFrom").value = from; el("repTo").value = to;
    const start = new Date(`${from}T00:00:00`); const end = new Date(`${to}T23:59:59`);
    const { reservations: rows, members, passes, tasks } = await getOperationalData(start, end);
    const categories = new Map([
      ["A. Reservas de Estúdio Verde", []],
      ["B. Reservas de Estúdio Azul", []],
      ["C. Reservas de Sala de Reuniões", []],
      ["D. Reservas de Palco / Espaço para Actividades", []],
      ["E. Cowork — membros", []],
      ["F. Cowork — daypasses", []],
      ["H. Outras receitas", []]
    ]);
    rows.forEach((r) => categories.get(resourceCategoryName(r.resource_id)).push({ date: fmt(r.start_at), client: r.client_name, service: resourceName(r.resource_id), period: `${fmt(r.start_at)} → ${fmt(r.end_at)}`, status: r.status, amount: Number(r.total_price || 0) }));
    members.filter((m) => memberComputedStatus(m) !== "cancelled").forEach((m) => categories.get("E. Cowork — membros").push({ date: m.start_date || "—", client: m.name, service: `Plano ${m.plan} / ${m.payment_type || "mensal"}`, period: `${m.start_date || "—"} → ${m.end_date || "—"}`, status: memberComputedStatus(m), amount: Number(m.amount_paid || 0) }));
    passes.forEach((p) => categories.get("F. Cowork — daypasses").push({ date: p.date, client: p.client_name, service: "Daypass cowork", period: p.date, status: "pago", amount: Number(p.amount_paid || 0) }));
    const allLines = [...categories.values()].flat();
    const total = allLines.reduce((a, r) => a + r.amount, 0);
    const reportNo = `R-${from.replaceAll("-", "")}-${to.replaceAll("-", "")}-${Date.now().toString().slice(-5)}`;
    message("reportsMsg", `${allLines.length} linha(s), total ${money(total)}. Use imprimir para guardar em PDF.`);
    el("reportsList").innerHTML = `
      <div class="row report-actions no-print">
        <button class="btn sm primary" data-print-report>Imprimir / Guardar PDF</button>
        <button class="btn sm" data-csv="general">CSV secundário</button>
      </div>
      <article class="report-document" id="visualReport">
        <header class="report-header"><div><div class="logo report-logo">DC</div><h2>${html(company?.name || "Empresa")}</h2><p>Relatório financeiro tipo recibo/extracto</p></div><div class="report-meta"><strong>N.º ${reportNo}</strong><span>Emitido em ${fmt(new Date())}</span><span>Período: ${from} a ${to}</span></div></header>
        <section class="report-summary grid cols4"><div><span>Total geral</span><strong>${money(total)}</strong></div><div><span>Serviços</span><strong>${allLines.length}</strong></div><div><span>Reservas</span><strong>${rows.length}</strong></div><div><span>Cowork</span><strong>${members.length + passes.length}</strong></div></section>
        ${[...categories.entries()].map(([name, lines]) => { const subtotal = lines.reduce((a, r) => a + r.amount, 0); return `<section class="report-section"><h3>${html(name)} <span>${money(subtotal)}</span></h3><table><thead><tr><th>Data</th><th>Cliente/Membro</th><th>Serviço</th><th>Período/Horário</th><th>Estado</th><th>Valor</th></tr></thead><tbody>${lines.map(reportLine).join("") || '<tr><td colspan="6">Sem movimentos nesta categoria.</td></tr>'}</tbody><tfoot><tr><td colspan="5">Subtotal (${lines.length} serviço(s))</td><td class="num">${money(subtotal)}</td></tr></tfoot></table></section>`; }).join("")}
        <footer class="report-footer"><strong>Total geral: ${money(total)}</strong><p>Observações: relatório gerado automaticamente pelo ControleDC. Confirme pagamentos e estados antes da emissão fiscal definitiva.</p></footer>
      </article>`;
    document.querySelector("[data-print-report]").onclick = () => window.print();
    document.querySelectorAll("[data-csv]").forEach((b) => b.onclick = () => downloadCsv(`relatorio-secundario-${from}-${to}.csv`, [["categoria", "data", "cliente", "servico", "periodo", "estado", "valor"], ...[...categories.entries()].flatMap(([cat, lines]) => lines.map((r) => [cat, r.date, r.client, r.service, r.period, r.status, r.amount]))]));
  }

  async function showScreen(name) {
    if (!session) return showAuth();
    document.querySelectorAll(".screen").forEach((s) => s.hidden = s.id !== `scr-${name}`);
    document.querySelectorAll(".m-item").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
    if (name === "dash") await renderDashboard();
    if (name === "reservas") await renderReservations();
    if (name === "cowork") await renderCowork();
    if (name === "agenda") await renderAgendaView();
    if (name === "tasks") await renderTasks();
    if (name === "team") await renderTeam();
    if (name === "approvals") await renderApprovals();
    if (name === "reports") await renderReports();
  }

  function closeMobileMenu() {
    const sidebar = document.querySelector(".sidebar");
    const button = el("btnMobileMenu");
    sidebar?.classList.remove("menu-open");
    button?.setAttribute("aria-expanded", "false");
  }

  function toggleMobileMenu() {
    const sidebar = document.querySelector(".sidebar");
    const button = el("btnMobileMenu");
    const isOpen = sidebar?.classList.toggle("menu-open") || false;
    button?.setAttribute("aria-expanded", String(isOpen));
  }

  function bind() {
    el("btnLogin").onclick = async () => { try { message("authMsg", "A entrar..."); await login(); await loadBaseData(); hideAuth(); await showScreen("dash"); } catch (e) { showAuth(e.message || String(e)); } };
    el("btnSignup").onclick = async () => { try { message("authMsg", "A criar conta..."); await signup(); } catch (e) { showAuth(e.message || String(e)); } };
    el("btnLogout").onclick = logout;
    el("btnMobileMenu").onclick = toggleMobileMenu;
    document.querySelectorAll(".m-item").forEach((b) => b.onclick = async () => { closeMobileMenu(); await showScreen(b.dataset.go); });
    el("btnOpenReservation").onclick = () => openReservation(); el("btnCloseReservation").onclick = () => closeModal("reservationModal"); el("btnSaveReservation").onclick = () => saveReservation().catch((e) => message("reservationMsg", e.message)); el("btnDeleteReservation").onclick = () => deleteReservation().catch((e) => message("reservationMsg", e.message));
    el("resDay").onchange = renderReservations; el("resFilterResource").onchange = renderReservations;
    el("btnAddMember").onclick = () => openMember(); el("btnAddPayment").onclick = () => addCoworkPayment().catch((e) => message("memberMsg", e.message)); el("btnCloseMember").onclick = () => closeModal("memberModal"); el("btnSaveMember").onclick = () => saveMember().catch((e) => message("memberMsg", e.message)); el("btnAddDaypass").onclick = () => addDaypass().catch((e) => message("coworkMsg", e.message));
    el("btnCreateTask").onclick = () => openTask(); el("btnCloseTask").onclick = () => closeModal("taskModal"); el("btnSaveTask").onclick = () => saveTask().catch((e) => message("taskMsg", e.message)); el("btnDeleteTask").onclick = () => requestTaskRemoval().catch((e) => message("taskMsg", e.message)); el("taskStatusFilter").onchange = renderTasks;
    el("agendaDay").onchange = renderAgendaView; el("agendaMode").onchange = renderAgendaView;
    el("btnRunReports").onclick = renderReports;
  }

  async function init() {
    bind();
    if (el("resDay")) el("resDay").value = ymd(new Date());
    if (el("daypassDate")) el("daypassDate").value = ymd(new Date());
    if (el("agendaDay")) el("agendaDay").value = ymd(new Date());
    try {
      await loadSession();
      if (!session) return showAuth();
      await loadProfile();
      if (!profile?.company_id) return showAuth("Perfil não encontrado. Contacte o administrador.");
      if (profile.status !== "approved") return showAuth("Conta pendente de aprovação.");
      await loadBaseData();
      hideAuth();
      await showScreen("dash");
      setInterval(() => { if (!el("scr-dash")?.hidden) renderDashboard(); if (!el("scr-agenda")?.hidden) renderAgendaView(); }, 30000);
    } catch (e) { showAuth(e.message || String(e)); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
