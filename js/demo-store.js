import { calculateSale, isBirthdayMonth, isValidBusinessSlot, normalizeHongKongPhone, toHongKongIso } from "./rules.js";

const STORAGE_KEY = "khair-demo-v1";
const CREDENTIALS_KEY = "khair-admin-credentials-v1";

const ADMIN_IDENTITIES = {
  sally: {
    profileId: "admin-sally",
    name: "Sally"
  },
  howood: {
    profileId: "admin-howood",
    name: "Howood"
  }
};

export class DemoStore {
  constructor({ accounts = ADMIN_IDENTITIES, credentialIterations = 310000 } = {}) {
    this.accounts = accounts;
    this.credentialIterations = credentialIterations;
    this.data = this.read();
    this.session = null;
  }

  read() {
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (existing?.profiles?.length) {
        const migrated = migrateData(existing, this.accounts);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch {}
    const seeded = seedData(this.accounts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
  id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

  actor() {
    const profile = this.data.profiles.find(item => item.id === this.session?.user?.id && item.role === "admin" && item.active);
    if (!profile) throw new Error("請先登入管理員帳戶。");
    return profile;
  }

  audit({ action, label, targetType, targetId, summary }) {
    const actor = this.actor();
    const row = {
      id: this.id("audit"),
      actor_id: actor.id,
      actor_username: actor.username,
      actor_name: actor.name,
      action,
      action_label: label,
      target_type: targetType,
      target_id: targetId || null,
      summary: summary || "",
      created_at: new Date().toISOString()
    };
    this.data.auditLog.push(row);
    return row;
  }

  needsCredentialSetup() {
    const credentials = this.readCredentials();
    return Object.keys(this.accounts).some(username => !credentials.accounts?.[username]);
  }

  async setupCredentials(passwords) {
    const accounts = {};
    for (const username of Object.keys(this.accounts)) {
      const password = String(passwords?.[username] || "");
      if (password.length < 8) throw new Error(`${username} 的密碼最少需要8個字元。`);
      accounts[username] = await createPasswordCredential(password, this.credentialIterations);
    }
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ version: 1, accounts }));
    return true;
  }

  readCredentials() {
    try {
      const value = JSON.parse(localStorage.getItem(CREDENTIALS_KEY));
      if (value?.accounts) return value;
    } catch {}
    return { version: 1, accounts: {} };
  }

  async signIn(username, password) {
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const account = this.accounts[normalizedUsername];
    const credentials = this.readCredentials();
    if (this.needsCredentialSetup()) throw new Error("請先在此裝置完成首次登入設定。");
    const credential = credentials.accounts?.[normalizedUsername];
    if (!account || !credential) throw new Error("登入名稱或密碼不正確。");
    const valid = account && await verifyPassword(String(password || ""), credential);
    if (!valid) throw new Error("登入名稱或密碼不正確。");
    const profile = this.data.profiles.find(item => item.id === account.profileId && item.role === "admin" && item.active);
    if (!profile) throw new Error("此管理員帳戶已停用。");
    this.session = { access_token: "demo", user: { id: profile.id, username: normalizedUsername } };
    return this.session;
  }

  async signUp() {
    throw new Error("此系統不設會員自行註冊。");
  }

  async createMember({ name, phone, email, birthday, referrerId, adminId }) {
    const actor = this.actor();
    const normalizedPhone = normalizeHongKongPhone(phone);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const memberName = String(name || "").trim();
    if (!memberName) throw new Error("請輸入會員姓名。");
    if (this.data.profiles.some(item => item.role === "member" && String(item.phone || "").replace(/\D/g, "") === normalizedPhone.replace(/\D/g, ""))) throw new Error("此電話已登記會員。");
    if (normalizedEmail && this.data.profiles.some(item => String(item.email || "").toLowerCase() === normalizedEmail)) throw new Error("此電郵已登記。");
    const profile = { id: this.id("member"), email: normalizedEmail || null, name: memberName, phone: normalizedPhone, birthday: birthday || null, referral_code: randomCode(memberName), role: "member", active: true, created_by: actor.id, created_at: new Date().toISOString() };
    this.data.profiles.push(profile);
    if (referrerId) {
      const referrer = this.data.profiles.find(item => item.id === referrerId && item.role === "member");
      if (referrer) this.data.referrals.push({ id: this.id("ref"), referrer_id: referrer.id, referred_member_id: profile.id, awarded_at: null });
    }
    this.audit({ action: "member.created", label: "新增會員", targetType: "會員", targetId: profile.id, summary: `${profile.name} · ${profile.phone}` });
    this.save();
    return profile;
  }

  async signOut() { this.session = null; }
  async getSession() { return this.session; }
  async getProfile() { return this.data.profiles.find(item => item.id === this.session?.user?.id) || null; }
  async getCatalog() { return this.data.catalog.filter(item => item.active); }
  async getStylists() { return this.data.stylists.filter(item => item.active); }
  stampBalance(memberId) { return this.data.stampLedger.filter(item => item.member_id === memberId).reduce((sum, item) => sum + item.delta, 0); }

  async getMemberDashboard(memberId) {
    const appointments = this.data.appointments.filter(item => item.member_id === memberId).sort(byNewest("start_at"));
    const sales = this.data.sales.filter(item => item.member_id === memberId).sort(byNewest("completed_at"));
    const stamps = this.data.stampLedger.filter(item => item.member_id === memberId).sort(byNewest("created_at"));
    return { appointments, sales, stamps, balance: this.stampBalance(memberId), catalog: await this.getCatalog(), stylists: await this.getStylists() };
  }

  async createAppointment({ memberId, stylistId, serviceId, date, time, note, status = "pending" }) {
    const actor = this.actor();
    const member = this.data.profiles.find(item => item.id === memberId && item.role === "member" && item.active);
    const service = this.data.catalog.find(item => item.id === serviceId);
    const stylist = this.data.stylists.find(item => item.id === stylistId && item.active);
    if (!member) throw new Error("請選擇有效會員。");
    if (!service || service.kind !== "service") throw new Error("請選擇有效服務。");
    if (!stylist) throw new Error("請選擇有效髮型師。");
    if (!date || !time) throw new Error("請選擇預約日期及時間。");
    if (!isValidBusinessSlot(time, service.duration_minutes)) throw new Error("預約必須在11:00至21:00營業時間內。");
    const startAt = toHongKongIso(date, time);
    const start = new Date(startAt).getTime();
    const end = start + service.duration_minutes * 60000;
    const conflict = this.data.appointments.some(item => item.stylist_id === stylistId && !["cancelled", "no_show"].includes(item.status) && start < new Date(item.end_at).getTime() && end > new Date(item.start_at).getTime());
    if (conflict) throw new Error("此髮型師在所選時段已有預約，請選擇其他時間。");
    const item = { id: this.id("apt"), member_id: memberId, stylist_id: stylistId, service_id: serviceId, start_at: startAt, end_at: new Date(end).toISOString(), status: status === "confirmed" ? "confirmed" : "pending", note: note || "", created_by: actor.id, created_at: new Date().toISOString() };
    this.data.appointments.push(item);
    this.audit({ action: "appointment.created", label: "新增預約", targetType: "預約", targetId: item.id, summary: `${member.name} · ${service.name} · ${date} ${time}` });
    this.save(); return item;
  }

  async createCatalogItem({ name, kind, price, durationMinutes }) {
    const actor = this.actor();
    const itemName = String(name || "").trim();
    const itemKind = kind === "product" ? "product" : "service";
    const itemPrice = Number(price);
    const duration = itemKind === "product" ? 0 : Number(durationMinutes);
    if (!itemName) throw new Error("請輸入項目名稱。");
    if (!Number.isFinite(itemPrice) || itemPrice < 0) throw new Error("請輸入有效價格。");
    if (itemKind === "service" && (!Number.isInteger(duration) || duration < 30 || duration % 30 !== 0)) throw new Error("服務時間必須以30分鐘為單位。");
    if (this.data.catalog.some(item => item.name.trim().toLowerCase() === itemName.toLowerCase())) throw new Error("此項目名稱已存在。");
    const row = { id: this.id("catalog"), name: itemName, kind: itemKind, price: itemPrice, duration_minutes: duration, active: true, sort_order: Math.max(0, ...this.data.catalog.map(item => Number(item.sort_order) || 0)) + 10, created_by: actor.id, created_at: new Date().toISOString() };
    this.data.catalog.push(row);
    this.audit({ action: "catalog.created", label: "新增項目", targetType: itemKind === "product" ? "產品" : "服務", targetId: row.id, summary: `${row.name} · HK$${row.price}` });
    this.save(); return row;
  }

  async cancelAppointment(id, memberId) {
    const actor = this.actor();
    const item = this.data.appointments.find(a => a.id === id && a.member_id === memberId);
    if (!item || !["pending", "confirmed"].includes(item.status)) throw new Error("此預約不能取消。");
    item.status = "cancelled"; item.updated_by = actor.id;
    this.audit({ action: "appointment.cancelled", label: "取消預約", targetType: "預約", targetId: item.id, summary: `${memberLabel(this.data, item.member_id)} · ${serviceLabel(this.data, item.service_id)}` });
    this.save(); return item;
  }

  async getAdminDashboard() {
    return {
      profiles: [...this.data.profiles],
      appointments: [...this.data.appointments].sort(byNewest("start_at")),
      sales: [...this.data.sales].sort(byNewest("completed_at")),
      saleItems: [...this.data.saleItems],
      stamps: [...this.data.stampLedger].sort(byNewest("created_at")),
      referrals: [...this.data.referrals],
      auditLog: [...this.data.auditLog].sort(byNewest("created_at")),
      catalog: await this.getCatalog(),
      stylists: await this.getStylists(),
      settings: [
        { key: "business_hours", value: { open: "11:00", close: "21:00", days: [1,2,3,4,5,6,0] } },
        { key: "stamp_rules", value: { threshold: 600, four_stamp_discount: 0.10, eight_stamp_discount: 0.15, product_member_discount: 0.05 } }
      ]
    };
  }

  async updateAppointmentStatus(id, status) {
    const actor = this.actor();
    const item = this.data.appointments.find(a => a.id === id);
    if (!item) throw new Error("找不到預約。");
    const previousStatus = item.status;
    item.status = status; item.updated_by = actor.id;
    this.audit({ action: "appointment.status_updated", label: "更新預約狀態", targetType: "預約", targetId: item.id, summary: `${memberLabel(this.data, item.member_id)} · ${statusLabel(previousStatus)} → ${statusLabel(status)}` });
    this.save(); return item;
  }

  async adjustStamps({ memberId, delta, reason, adminId }) {
    const actor = this.actor();
    const value = Number(delta);
    if (!Number.isInteger(value) || value === 0) throw new Error("請輸入非零整數印花數目。");
    if (!reason?.trim()) throw new Error("必須填寫調整原因。");
    if (this.stampBalance(memberId) + value < 0) throw new Error("印花結餘不足。");
    const row = { id: this.id("stamp"), member_id: memberId, delta: value, type: "admin_adjustment", reason: reason.trim(), sale_id: null, created_by: actor.id, created_at: new Date().toISOString() };
    this.data.stampLedger.push(row);
    this.audit({ action: "stamps.adjusted", label: "調整印花", targetType: "會員", targetId: memberId, summary: `${memberLabel(this.data, memberId)} · ${value > 0 ? "+" : ""}${value} · ${row.reason}` });
    this.save(); return row;
  }

  async completeSale({ memberId, appointmentId, items, requestedRedemption, adminId }) {
    const actor = this.actor();
    const profile = this.data.profiles.find(item => item.id === memberId);
    if (!profile) throw new Error("找不到會員。");
    const existingBalance = this.stampBalance(memberId);
    const summary = calculateSale(items, existingBalance, requestedRedemption);
    const sale = { id: this.id("sale"), member_id: memberId, appointment_id: appointmentId || null, subtotal: summary.subtotal, discount: summary.discount, final_amount: summary.finalAmount, discount_label: summary.discountLabel, stamp_redeemed: summary.redemption.stamps, completed_by: actor.id, completed_at: new Date().toISOString() };
    this.data.sales.push(sale);
    for (const item of items) this.data.saleItems.push({ id: this.id("line"), sale_id: sale.id, kind: item.kind, name: item.name, quantity: Number(item.quantity), unit_price: Number(item.unitPrice) });
    if (summary.redemption.stamps) this.data.stampLedger.push({ id: this.id("stamp"), member_id: memberId, delta: -summary.redemption.stamps, type: "redemption", reason: summary.discountLabel, sale_id: sale.id, created_by: actor.id, created_at: sale.completed_at });
    if (summary.earnedStamps) this.data.stampLedger.push({ id: this.id("stamp"), member_id: memberId, delta: summary.earnedStamps, type: "spending", reason: `消費 ${summary.finalAmount} 元`, sale_id: sale.id, created_by: actor.id, created_at: sale.completed_at });
    const year = new Date().getFullYear();
    const birthdayAlready = this.data.stampLedger.some(item => item.member_id === memberId && item.type === "birthday" && new Date(item.created_at).getFullYear() === year);
    if (!birthdayAlready && isBirthdayMonth(profile.birthday)) this.data.stampLedger.push({ id: this.id("stamp"), member_id: memberId, delta: 1, type: "birthday", reason: `${year} 生日月份獎賞`, sale_id: sale.id, created_by: actor.id, created_at: sale.completed_at });
    const referral = this.data.referrals.find(item => item.referred_member_id === memberId && !item.awarded_at);
    if (referral) {
      referral.awarded_at = sale.completed_at;
      this.data.stampLedger.push({ id: this.id("stamp"), member_id: referral.referrer_id, delta: 1, type: "referral", reason: `成功介紹 ${profile.name}`, sale_id: sale.id, created_by: actor.id, created_at: sale.completed_at });
    }
    if (appointmentId) {
      const appointment = this.data.appointments.find(item => item.id === appointmentId);
      if (appointment) appointment.status = "completed";
    }
    this.audit({ action: "sale.completed", label: "完成消費", targetType: "消費", targetId: sale.id, summary: `${profile.name} · 實收 HK$${summary.finalAmount}` });
    this.save(); return { sale, summary, balance: this.stampBalance(memberId) };
  }
}

function byNewest(key) { return (a, b) => new Date(b[key]) - new Date(a[key]); }
function randomCode(name) { return `${String(name || "KH").replace(/\s/g, "").slice(0,2).toUpperCase()}${Math.random().toString(36).slice(2,6).toUpperCase()}`; }

async function verifyPassword(password, account) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexBytes(account.salt), iterations: account.iterations }, key, 256);
  const actual = new Uint8Array(bits);
  const expected = hexBytes(account.verifier);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) difference |= (actual[index] || 0) ^ (expected[index] || 0);
  return difference === 0;
}

async function createPasswordCredential(password, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { salt: bytesHex(salt), verifier: bytesHex(new Uint8Array(bits)), iterations };
}

function hexBytes(value) {
  const pairs = String(value || "").match(/.{1,2}/g) || [];
  return Uint8Array.from(pairs.map(pair => Number.parseInt(pair, 16)));
}

function bytesHex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }

function migrateData(data, accounts) {
  data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
  data.saleItems = Array.isArray(data.saleItems) ? data.saleItems : [];
  data.referrals = Array.isArray(data.referrals) ? data.referrals : [];
  data.stampLedger = Array.isArray(data.stampLedger) ? data.stampLedger : [];
  const firstAccount = Object.entries(accounts)[0];
  if (firstAccount) {
    const replacementId = firstAccount[1].profileId;
    for (const profile of data.profiles) if (profile.created_by === "admin-1") profile.created_by = replacementId;
    for (const item of data.appointments || []) {
      if (item.created_by === "admin-1") item.created_by = replacementId;
      if (item.updated_by === "admin-1") item.updated_by = replacementId;
    }
    for (const item of data.catalog || []) if (item.created_by === "admin-1") item.created_by = replacementId;
    for (const item of data.sales || []) if (item.completed_by === "admin-1") item.completed_by = replacementId;
    for (const item of data.stampLedger) if (item.created_by === "admin-1") item.created_by = replacementId;
    for (const item of data.auditLog) if (item.actor_id === "admin-1") item.actor_id = replacementId;
  }
  data.profiles = data.profiles.filter(profile => profile.id !== "admin-1");
  const now = new Date().toISOString();
  for (const [username, account] of Object.entries(accounts)) {
    const existing = data.profiles.find(profile => profile.id === account.profileId);
    const fields = { id: account.profileId, username, email: null, name: account.name, phone: "", birthday: null, referral_code: `ADMIN-${username.toUpperCase()}`, role: "admin", active: true };
    if (existing) Object.assign(existing, fields);
    else data.profiles.unshift({ ...fields, created_at: now });
  }
  return data;
}

function memberLabel(data, id) { return data.profiles.find(item => item.id === id)?.name || "會員"; }
function serviceLabel(data, id) { return data.catalog.find(item => item.id === id)?.name || "服務"; }
function statusLabel(status) { return ({ pending: "待確認", confirmed: "已確認", completed: "已完成", cancelled: "已取消", no_show: "沒有出席" })[status] || status; }

function seedData(accounts) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const dayAfter = new Date(now.getTime() + 2 * 86400000);
  const isoAt = (date, hour) => { const d = new Date(date); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  return {
    profiles: [
      ...Object.entries(accounts).map(([username, account]) => ({ id: account.profileId, username, email: null, name: account.name, phone: "", birthday: null, referral_code: `ADMIN-${username.toUpperCase()}`, role: "admin", active: true, created_at: now.toISOString() })),
      { id: "member-1", email: null, name: "示範會員 A", phone: "", birthday: null, referral_code: "DEMOA", role: "member", active: true, created_at: now.toISOString() },
      { id: "member-2", email: null, name: "示範會員 B", phone: "", birthday: null, referral_code: "DEMOB", role: "member", active: true, created_at: now.toISOString() }
    ],
    stylists: [
      { id: "sty-a", name: "Hair Stylist A", active: true },
      { id: "sty-b", name: "Hair Stylist B", active: true },
      { id: "sty-c", name: "Hair Stylist C", active: true }
    ],
    catalog: [
      { id: "svc-cut", name: "洗剪吹", kind: "service", price: 280, duration_minutes: 60, active: true },
      { id: "svc-trim", name: "單剪", kind: "service", price: 180, duration_minutes: 30, active: true },
      { id: "svc-style", name: "洗吹造型", kind: "service", price: 180, duration_minutes: 60, active: true },
      { id: "svc-color", name: "染髮", kind: "service", price: 780, duration_minutes: 120, active: true },
      { id: "svc-perm", name: "電髮", kind: "service", price: 980, duration_minutes: 150, active: true },
      { id: "svc-care", name: "頭髮護理", kind: "service", price: 480, duration_minutes: 60, active: true },
      { id: "prd-shampoo", name: "專業洗髮水", kind: "product", price: 260, duration_minutes: 0, active: true }
    ],
    appointments: [
      { id: "apt-1", member_id: "member-1", stylist_id: "sty-a", service_id: "svc-cut", start_at: isoAt(tomorrow, 13), end_at: isoAt(tomorrow, 14), status: "pending", note: "", created_at: now.toISOString() },
      { id: "apt-2", member_id: "member-2", stylist_id: "sty-b", service_id: "svc-color", start_at: isoAt(dayAfter, 15), end_at: isoAt(dayAfter, 17), status: "confirmed", note: "", created_at: now.toISOString() }
    ],
    sales: [], saleItems: [], referrals: [],
    auditLog: [],
    stampLedger: [
      { id: "stamp-1", member_id: "member-1", delta: 3, type: "spending", reason: "過往消費印花", sale_id: null, created_by: Object.values(accounts)[0]?.profileId || null, created_at: now.toISOString() }
    ]
  };
}
