import { DemoStore } from "./demo-store.js";
import { toHongKongIso } from "./rules.js";

const SESSION_KEY = "khair-supabase-session";

export class KhairApi {
  constructor(config = {}) {
    this.config = config;
    this.demoMode = config.demoMode !== false || !config.supabaseUrl || !config.supabaseAnonKey;
    this.demo = this.demoMode ? new DemoStore() : null;
    this.session = this.demoMode ? null : loadStoredSession();
  }

  async signIn(username, password) {
    if (this.demoMode) return this.demo.signIn(username, password);
    const session = await this.authRequest(`/token?grant_type=password`, { email: username, password });
    this.setSession(session); return session;
  }

  async signUp() {
    throw new Error("此系統不設會員自行註冊。");
  }

  async signOut() {
    if (this.demoMode) return this.demo.signOut();
    if (this.session?.access_token) await fetch(`${this.config.supabaseUrl}/auth/v1/logout`, { method: "POST", headers: this.headers() }).catch(() => null);
    this.setSession(null);
  }

  async getSession() { return this.demoMode ? this.demo.getSession() : this.session; }

  async getProfile() {
    if (this.demoMode) return this.demo.getProfile();
    if (!this.session?.user?.id) return null;
    const rows = await this.rest(`/profiles?id=eq.${encodeURIComponent(this.session.user.id)}&select=*`);
    return rows[0] || null;
  }

  async getCatalog() {
    if (this.demoMode) return this.demo.getCatalog();
    return this.rest(`/catalog?active=eq.true&order=sort_order.asc&select=*`);
  }

  async getStylists() {
    if (this.demoMode) return this.demo.getStylists();
    return this.rest(`/stylists?active=eq.true&order=name.asc&select=*`);
  }

  async getMemberDashboard(memberId) {
    if (this.demoMode) return this.demo.getMemberDashboard(memberId);
    const [appointments, sales, stamps, catalog, stylists, balanceRows] = await Promise.all([
      this.rest(`/appointments?member_id=eq.${memberId}&order=start_at.desc&select=*`),
      this.rest(`/sales?member_id=eq.${memberId}&order=completed_at.desc&select=*`),
      this.rest(`/stamp_ledger?member_id=eq.${memberId}&order=created_at.desc&select=*`),
      this.getCatalog(), this.getStylists(),
      this.rest(`/member_stamp_balances?member_id=eq.${memberId}&select=balance`)
    ]);
    return { appointments, sales, stamps, catalog, stylists, balance: Number(balanceRows[0]?.balance || 0) };
  }

  async createAppointment({ memberId, stylistId, serviceId, date, time, note, status = "pending" }) {
    if (this.demoMode) return this.demo.createAppointment({ memberId, stylistId, serviceId, date, time, note, status });
    const catalog = await this.getCatalog();
    const service = catalog.find(item => item.id === serviceId);
    const startAt = toHongKongIso(date, time);
    const endAt = new Date(new Date(startAt).getTime() + Number(service.duration_minutes) * 60000).toISOString();
    const rows = await this.rest(`/appointments`, { method: "POST", body: { member_id: memberId, stylist_id: stylistId, service_id: serviceId, start_at: startAt, end_at: endAt, note: note || "", status: status === "confirmed" ? "confirmed" : "pending" }, prefer: "return=representation" });
    return rows[0];
  }

  async createCatalogItem({ name, kind, price, durationMinutes }) {
    if (this.demoMode) return this.demo.createCatalogItem({ name, kind, price, durationMinutes });
    const rows = await this.rest(`/catalog`, { method: "POST", body: { name: String(name || "").trim(), kind: kind === "product" ? "product" : "service", price: Number(price), duration_minutes: kind === "product" ? 0 : Number(durationMinutes), active: true }, prefer: "return=representation" });
    return rows[0];
  }

  async updateCatalogItem(id, { name, kind, price, durationMinutes }) {
    if (this.demoMode) return this.demo.updateCatalogItem(id, { name, kind, price, durationMinutes });
    const rows = await this.rest(`/catalog?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { name: String(name || "").trim(), kind: kind === "product" ? "product" : "service", price: Number(price), duration_minutes: kind === "product" ? 0 : Number(durationMinutes) }, prefer: "return=representation" });
    return rows[0];
  }

  async deleteCatalogItem(id) {
    if (this.demoMode) return this.demo.deleteCatalogItem(id);
    const rows = await this.rest(`/catalog?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { active: false }, prefer: "return=representation" });
    return rows[0];
  }

  async cancelAppointment(id, memberId) {
    if (this.demoMode) return this.demo.cancelAppointment(id, memberId);
    const rows = await this.rest(`/appointments?id=eq.${id}&member_id=eq.${memberId}`, { method: "PATCH", body: { status: "cancelled" }, prefer: "return=representation" });
    return rows[0];
  }

  async getAdminDashboard() {
    if (this.demoMode) return this.demo.getAdminDashboard();
    const [profiles, appointments, sales, saleItems, stamps, referrals, catalog, stylists, settings] = await Promise.all([
      this.rest(`/profiles?order=created_at.desc&select=*`),
      this.rest(`/appointments?order=start_at.desc&select=*`),
      this.rest(`/sales?order=completed_at.desc&select=*`),
      this.rest(`/sale_items?select=*`),
      this.rest(`/stamp_ledger?order=created_at.desc&select=*`),
      this.rest(`/referrals?order=created_at.desc&select=*`),
      this.rest(`/catalog?order=sort_order.asc&select=*`), this.getStylists(),
      this.rest(`/settings?order=key.asc&select=*`)
    ]);
    return { profiles, appointments, sales, saleItems, stamps, referrals, auditLog: [], catalog, stylists, settings };
  }

  async createMember({ name, phone, email, birthday, referrerId, adminId }) {
    if (this.demoMode) return this.demo.createMember({ name, phone, email, birthday, referrerId, adminId });
    return this.rpc("create_member", {
      p_name: name,
      p_phone: phone,
      p_email: email || null,
      p_birthday: birthday || null,
      p_referrer_id: referrerId || null
    });
  }

  async updateAppointmentStatus(id, status) {
    if (this.demoMode) return this.demo.updateAppointmentStatus(id, status);
    const rows = await this.rest(`/appointments?id=eq.${id}`, { method: "PATCH", body: { status }, prefer: "return=representation" });
    return rows[0];
  }

  async adjustStamps({ memberId, delta, reason, adminId }) {
    if (this.demoMode) return this.demo.adjustStamps({ memberId, delta, reason, adminId });
    return this.rpc("adjust_stamps", { p_member_id: memberId, p_delta: Number(delta), p_reason: reason });
  }

  async completeSale({ memberId, appointmentId, items, requestedRedemption, adminId }) {
    if (this.demoMode) return this.demo.completeSale({ memberId, appointmentId, items, requestedRedemption, adminId });
    return this.rpc("complete_sale", { p_member_id: memberId, p_appointment_id: appointmentId || null, p_items: items.map(item => ({ kind: item.kind, name: item.name, quantity: Number(item.quantity), unit_price: Number(item.unitPrice) })), p_redeem_stamps: Number(requestedRedemption) || 0 });
  }

  async rpc(name, body) { return this.rest(`/rpc/${name}`, { method: "POST", body, prefer: "return=representation" }); }

  async authRequest(path, body) {
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.config.supabaseAnonKey },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.error_description || data.message || "登入失敗。");
    return data;
  }

  async rest(path, { method = "GET", body, prefer } = {}) {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1${path}`, {
      method,
      headers: { ...this.headers(), ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.message || data?.hint || "資料操作失敗。");
    return data;
  }

  headers() {
    return { "Content-Type": "application/json", apikey: this.config.supabaseAnonKey, Authorization: `Bearer ${this.session?.access_token || this.config.supabaseAnonKey}` };
  }

  setSession(session) {
    this.session = session;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY);
  }
}

function loadStoredSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
