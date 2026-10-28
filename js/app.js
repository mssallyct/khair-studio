import { KhairApi } from "./api.js";
import { APPOINTMENT_LABELS, calculateSale, formatDateTime, formatMoney, generateTimeSlots } from "./rules.js";
import { downloadAdminWorkbook } from "./excel-export.js";

const api = new KhairApi(window.KHAIR_CONFIG || {});
const root = document.querySelector("#app");
const toastEl = document.querySelector("#toast");

const state = {
  session: null,
  profile: null,
  data: null,
  view: "dashboard",
  loading: false,
  modal: null,
  saleItems: []
};

boot();

async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => null);
  state.session = await api.getSession();
  if (state.session) {
    state.profile = await api.getProfile();
    if (!state.profile || state.profile.role !== "admin") {
      await api.signOut();
      state.session = null;
      state.profile = null;
    }
  }
  await refresh();
}

async function refresh() {
  if (!state.profile) { state.data = null; render(); return; }
  state.loading = true; render();
  try {
    state.data = state.profile.role === "admin" ? await api.getAdminDashboard() : await api.getMemberDashboard(state.profile.id);
  } catch (error) { toast(error.message, true); }
  state.loading = false; render();
}

function render() {
  root.innerHTML = state.profile ? renderApp() : renderAuth();
  bindForms();
}

function renderAuth() {
  return `
    <main class="auth-shell">
      <section class="brand-panel">
        <div class="brand-lockup"><img class="brand-mark" src="assets/icon.svg" alt=""><span class="brand-name">K.Hair Studio</span></div>
        <div class="brand-copy">
          <p class="eyebrow">Member · Booking · Rewards</p>
          <h1>Your hair,<br>your moment.</h1>
          <p>預約、消費及電子印花，一個 App 輕鬆管理。星期一至日 11:00–21:00。</p>
        </div>
        <div class="brand-notes"><span>每滿 HK$600 · 1印花</span><span>4印花 · 全單9折</span><span>8印花 · 全單85折</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <p class="eyebrow">K.Hair Studio · Hong Kong</p>
          <h2>管理員登入</h2>
          <p class="muted">只供獲授權的 K.Hair Studio 管理員使用。會員由管理員在系統內新增，不設自行註冊。</p>
          ${loginForm()}
          ${api.demoMode ? `<div class="demo-note"><strong>私人測試模式</strong><br>管理員：mssallyct@gmail.com<br>密碼可輸入任何內容</div>` : ""}
        </div>
      </section>
    </main>`;
}

function loginForm() {
  return `<form id="login-form">
    <label class="field"><span>電郵</span><input name="email" type="email" autocomplete="email" required value="${api.demoMode ? "mssallyct@gmail.com" : ""}"></label>
    <label class="field"><span>密碼</span><input name="password" type="password" autocomplete="current-password" required minlength="6" value="${api.demoMode ? "demo123" : ""}"></label>
    <button class="button primary full" type="submit">登入 K.Hair Studio</button>
  </form>`;
}

function renderApp() {
  const admin = state.profile.role === "admin";
  const nav = admin ? [
    ["dashboard", "◫", "營運總覽"], ["appointments", "◷", "預約管理"], ["members", "◎", "會員管理"], ["sales", "$", "消費及印花"], ["settings", "⚙", "服務設定"]
  ] : [
    ["dashboard", "⌂", "會員首頁"], ["book", "+", "立即預約"], ["appointments", "◷", "我的預約"], ["rewards", "✦", "電子印花"], ["profile", "◎", "會員資料"]
  ];
  return `<div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand-lockup"><img class="brand-mark" src="assets/icon.svg" alt=""><span class="brand-name">K.Hair</span></div>
      <nav class="nav-list">${nav.map(([id, icon, label]) => `<button class="nav-item ${state.view === id ? "active" : ""}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}</nav>
      <div class="sidebar-user"><strong>${esc(state.profile.name)}</strong><span>${esc(state.profile.email)}</span><button data-action="logout">登出</button></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><p class="eyebrow">${admin ? "K.Hair Admin" : "K.Hair Member"}</p><h1>${viewTitle()}</h1><p class="muted">${todayText()}</p></div>
        <div class="topbar-actions"><button class="icon-button mobile-menu" data-action="toggle-menu">☰</button><button class="button ghost" data-action="export-data"><span>匯出 Excel</span>↓</button><button class="button ghost" data-action="refresh"><span>同步資料</span>↻</button></div>
      </header>
      ${state.loading ? `<div class="card"><p class="muted">正在載入資料…</p></div>` : admin ? renderAdminView() : renderMemberView()}
    </main>
    ${state.modal ? renderModal() : ""}
  </div>`;
}

function viewTitle() {
  const map = { dashboard: "今日狀況", book: "預約服務", appointments: state.profile.role === "admin" ? "預約管理" : "我的預約", rewards: "電子印花", profile: "會員資料", members: "會員管理", sales: "消費及印花", settings: "服務設定" };
  return map[state.view] || "K.Hair Studio";
}

function renderMemberView() {
  if (state.view === "book") return renderBooking();
  if (state.view === "appointments") return renderMemberAppointments();
  if (state.view === "rewards") return renderRewards();
  if (state.view === "profile") return renderProfile();
  return renderMemberDashboard();
}

function renderMemberDashboard() {
  const upcoming = (state.data.appointments || []).filter(item => ["pending", "confirmed"].includes(item.status) && new Date(item.start_at) >= new Date()).sort((a,b) => new Date(a.start_at)-new Date(b.start_at));
  const next = upcoming[0];
  return `<div class="grid">
    <section class="hero-card card">
      <p class="eyebrow">Hello, ${esc(state.profile.name)}</p>
      <h2>${next ? `下一次靚髮時刻<br>${formatDateTime(next.start_at)}` : "準備好轉換<br>全新造型？"}</h2>
      <p>${next ? `${serviceName(next.service_id)} · ${stylistName(next.stylist_id)} · ${APPOINTMENT_LABELS[next.status]}` : "選擇喜愛服務及髮型師，30秒完成預約。"}</p>
      <button class="button gold" data-view="book">${next ? "再預約" : "立即預約"}</button>
    </section>
    ${stampCard()}
    <div class="grid cols-2">
      <section class="card"><div class="card-head"><h3>近期預約</h3><button class="text-button" data-view="appointments">查看全部</button></div>${appointmentList(upcoming.slice(0,3), false)}</section>
      <section class="card"><div class="card-head"><h3>最近消費</h3><span class="muted small">按實收金額計印花</span></div>${saleList((state.data.sales || []).slice(0,3))}</section>
    </div>
  </div>`;
}

function stampCard() {
  const balance = Number(state.data.balance || 0);
  const display = Math.min(balance, 8);
  const nextTier = balance < 4 ? 4 : 8;
  const remaining = Math.max(0, nextTier - balance);
  return `<section class="card stamp-card">
    <div class="card-head"><div><p class="eyebrow">Stamp Wallet</p><h2>${balance} 個電子印花</h2></div><strong>${balance >= 8 ? "可享85折" : balance >= 4 ? "可享9折" : `尚欠${remaining}個`}</strong></div>
    <div class="stamp-row">${Array.from({length:8}, (_,i) => `<div class="stamp ${i < display ? "filled" : ""}">${i < display ? "K" : i+1}</div>`).join("")}</div>
    <div class="progress-track"><div class="progress-bar" style="width:${Math.min(100, balance / nextTier * 100)}%"></div></div>
    <p class="muted small">4個印花可換全單9折；8個可換85折。新印花下次消費先可使用。</p>
  </section>`;
}

function renderBooking() {
  const services = state.data.catalog.filter(item => item.kind === "service");
  const first = services[0];
  return `<section class="card">
    <div class="card-head"><div><p class="eyebrow">New Appointment</p><h2>選擇預約資料</h2></div><span class="badge pending">預約後待確認</span></div>
    <form id="booking-form" class="form-grid">
      <label class="field"><span>服務</span><select name="serviceId" id="booking-service" required>${services.map(item => `<option value="${item.id}" data-duration="${item.duration_minutes}">${esc(item.name)} · ${formatMoney(item.price)} · ${item.duration_minutes}分鐘</option>`).join("")}</select></label>
      <label class="field"><span>髮型師</span><select name="stylistId" required>${state.data.stylists.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field"><span>日期</span><input name="date" type="date" required min="${localDate(new Date())}"></label>
      <label class="field"><span>開始時間</span><select name="time" id="booking-time" required>${generateTimeSlots(first?.duration_minutes).map(time => `<option>${time}</option>`).join("")}</select></label>
      <label class="field span-2"><span>備註（選填）</span><textarea name="note" placeholder="例如想修薄少少、對染髮劑敏感等"></textarea></label>
      <div class="span-2"><button class="button primary" type="submit">提交預約</button></div>
    </form>
  </section>`;
}

function renderMemberAppointments() {
  return `<section class="card"><div class="card-head"><h2>全部預約</h2><button class="button small" data-view="book">＋ 新預約</button></div>${appointmentList(state.data.appointments || [], true)}</section>`;
}

function renderRewards() {
  return `<div class="grid">${stampCard()}<section class="card"><div class="card-head"><h2>印花明細</h2><span class="muted small">所有變動均可追查</span></div>${stampLedgerList(state.data.stamps || [])}</section></div>`;
}

function renderProfile() {
  return `<div class="grid cols-2"><section class="card"><p class="eyebrow">Member Profile</p><h2>${esc(state.profile.name)}</h2><div class="list">
    ${profileRow("電郵", state.profile.email)}${profileRow("電話", state.profile.phone || "—")}${profileRow("生日", state.profile.birthday || "—")}${profileRow("介紹編號", state.profile.referral_code || "—")}
  </div></section><section class="card"><h2>會員優惠</h2><div class="list">${profileRow("髮型產品", "會員95折")}${profileRow("生日月份", "消費額外1印花")}${profileRow("介紹朋友", "朋友首次消費後獲1印花")}</div></section></div>`;
}

function renderAdminView() {
  if (state.view === "appointments") return renderAdminAppointments();
  if (state.view === "members") return renderMembers();
  if (state.view === "sales") return renderSales();
  if (state.view === "settings") return renderSettings();
  return renderAdminDashboard();
}

function renderAdminDashboard() {
  const today = localDate(new Date());
  const todayAppointments = state.data.appointments.filter(item => localDate(new Date(item.start_at)) === today);
  const pending = state.data.appointments.filter(item => item.status === "pending");
  const revenue = state.data.sales.filter(item => localDate(new Date(item.completed_at)) === today).reduce((sum,item) => sum + Number(item.final_amount), 0);
  const members = state.data.profiles.filter(item => item.role === "member");
  return `<div class="grid">
    <div class="grid cols-4">
      ${statCard("今日預約", todayAppointments.length, `${pending.length} 個待確認`)}
      ${statCard("今日營業額", formatMoney(revenue), "按已完成消費")}
      ${statCard("會員人數", members.length, "有效會員帳戶")}
      ${statCard("本月消費", state.data.sales.filter(item => new Date(item.completed_at).getMonth() === new Date().getMonth()).length, "完成交易宗數")}
    </div>
    <div class="grid cols-2">
      <section class="card"><div class="card-head"><h2>待確認預約</h2><button class="text-button" data-view="appointments">管理全部</button></div>${adminAppointmentList(pending.slice(0,5))}</section>
      <section class="card"><div class="card-head"><h2>今日行程</h2><span class="muted small">11:00–21:00</span></div>${adminAppointmentList(todayAppointments.sort((a,b)=>new Date(a.start_at)-new Date(b.start_at)))}</section>
    </div>
  </div>`;
}

function renderAdminAppointments() {
  return `<section class="card"><div class="card-head"><h2>預約清單</h2><div class="actions"><div class="segmented"><button class="active">全部</button></div><button class="button small" data-action="new-appointment">＋ 新增預約</button></div></div>${adminAppointmentTable(state.data.appointments)}</section>`;
}

function renderMembers() {
  const members = state.data.profiles.filter(item => item.role === "member");
  return `<section class="card"><div class="card-head"><h2>會員名單</h2><div class="actions"><span class="muted">${members.length} 位會員</span><button class="button small" data-action="new-member">＋ 新增會員</button></div></div>
    <div class="filter-bar"><input id="member-search" placeholder="搜尋姓名、電話或電郵"></div>
    <div class="table-wrap"><table><thead><tr><th>會員</th><th>電話</th><th>生日</th><th>印花</th><th>介紹編號</th><th>操作</th></tr></thead><tbody id="member-table-body">${members.map(memberRow).join("")}</tbody></table></div>
  </section>`;
}

function renderSales() {
  return `<div class="grid cols-2">
    <section class="card"><div class="card-head"><h2>完成消費</h2><button class="button small" data-action="new-sale">＋ 新增消費</button></div>${saleList(state.data.sales.slice(0,10), true)}</section>
    <section class="card"><div class="card-head"><h2>最近印花變動</h2><button class="button ghost small" data-action="adjust-stamps">調整印花</button></div>${stampLedgerList(state.data.stamps.slice(0,12), true)}</section>
  </div>`;
}

function renderSettings() {
  return `<div class="grid cols-2"><section class="card"><div class="card-head"><h2>服務及產品</h2><button class="button small" data-action="new-catalog-item">＋ 新增項目</button></div><div class="list">${state.data.catalog.map(item => `<div class="list-item"><div class="list-item-main"><strong>${esc(item.name)}</strong><span>${item.kind === "product" ? "髮型產品" : `${item.duration_minutes}分鐘`}</span></div><strong>${formatMoney(item.price)}</strong></div>`).join("")}</div></section>
  <section class="card"><div class="card-head"><h2>髮型師</h2><span class="muted small">星期一至日</span></div><div class="list">${state.data.stylists.map(item => `<div class="list-item"><div class="list-item-main"><strong>${esc(item.name)}</strong><span>11:00–21:00</span></div><span class="badge active">服務中</span></div>`).join("")}</div></section></div>`;
}

function renderModal() {
  if (state.modal.type === "member") return memberModal();
  if (state.modal.type === "appointment") return appointmentModal();
  if (state.modal.type === "catalog") return catalogModal();
  if (state.modal.type === "sale") return saleModal();
  if (state.modal.type === "stamps") return stampModal();
  return "";
}

function appointmentModal() {
  const members = state.data.profiles.filter(item => item.role === "member");
  const services = state.data.catalog.filter(item => item.kind === "service");
  const firstService = services[0];
  return `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><div><p class="eyebrow">Admin Appointment</p><h2>新增預約</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="appointment-form" class="form-grid">
      <label class="field span-2"><span>會員</span><select name="memberId" required>${members.map(item => `<option value="${item.id}">${esc(item.name)} · ${esc(item.phone || "")}</option>`).join("")}</select></label>
      <label class="field"><span>服務</span><select name="serviceId" id="appointment-service" required>${services.map(item => `<option value="${item.id}" data-duration="${item.duration_minutes}">${esc(item.name)} · ${formatMoney(item.price)}</option>`).join("")}</select></label>
      <label class="field"><span>髮型師</span><select name="stylistId" required>${state.data.stylists.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field"><span>日期</span><input name="date" type="date" required min="${localDate(new Date())}"></label>
      <label class="field"><span>開始時間</span><select name="time" id="appointment-time" required>${generateTimeSlots(firstService?.duration_minutes).map(time => `<option>${time}</option>`).join("")}</select></label>
      <label class="field"><span>狀態</span><select name="status"><option value="confirmed">已確認</option><option value="pending">待確認</option></select></label>
      <label class="field span-2"><span>備註（選填）</span><textarea name="note" placeholder="例如：客人要求、敏感事項"></textarea></label>
      <button class="button primary full span-2" type="submit" ${members.length && services.length ? "" : "disabled"}>建立預約</button>
    </form>
  </section></div>`;
}

function catalogModal() {
  return `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><div><p class="eyebrow">Service & Product</p><h2>新增項目</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="catalog-form" class="form-grid">
      <label class="field"><span>類型</span><select name="kind" id="catalog-kind"><option value="service">服務</option><option value="product">產品</option></select></label>
      <label class="field"><span>名稱</span><input name="name" required maxlength="80" placeholder="例如：挑染"></label>
      <label class="field"><span>價格（HK$）</span><input name="price" type="number" min="0" step="1" required placeholder="0"></label>
      <label class="field"><span>所需時間</span><select name="durationMinutes" id="catalog-duration"><option value="30">30分鐘</option><option value="60" selected>60分鐘</option><option value="90">90分鐘</option><option value="120">120分鐘</option><option value="150">150分鐘</option><option value="180">180分鐘</option></select></label>
      <button class="button primary full span-2" type="submit">新增至項目清單</button>
    </form>
  </section></div>`;
}

function memberModal() {
  const members = state.data.profiles.filter(item => item.role === "member");
  return `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><div><p class="eyebrow">Hong Kong Member</p><h2>新增會員</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="member-form" class="form-grid">
      <label class="field span-2"><span>會員姓名</span><input name="name" required maxlength="80" autocomplete="off"></label>
      <label class="field"><span>香港電話</span><input name="phone" type="tel" inputmode="numeric" required maxlength="13" placeholder="9123 4567" autocomplete="off"></label>
      <label class="field"><span>生日（選填）</span><input name="birthday" type="date"></label>
      <label class="field span-2"><span>電郵（選填）</span><input name="email" type="email" autocomplete="off" placeholder="沒有可留空"></label>
      <label class="field span-2"><span>介紹人（選填）</span><select name="referrerId"><option value="">沒有介紹人</option>${members.map(item => `<option value="${item.id}">${esc(item.name)} · ${esc(item.phone || "")}</option>`).join("")}</select></label>
      <p class="muted small span-2">會員不會獲得登入帳戶；所有資料只由管理員處理。</p>
      <button class="button primary full span-2" type="submit">建立會員</button>
    </form>
  </section></div>`;
}

function saleModal() {
  const members = state.data.profiles.filter(item => item.role === "member");
  const selectedMember = state.modal.memberId || members[0]?.id;
  const balance = memberBalance(selectedMember);
  if (!state.saleItems.length) {
    const appointment = state.data.appointments.find(item => item.id === state.modal.appointmentId);
    const initial = state.data.catalog.find(item => item.id === appointment?.service_id) || state.data.catalog[0];
    if (initial) state.saleItems = [catalogToSaleItem(initial)];
  }
  const summary = calculateSale(state.saleItems, balance, state.modal.redemption || 0);
  return `<div class="modal-backdrop"><section class="modal wide"><div class="modal-head"><h2>記錄消費</h2><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="sale-form">
      <div class="form-grid">
        <label class="field"><span>會員</span><select name="memberId" id="sale-member">${members.map(item => `<option value="${item.id}" ${item.id===selectedMember?"selected":""}>${esc(item.name)} · ${esc(item.phone||item.email)}</option>`).join("")}</select></label>
        <label class="field"><span>相關預約（選填）</span><select name="appointmentId"><option value="">沒有</option>${state.data.appointments.filter(item=>item.member_id===selectedMember && ["confirmed","pending"].includes(item.status)).map(item=>`<option value="${item.id}">${formatDateTime(item.start_at)} · ${serviceName(item.service_id)}</option>`).join("")}</select></label>
      </div>
      <div class="card-head"><h3>消費項目</h3><button class="button ghost small" type="button" data-action="add-sale-item">＋ 新增項目</button></div>
      <div id="sale-items" class="list">${state.saleItems.map((item,index)=>saleItemRow(item,index)).join("")}</div>
      <label class="field"><span>使用印花（現有 ${balance} 個；新印花不能用於同一張單）</span><select name="requestedRedemption" id="sale-redemption"><option value="0">不使用</option>${balance>=4?`<option value="4" ${state.modal.redemption===4?"selected":""}>4個印花・全單9折</option>`:""}${balance>=8?`<option value="8" ${state.modal.redemption===8?"selected":""}>8個印花・全單85折</option>`:""}</select></label>
      <div class="sale-summary"><div><span>原價</span><strong>${formatMoney(summary.subtotal)}</strong></div><div><span>${summary.discountLabel}</span><strong>−${formatMoney(summary.discount)}</strong></div><div class="total"><span>實收</span><strong>${formatMoney(summary.finalAmount)}</strong></div><div><span>本次所得印花</span><strong>+${summary.earnedStamps}</strong></div></div>
      <button class="button primary full" type="submit">完成付款及發放印花</button>
    </form>
  </section></div>`;
}

function saleItemRow(item,index) {
  return `<div class="list-item"><div class="form-grid" style="flex:1">
    <label class="field span-2"><span>項目</span><select data-sale-catalog data-index="${index}" required>${catalogOptions(item.catalogId)}</select></label>
    <label class="field"><span>類型</span><input value="${item.kind === "product" ? "產品" : "服務"}" disabled></label>
    <label class="field"><span>數量</span><input data-sale-field="quantity" data-index="${index}" type="number" min="1" value="${item.quantity}"></label>
    <label class="field"><span>單價</span><input data-sale-field="unitPrice" data-index="${index}" type="number" min="0" step="0.01" value="${item.unitPrice}"></label>
  </div>${state.saleItems.length>1?`<button class="icon-button" type="button" data-action="remove-sale-item" data-index="${index}">×</button>`:""}</div>`;
}

function stampModal() {
  const members = state.data.profiles.filter(item => item.role === "member");
  return `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>管理員調整印花</h2><button class="icon-button" data-action="close-modal">×</button></div>
    <form id="stamp-form"><label class="field"><span>會員</span><select name="memberId">${members.map(item => `<option value="${item.id}">${esc(item.name)} · 現有${memberBalance(item.id)}個</option>`).join("")}</select></label>
    <label class="field"><span>加／減印花</span><input name="delta" type="number" step="1" required placeholder="例如 1 或 -1"></label>
    <label class="field"><span>原因（必填）</span><textarea name="reason" required placeholder="例如：生日獎賞、更正錯誤、推廣獎賞"></textarea></label>
    <button class="button primary full" type="submit">儲存調整紀錄</button></form>
  </section></div>`;
}

function appointmentList(items, cancellable) {
  if (!items.length) return empty("暫時未有預約");
  return `<div class="list">${items.map(item => `<div class="list-item"><div class="list-item-main"><strong>${formatDateTime(item.start_at)} · ${serviceName(item.service_id)}</strong><span>${stylistName(item.stylist_id)}${item.note?` · ${esc(item.note)}`:""}</span></div><div class="list-item-side"><span class="badge ${statusClass(item.status)}">${APPOINTMENT_LABELS[item.status]}</span>${cancellable&&["pending","confirmed"].includes(item.status)?`<div><button class="text-button small" data-action="cancel-appointment" data-id="${item.id}">取消</button></div>`:""}</div></div>`).join("")}</div>`;
}

function adminAppointmentList(items) {
  if (!items.length) return empty("沒有相關預約");
  return `<div class="list">${items.map(item => `<div class="list-item"><div class="list-item-main"><strong>${formatDateTime(item.start_at)} · ${memberName(item.member_id)}</strong><span>${serviceName(item.service_id)} · ${stylistName(item.stylist_id)}</span></div><span class="badge ${statusClass(item.status)}">${APPOINTMENT_LABELS[item.status]}</span></div>`).join("")}</div>`;
}

function adminAppointmentTable(items) {
  if (!items.length) return empty("未有預約");
  return `<div class="table-wrap"><table><thead><tr><th>日期時間</th><th>會員</th><th>服務</th><th>髮型師</th><th>狀態</th><th>操作</th></tr></thead><tbody>${items.map(item => `<tr><td>${formatDateTime(item.start_at)}</td><td>${memberName(item.member_id)}</td><td>${serviceName(item.service_id)}</td><td>${stylistName(item.stylist_id)}</td><td><span class="badge ${statusClass(item.status)}">${APPOINTMENT_LABELS[item.status]}</span></td><td><div class="actions">${item.status==="pending"?`<button class="button small" data-action="appointment-status" data-id="${item.id}" data-status="confirmed">確認</button>`:""}${["pending","confirmed"].includes(item.status)?`<button class="button ghost small" data-action="appointment-status" data-id="${item.id}" data-status="cancelled">取消</button>`:""}${item.status==="confirmed"?`<button class="button gold small" data-action="sale-from-appointment" data-id="${item.id}" data-member="${item.member_id}">完成消費</button>`:""}</div></td></tr>`).join("")}</tbody></table></div>`;
}

function memberRow(item) {
  return `<tr data-member-search="${esc(`${item.name} ${item.phone || ""} ${item.email || ""}`.toLowerCase())}"><td><strong>${esc(item.name)}</strong><br><span class="muted small">${esc(item.email || "未有電郵")}</span></td><td>${esc(item.phone||"—")}</td><td>${esc(item.birthday||"—")}</td><td>${memberBalance(item.id)}</td><td>${esc(item.referral_code||"—")}</td><td><div class="actions"><button class="button ghost small" data-action="sale-member" data-member="${item.id}">消費</button><button class="button ghost small" data-action="stamps-member" data-member="${item.id}">印花</button></div></td></tr>`;
}

function saleList(items, admin = false) {
  if (!items.length) return empty("暫時未有消費紀錄");
  return `<div class="list">${items.map(item=>`<div class="list-item"><div class="list-item-main"><strong>${admin?`${memberName(item.member_id)} · `:""}${formatMoney(item.final_amount)}</strong><span>${formatDateTime(item.completed_at)} · ${esc(item.discount_label||"沒有折扣")}</span></div><div class="list-item-side"><strong>${item.stamp_redeemed?`−${item.stamp_redeemed}印花`:"已付款"}</strong></div></div>`).join("")}</div>`;
}

function stampLedgerList(items, admin = false) {
  if (!items.length) return empty("暫時未有印花紀錄");
  return `<div class="list">${items.map(item=>`<div class="list-item"><div class="list-item-main"><strong>${admin?`${memberName(item.member_id)} · `:""}${esc(item.reason)}</strong><span>${formatDateTime(item.created_at)} · ${stampType(item.type)}</span></div><strong style="color:${item.delta>=0?"var(--green)":"var(--red)"}">${item.delta>=0?"+":""}${item.delta}</strong></div>`).join("")}</div>`;
}

function bindForms() {
  root.querySelector("#login-form")?.addEventListener("submit", onLogin);
  root.querySelector("#member-form")?.addEventListener("submit", onMember);
  root.querySelector("#appointment-form")?.addEventListener("submit", onAdminAppointment);
  root.querySelector("#catalog-form")?.addEventListener("submit", onCatalogItem);
  root.querySelector("#booking-form")?.addEventListener("submit", onBooking);
  root.querySelector("#sale-form")?.addEventListener("submit", onSale);
  root.querySelector("#stamp-form")?.addEventListener("submit", onStampAdjustment);
  root.querySelector("#booking-service")?.addEventListener("change", updateBookingTimes);
  root.querySelector("#appointment-service")?.addEventListener("change", updateAdminAppointmentTimes);
  root.querySelector("#catalog-kind")?.addEventListener("change", updateCatalogDuration);
  root.querySelector("#member-search")?.addEventListener("input", filterMembers);
  root.querySelector("#sale-member")?.addEventListener("change", event => { state.modal.memberId = event.target.value; render(); });
  root.querySelector("#sale-redemption")?.addEventListener("change", event => { state.modal.redemption = Number(event.target.value); render(); });
  root.querySelectorAll("[data-sale-field]").forEach(input => input.addEventListener("change", updateSaleItem));
  root.querySelectorAll("[data-sale-catalog]").forEach(input => input.addEventListener("change", updateSaleCatalog));
}

root.addEventListener("click", async event => {
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) { state.view = view; closeMenu(); render(); return; }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action } = target.dataset;
  try {
    if (action === "logout") { await api.signOut(); Object.assign(state,{session:null,profile:null,data:null,view:"dashboard"}); render(); }
    if (action === "refresh") await refresh();
    if (action === "export-data") { const fileName=downloadAdminWorkbook(state.data); toast(`${fileName} 已匯出。`); }
    if (action === "toggle-menu") document.querySelector("#sidebar")?.classList.toggle("open");
    if (action === "close-modal") { state.modal=null; state.saleItems=[]; render(); }
    if (action === "cancel-appointment") { await api.cancelAppointment(target.dataset.id,state.profile.id); toast("預約已取消。"); await refresh(); }
    if (action === "appointment-status") { await api.updateAppointmentStatus(target.dataset.id,target.dataset.status); toast("預約狀態已更新。"); await refresh(); }
    if (action === "new-member") { state.modal={type:"member"}; render(); }
    if (action === "new-appointment") { state.modal={type:"appointment"}; render(); }
    if (action === "new-catalog-item") { state.modal={type:"catalog"}; render(); }
    if (["new-sale","sale-member","sale-from-appointment"].includes(action)) { state.modal={type:"sale",memberId:target.dataset.member||null,appointmentId:target.dataset.id||null,redemption:0}; state.saleItems=[]; render(); }
    if (["adjust-stamps","stamps-member"].includes(action)) { state.modal={type:"stamps",memberId:target.dataset.member||null}; render(); }
    if (action === "add-sale-item") { const first=state.data.catalog[0]; if(first) state.saleItems.push(catalogToSaleItem(first)); render(); }
    if (action === "remove-sale-item") { state.saleItems.splice(Number(target.dataset.index),1); render(); }
  } catch (error) { toast(error.message,true); }
});

async function onLogin(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  await busy(event.submitter, async () => {
    state.session=await api.signIn(form.get("email"),form.get("password"));
    state.profile=await api.getProfile();
    if (!state.profile || state.profile.role !== "admin") {
      await api.signOut();
      Object.assign(state,{session:null,profile:null,data:null});
      throw new Error("此系統只供管理員使用。");
    }
    state.view="dashboard";
    await refresh();
  });
}

async function onMember(event) {
  event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget));
  await busy(event.submitter, async () => {
    await api.createMember({...form,adminId:state.profile.id});
    state.modal=null;
    toast("新會員已建立。");
    await refresh();
  });
}

async function onAdminAppointment(event) {
  event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget));
  await busy(event.submitter, async()=>{
    await api.createAppointment(form);
    state.modal=null;
    toast("新預約已建立。");
    await refresh();
  });
}

async function onCatalogItem(event) {
  event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget));
  await busy(event.submitter, async()=>{
    await api.createCatalogItem({...form,durationMinutes:form.kind === "product" ? 0 : Number(form.durationMinutes)});
    state.modal=null;
    toast("新項目已加入清單。");
    await refresh();
  });
}

async function onBooking(event) {
  event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget));
  await busy(event.submitter, async()=>{ await api.createAppointment({...form,memberId:state.profile.id}); toast("預約已提交，待管理員確認。"); state.view="appointments"; await refresh(); });
}

async function onSale(event) {
  event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget));
  await busy(event.submitter, async()=>{ await api.completeSale({memberId:form.memberId,appointmentId:form.appointmentId||state.modal.appointmentId,items:state.saleItems,requestedRedemption:Number(form.requestedRedemption),adminId:state.profile.id}); state.modal=null; state.saleItems=[]; toast("消費及印花已記錄。"); await refresh(); });
}

async function onStampAdjustment(event) {
  event.preventDefault(); const form=Object.fromEntries(new FormData(event.currentTarget));
  const memberId=state.modal.memberId||form.memberId;
  await busy(event.submitter,async()=>{ await api.adjustStamps({memberId,delta:Number(form.delta),reason:form.reason,adminId:state.profile.id}); state.modal=null; toast("印花調整已記錄。"); await refresh(); });
}

function updateBookingTimes(event) {
  const option=event.target.selectedOptions[0]; const select=root.querySelector("#booking-time");
  select.innerHTML=generateTimeSlots(Number(option.dataset.duration)).map(time=>`<option>${time}</option>`).join("");
}

function updateAdminAppointmentTimes(event) {
  const option=event.target.selectedOptions[0]; const select=root.querySelector("#appointment-time");
  select.innerHTML=generateTimeSlots(Number(option.dataset.duration)).map(time=>`<option>${time}</option>`).join("");
}

function updateCatalogDuration(event) {
  const duration=root.querySelector("#catalog-duration");
  const isProduct=event.target.value === "product";
  duration.disabled=isProduct;
  if(isProduct) duration.value="30";
}

function updateSaleCatalog(event) {
  const index=Number(event.target.dataset.index);
  const catalogItem=state.data.catalog.find(item=>item.id===event.target.value);
  if(!catalogItem) return;
  const quantity=state.saleItems[index]?.quantity || 1;
  state.saleItems[index]={...catalogToSaleItem(catalogItem),quantity};
  render();
}

function updateSaleItem(event) {
  const index=Number(event.target.dataset.index); const field=event.target.dataset.saleField;
  state.saleItems[index][field]=["quantity","unitPrice"].includes(field)?Number(event.target.value):event.target.value; render();
}

function catalogToSaleItem(item){return {catalogId:item.id,kind:item.kind,name:item.name,quantity:1,unitPrice:Number(item.price)||0};}
function catalogOptions(selectedId){
  const services=state.data.catalog.filter(item=>item.kind==="service");
  const products=state.data.catalog.filter(item=>item.kind==="product");
  const options=items=>items.map(item=>`<option value="${item.id}" ${item.id===selectedId?"selected":""}>${esc(item.name)} · ${formatMoney(item.price)}</option>`).join("");
  return `${services.length?`<optgroup label="服務">${options(services)}</optgroup>`:""}${products.length?`<optgroup label="產品">${options(products)}</optgroup>`:""}`;
}

function filterMembers(event) {
  const query=event.target.value.trim().toLowerCase();
  root.querySelectorAll("[data-member-search]").forEach(row=>row.classList.toggle("hidden",!row.dataset.memberSearch.includes(query)));
}

async function busy(button, fn) {
  const label=button?.innerHTML; if(button){button.disabled=true;button.innerHTML='<span class="spinner"></span>';}
  try { await fn(); } catch(error){toast(error.message,true);}
  finally { if(button&&button.isConnected){button.disabled=false;button.innerHTML=label;} }
}

function memberBalance(memberId) { return state.data.stamps.filter(item=>item.member_id===memberId).reduce((sum,item)=>sum+Number(item.delta),0); }
function memberName(id) { return state.data.profiles?.find(item=>item.id===id)?.name || "會員"; }
function serviceName(id) { return state.data.catalog?.find(item=>item.id===id)?.name || "服務"; }
function stylistName(id) { return state.data.stylists?.find(item=>item.id===id)?.name || "髮型師"; }
function statusClass(status) { return status.replace("_","-"); }
function stampType(type) { return ({spending:"消費印花",birthday:"生日獎賞",referral:"介紹朋友",redemption:"兌換優惠",admin_adjustment:"管理員調整"})[type]||type; }
function statCard(label,value,hint){return `<section class="card stat"><span class="label">${label}</span><strong class="value">${value}</strong><span class="hint">${hint}</span></section>`;}
function profileRow(label,value){return `<div class="list-item"><span class="muted">${label}</span><strong>${esc(value)}</strong></div>`;}
function empty(text){return `<div class="empty">${text}</div>`;}
function todayText(){return new Intl.DateTimeFormat("zh-HK",{dateStyle:"full",timeZone:"Asia/Hong_Kong"}).format(new Date());}
function localDate(date){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function closeMenu(){document.querySelector("#sidebar")?.classList.remove("open");}
function toast(message,error=false){toastEl.textContent=message;toastEl.className=`toast show ${error?"error":""}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>toastEl.className="toast",3200);}
function esc(value){return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);}
