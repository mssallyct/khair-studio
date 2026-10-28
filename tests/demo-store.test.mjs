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

test("只有管理員可以登入私人系統", async () => {
  localStorage.clear();
  const store = new DemoStore();
  await assert.doesNotReject(() => store.signIn("mssallyct@gmail.com"));
  await assert.rejects(() => store.signIn("member@khair.demo"), /只供管理員/);
});

test("管理員可新增香港會員及設定介紹人", async () => {
  localStorage.clear();
  const store = new DemoStore();
  const profile = await store.createMember({
    name: "測試會員",
    phone: "+852 2000 0000",
    email: "",
    birthday: "",
    referrerId: "member-1",
    adminId: "admin-1"
  });
  assert.equal(profile.phone, "2000 0000");
  assert.equal(profile.role, "member");
  assert.equal(store.data.referrals.at(-1).referred_member_id, profile.id);
  await assert.rejects(() => store.createMember({ name: "重複測試會員", phone: "20000000", adminId: "admin-1" }), /電話已登記/);
});

test("管理員可新增服務項目及已確認預約", async () => {
  localStorage.clear();
  const store = new DemoStore();
  const item = await store.createCatalogItem({ name: "新護理療程", kind: "service", price: 680, durationMinutes: 90 });
  assert.equal(item.price, 680);
  assert.equal(item.duration_minutes, 90);

  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const appointment = await store.createAppointment({ memberId: "member-1", stylistId: "sty-a", serviceId: item.id, date: future, time: "17:00", status: "confirmed", note: "" });
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.service_id, item.id);
  await assert.rejects(() => store.createCatalogItem({ name: "新護理療程", kind: "service", price: 700, durationMinutes: 60 }), /已存在/);
});
