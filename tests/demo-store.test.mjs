import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DemoStore } from "../js/demo-store.js";

class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  setItem(key, value) { this.#data.set(key, String(value)); }
  removeItem(key) { this.#data.delete(key); }
  clear() { this.#data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const TEST_PASSWORD = "safe-test-password";
const TEST_ACCOUNTS = {
  tester: {
    profileId: "admin-tester",
    name: "Test Admin"
  }
};

function createStore() { return new DemoStore({ accounts: TEST_ACCOUNTS, credentialIterations: 1000 }); }
async function createAuthenticatedStore() {
  const store = createStore();
  await store.setupCredentials({ tester: TEST_PASSWORD });
  await store.signIn("tester", TEST_PASSWORD);
  return store;
}

test("只有正確的管理員登入名稱及密碼可以登入", async () => {
  localStorage.clear();
  const store = createStore();
  assert.equal(store.needsCredentialSetup(), true);
  await store.setupCredentials({ tester: TEST_PASSWORD });
  assert.equal(store.needsCredentialSetup(), false);
  await assert.doesNotReject(() => store.signIn("tester", TEST_PASSWORD));
  await assert.rejects(() => store.signIn("tester", "wrong-password"), /登入名稱或密碼不正確/);
  await assert.rejects(() => store.signIn("unknown", TEST_PASSWORD), /登入名稱或密碼不正確/);
});

test("舊裝置資料升級後保留會員並換成新管理員", () => {
  localStorage.clear();
  localStorage.setItem("khair-demo-v1", JSON.stringify({
    profiles: [
      { id: "admin-1", role: "admin", name: "舊管理員", active: true },
      { id: "member-old", role: "member", name: "原有會員", active: true }
    ],
    appointments: [], catalog: [], stylists: [], sales: [], saleItems: [], referrals: [], auditLog: [],
    stampLedger: [{ id: "stamp-old", member_id: "member-old", delta: 1, created_by: "admin-1", created_at: "2026-01-01T00:00:00Z" }]
  }));

  const store = createStore();
  assert.equal(store.data.profiles.find(item => item.id === "member-old")?.name, "原有會員");
  assert.equal(store.data.profiles.some(item => item.id === "admin-1"), false);
  assert.equal(store.data.profiles.find(item => item.id === "admin-tester")?.username, "tester");
  assert.equal(store.data.stampLedger[0].created_by, "admin-tester");
});

test("管理員可新增香港會員及設定介紹人", async () => {
  localStorage.clear();
  const store = await createAuthenticatedStore();
  const profile = await store.createMember({
    name: "測試會員",
    phone: "+852 2000 0000",
    email: "",
    birthday: "",
    referrerId: "member-1",
    adminId: "admin-tester"
  });
  assert.equal(profile.phone, "2000 0000");
  assert.equal(profile.role, "member");
  assert.equal(store.data.referrals.at(-1).referred_member_id, profile.id);
  assert.equal(store.data.auditLog.at(-1).actor_username, "tester");
  assert.equal(store.data.auditLog.at(-1).action, "member.created");
  await assert.rejects(() => store.createMember({ name: "重複測試會員", phone: "20000000", adminId: "admin-tester" }), /電話已登記/);
});

test("管理員可新增服務項目及已確認預約", async () => {
  localStorage.clear();
  const store = await createAuthenticatedStore();
  const item = await store.createCatalogItem({ name: "新護理療程", kind: "service", price: 680, durationMinutes: 90 });
  assert.equal(item.price, 680);
  assert.equal(item.duration_minutes, 90);

  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const appointment = await store.createAppointment({ memberId: "member-1", stylistId: "sty-a", serviceId: item.id, date: future, time: "17:00", status: "confirmed", note: "" });
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.service_id, item.id);
  assert.equal(store.data.auditLog.at(-1).actor_username, "tester");
  assert.equal(store.data.auditLog.at(-1).action, "appointment.created");
  await assert.rejects(() => store.createCatalogItem({ name: "新護理療程", kind: "service", price: 700, durationMinutes: 60 }), /已存在/);
});

test("所有主要資料更新均記錄登入管理員", async () => {
  localStorage.clear();
  const store = await createAuthenticatedStore();

  await store.updateAppointmentStatus("apt-1", "confirmed");
  await store.adjustStamps({ memberId: "member-1", delta: 1, reason: "測試調整", adminId: "admin-tester" });
  await store.completeSale({
    memberId: "member-1",
    appointmentId: "apt-1",
    items: [{ kind: "service", name: "洗剪吹", quantity: 1, unitPrice: 600 }],
    requestedRedemption: 0,
    adminId: "admin-tester"
  });

  const actions = store.data.auditLog.map(item => item.action);
  assert.deepEqual(actions, ["appointment.status_updated", "stamps.adjusted", "sale.completed"]);
  assert.ok(store.data.auditLog.every(item => item.actor_username === "tester"));
  assert.ok(store.data.auditLog.every(item => item.actor_id === "admin-tester"));
});
