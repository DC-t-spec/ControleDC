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

  const el = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmt = (v) => new Date(v).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
  const money = (v) => `${Number(v || 0).toLocaleString("pt-PT")} MT`;
  const html = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const isAdmin = () => profile?.role === "admin";
  const currentUserId = () => session?.user?.id || null;

  function message(id, text) { const node = el(id); if (node) node.textContent = text; }
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

  async function saveSignupProfile(userId, foundCompany, email) {
    if (!userId) throw new Error("Não foi possível obter o ID do utilizador criado pelo Supabase Auth.");
    const name = email.split("@")[0] || "utilizador";
    const payload = {
      user_id: userId,
      company_id: foundCompany.id,
      name,
      role: "user",
      status: "pending"
    };

    const { data: existingProfile, error: readError } = await supabase.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
    if (readError) throw readError;

    if (existingProfile) {
      const { error: updateError } = await supabase.from("profiles").update({
        company_id: foundCompany.id,
        name,
        role: "user",
        status: "pending"
      }).eq("user_id", userId);
      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await supabase.from("profiles").insert(payload);
    if (insertError) throw insertError;
  }

  async function signup() {
    const email = el("authEmail").value.trim().toLowerCase();
    const password = el("authPass").value;
    const code = el("authCode").value.trim().toUpperCase();
    if (!email || !password || !code) throw new Error("Preencha email, senha e código da empresa.");

    const { data: foundCompany, error: companyError } = await supabase.from("companies").select("id,name,code").eq("code", code).maybeSingle();
    if (companyError) throw companyError;
    if (!foundCompany) throw new Error("Código da empresa inválido.");

    const name = email.split("@")[0] || "utilizador";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          company_id: foundCompany.id,
          company_code: foundCompany.code,
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
      await saveSignupProfile(user.id, foundCompany, email);
      await supabase.auth.signOut();
      session = null;
    }

    throw new Error("Conta criada. Aguarde aprovação do administrador.");
  }

  async function login() {
    const email = el("authEmail").value.trim().toLowerCase();
    const password = el("authPass").value;
    const code = el("authCode").value.trim().toUpperCase();
    if (!email || !password || !code) throw new Error("Preencha email, senha e código da empresa.");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Email ou senha inválidos.");
    session = data.session;

    const loaded = await loadProfile();
    if (!loaded?.company_id) throw new Error("Perfil não encontrado para este utilizador. Contacte o administrador.");
    if (loaded.status !== "approved") throw new Error("Conta pendente de aprovação.");
    if (company?.code !== code) throw new Error("Código da empresa não corresponde ao seu perfil.");
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

  function fillResourceSelects() {
    ["resFilterResource", "reservationResource"].forEach((id) => {
      const node = el(id); if (!node) return;
      node.innerHTML = id === "resFilterResource" ? '<option value="all">Todos</option>' : "";
      resources.filter((r) => r.type !== "cowork").forEach((r) => node.insertAdjacentHTML("beforeend", `<option value="${r.id}">${html(r.name)}</option>`));
    });
  }

  function fillPeopleSelect() {
    const node = el("taskResponsible"); if (!node) return;
    node.innerHTML = "";
    profiles.filter((p) => p.status === "approved").forEach((p) => node.insertAdjacentHTML("beforeend", `<option value="${p.user_id}">${html(p.name)}</option>`));
    if (currentUserId()) node.value = currentUserId();
  }

  async function queryReservations(from, to) {
    const { data, error } = await supabase.from("reservations").select("*").eq("company_id", profile.company_id).gte("start_at", from.toISOString()).lte("start_at", to.toISOString()).order("start_at");
    if (error) throw error;
    return data || [];
  }

  async function renderDashboard() {
    message("nowLabel", `Agora: ${fmt(new Date())}`);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const rows = await queryReservations(start, end);
    message("todayMeta", `${rows.length} reserva(s)`);
    el("todayList").innerHTML = rows.map((r) => `<div class="item"><div><div class="item-title">${html(r.client_name)}</div><div class="item-meta">${fmt(r.start_at)} → ${fmt(r.end_at)} • ${money(r.total_price)}</div></div></div>`).join("") || '<p class="muted">Sem reservas hoje.</p>';
    const { data: members } = await supabase.from("cowork_members").select("amount_paid,status").eq("company_id", profile.company_id);
    const activeMembers = (members || []).filter((m) => m.status === "active");
    message("cwOcc", `${activeMembers.length} mensalista(s) ativo(s)`);
    message("cwRevenue", `Receita mensal registada: ${money(activeMembers.reduce((a, m) => a + Number(m.amount_paid || 0), 0))}`);
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
      if (resources[0]) el("reservationResource").value = resources.filter((r) => r.type !== "cowork")[0]?.id || "";
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

  async function renderCowork() {
    const [{ data: members, error: e1 }, { data: passes, error: e2 }] = await Promise.all([
      supabase.from("cowork_members").select("*").eq("company_id", profile.company_id).order("name"),
      supabase.from("cowork_daypasses").select("*").eq("company_id", profile.company_id).order("date", { ascending: false })
    ]);
    if (e1) throw e1; if (e2) throw e2;
    el("membersList").innerHTML = (members || []).map((m) => `<div class="item"><div><div class="item-title">${html(m.name)}</div><div class="item-meta">${html(m.plan)} • ${html(m.status)} • ${money(m.amount_paid)}</div></div><button class="btn sm" data-edit-member="${m.id}">Editar</button></div>`).join("") || '<p class="muted">Sem mensalistas.</p>';
    document.querySelectorAll("[data-edit-member]").forEach((b) => b.onclick = () => openMember(b.dataset.editMember));
    el("daypassList").innerHTML = (passes || []).map((p) => `<div class="item"><div><div class="item-title">${html(p.client_name)}</div><div class="item-meta">${p.date} • ${money(p.amount_paid)}</div></div></div>`).join("") || '<p class="muted">Sem diárias.</p>';
  }

  async function openMember(id = "") {
    el("memberId").value = id; message("memberMsg", "—");
    if (!id) { ["memberName", "memberPlan", "memberStart", "memberEnd", "memberAmount"].forEach((x) => el(x).value = ""); el("memberStatus").value = "active"; }
    else { const { data, error } = await supabase.from("cowork_members").select("*").eq("id", id).single(); if (error) throw error; el("memberName").value = data.name; el("memberPlan").value = data.plan; el("memberStart").value = data.start_date || ""; el("memberEnd").value = data.end_date || ""; el("memberAmount").value = data.amount_paid; el("memberStatus").value = data.status; }
    openModal("memberModal");
  }

  async function saveMember() {
    const id = el("memberId").value;
    const payload = { company_id: profile.company_id, name: el("memberName").value.trim(), plan: el("memberPlan").value.trim() || "monthly", start_date: el("memberStart").value || null, end_date: el("memberEnd").value || null, amount_paid: Number(el("memberAmount").value || 0), status: el("memberStatus").value };
    if (!payload.name) throw new Error("Nome obrigatório.");
    const result = id ? await supabase.from("cowork_members").update(payload).eq("id", id) : await supabase.from("cowork_members").insert(payload);
    if (result.error) throw result.error;
    closeModal("memberModal"); await renderCowork(); await renderDashboard();
  }

  async function addDaypass() {
    const payload = { company_id: profile.company_id, client_name: el("daypassName").value.trim(), date: el("daypassDate").value || ymd(new Date()), amount_paid: Number(el("daypassAmount").value || 0) };
    if (!payload.client_name) throw new Error("Nome do cliente obrigatório.");
    const { error } = await supabase.from("cowork_daypasses").insert(payload);
    if (error) throw error;
    el("daypassName").value = ""; el("daypassAmount").value = ""; await renderCowork();
  }

  async function fetchTasks(all = false) {
    let q = supabase.from("tasks").select("*").eq("company_id", profile.company_id).order("due_date");
    if (!all && !isAdmin()) q = q.or(`responsible_id.eq.${currentUserId()},created_by.eq.${currentUserId()}`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  function taskItem(t) {
    const person = profiles.find((p) => p.user_id === t.responsible_id)?.name || "—";
    return `<div class="item"><div><div class="item-title">${html(t.title)}</div><div class="item-meta">${html(person)} • ${html(t.status)} • ${html(t.priority)} • ${t.due_date ? fmt(t.due_date) : "sem prazo"}</div></div><button class="btn sm" data-edit-task="${t.id}">Abrir</button></div>`;
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
    const payload = { company_id: profile.company_id, title: el("taskTitle").value.trim(), description: el("taskDescription").value.trim(), priority: el("taskPriority").value, due_date: el("taskDue").value ? new Date(el("taskDue").value).toISOString() : null, status: el("taskStatus").value, responsible_id: el("taskResponsible").value || null, created_by: currentUserId() };
    if (!payload.title) throw new Error("Título obrigatório.");
    const result = id ? await supabase.from("tasks").update(payload).eq("id", id).select("id").single() : await supabase.from("tasks").insert(payload).select("id").single();
    if (result.error) throw result.error;
    const note = el("taskNote").value.trim();
    if (note) { const { error } = await supabase.from("task_updates").insert({ task_id: result.data.id, user_id: currentUserId(), note }); if (error) throw error; }
    closeModal("taskModal"); await renderTasks(); await renderTeam();
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
    message("approvalsMsg", `${pending.length} utilizador(es) pendente(s).`);
    el("approvalsList").innerHTML = pending.map((p) => `<div class="item"><div><div class="item-title">${html(p.name)}</div><div class="item-meta">${p.user_id}</div></div><div class="row"><button class="btn sm primary" data-approve="${p.user_id}">Aprovar</button><button class="btn sm danger" data-reject="${p.user_id}">Rejeitar</button></div></div>`).join("") || '<p class="muted">Sem pendentes.</p>';
    document.querySelectorAll("[data-approve]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("profiles").update({ status: "approved" }).eq("user_id", b.dataset.approve).eq("company_id", profile.company_id); if (error) throw error; await loadBaseData(); await renderApprovals(); });
    document.querySelectorAll("[data-reject]").forEach((b) => b.onclick = async () => { const { error } = await supabase.from("profiles").update({ status: "rejected" }).eq("user_id", b.dataset.reject).eq("company_id", profile.company_id); if (error) throw error; await loadBaseData(); await renderApprovals(); });
    const { data, error } = await supabase.from("task_delete_requests").select("*, tasks(company_id,title)").order("created_at", { ascending: false });
    if (error) throw error;
    const requests = (data || []).filter((r) => r.tasks?.company_id === profile.company_id && r.status === "pending");
    el("deleteReqList").innerHTML = requests.map((r) => `<div class="item"><div><div class="item-title">${html(r.tasks?.title || r.task_id)}</div><div class="item-meta">${html(r.reason)}</div></div><button class="btn sm danger" data-del-task="${r.task_id}" data-request="${r.id}">Aprovar remoção</button></div>`).join("") || '<p class="muted">Sem pedidos.</p>';
    document.querySelectorAll("[data-del-task]").forEach((b) => b.onclick = async () => { await supabase.from("tasks").delete().eq("id", b.dataset.delTask); await supabase.from("task_delete_requests").update({ status: "approved" }).eq("id", b.dataset.request); await renderApprovals(); });
  }

  async function renderReports() {
    const from = el("repFrom").value || ymd(new Date()); const to = el("repTo").value || from; el("repFrom").value = from; el("repTo").value = to;
    const rows = await queryReservations(new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`));
    const total = rows.reduce((a, r) => a + Number(r.total_price || 0), 0);
    message("reportsMsg", `${rows.length} reserva(s), total ${money(total)}.`);
    el("reportsList").innerHTML = rows.map((r) => `<div class="item"><div><div class="item-title">${html(r.client_name)}</div><div class="item-meta">${fmt(r.start_at)} • ${money(r.total_price)}</div></div></div>`).join("");
  }

  async function showScreen(name) {
    if (!session) return showAuth();
    document.querySelectorAll(".screen").forEach((s) => s.hidden = s.id !== `scr-${name}`);
    document.querySelectorAll(".m-item").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
    if (name === "dash") await renderDashboard();
    if (name === "reservas") await renderReservations();
    if (name === "cowork") await renderCowork();
    if (name === "tasks") await renderTasks();
    if (name === "team") await renderTeam();
    if (name === "approvals") await renderApprovals();
    if (name === "reports") await renderReports();
  }

  function bind() {
    el("btnLogin").onclick = async () => { try { message("authMsg", "A entrar..."); await login(); await loadBaseData(); hideAuth(); await showScreen("dash"); } catch (e) { showAuth(e.message || String(e)); } };
    el("btnSignup").onclick = async () => { try { message("authMsg", "A criar conta..."); await signup(); } catch (e) { showAuth(e.message || String(e)); } };
    el("btnLogout").onclick = logout;
    document.querySelectorAll(".m-item").forEach((b) => b.onclick = () => showScreen(b.dataset.go));
    el("btnOpenReservation").onclick = () => openReservation(); el("btnCloseReservation").onclick = () => closeModal("reservationModal"); el("btnSaveReservation").onclick = () => saveReservation().catch((e) => message("reservationMsg", e.message)); el("btnDeleteReservation").onclick = () => deleteReservation().catch((e) => message("reservationMsg", e.message));
    el("resDay").onchange = renderReservations; el("resFilterResource").onchange = renderReservations;
    el("btnAddMember").onclick = () => openMember(); el("btnCloseMember").onclick = () => closeModal("memberModal"); el("btnSaveMember").onclick = () => saveMember().catch((e) => message("memberMsg", e.message)); el("btnAddDaypass").onclick = () => addDaypass().catch((e) => message("coworkMsg", e.message));
    el("btnCreateTask").onclick = () => openTask(); el("btnCloseTask").onclick = () => closeModal("taskModal"); el("btnSaveTask").onclick = () => saveTask().catch((e) => message("taskMsg", e.message)); el("btnDeleteTask").onclick = () => requestTaskRemoval().catch((e) => message("taskMsg", e.message)); el("taskStatusFilter").onchange = renderTasks;
    el("btnRunReports").onclick = renderReports;
  }

  async function init() {
    bind();
    if (el("resDay")) el("resDay").value = ymd(new Date());
    if (el("daypassDate")) el("daypassDate").value = ymd(new Date());
    try {
      await loadSession();
      if (!session) return showAuth();
      await loadProfile();
      if (!profile?.company_id) return showAuth("Perfil não encontrado para este utilizador.");
      if (profile.status !== "approved") return showAuth("Conta pendente de aprovação.");
      await loadBaseData();
      hideAuth();
      await showScreen("dash");
      setInterval(() => { if (!el("scr-dash")?.hidden) renderDashboard(); }, 30000);
    } catch (e) { showAuth(e.message || String(e)); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
