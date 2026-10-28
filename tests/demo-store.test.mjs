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
    name: "陳大文",
    phone: "+852 6123 4567",
    email: "newmember@example.com",
    birthday: "1990-05-20",
    referrerId: "member-1",
    adminId: "admin-1"
  });
  assert.equal(profile.phone, "6123 4567");
  assert.equal(profile.role, "member");
  assert.equal(store.data.referrals.at(-1).referred_member_id, profile.id);
  await assert.rejects(() => store.createMember({ name: "重複會員", phone: "61234567", adminId: "admin-1" }), /電話已登記/);
});
