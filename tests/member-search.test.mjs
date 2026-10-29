import test from "node:test";
import assert from "node:assert/strict";
import { findMembersByPhone, normalizePhoneSearch } from "../js/member-search.js";

const members = [
  { id: "member-1", role: "member", active: true, name: "陳小姐", phone: "9123 4567" },
  { id: "member-2", role: "member", active: true, name: "李小姐", phone: "+852 6123 8888" },
  { id: "member-3", role: "member", active: false, name: "停用會員", phone: "9123 0000" },
  { id: "admin-1", role: "admin", active: true, name: "管理員", phone: "9123 9999" }
];

test("電話搜尋會忽略空格及香港區號格式", () => {
  assert.equal(normalizePhoneSearch("+852 9123-4567"), "91234567");
  assert.deepEqual(findMembersByPhone(members, "+852 9123").map(item => item.id), ["member-1"]);
  assert.deepEqual(findMembersByPhone(members, "9123").map(item => item.id), ["member-1"]);
  assert.deepEqual(findMembersByPhone(members, "6123 88").map(item => item.id), ["member-2"]);
});

test("電話搜尋最少三個數字並排除停用會員及管理員", () => {
  assert.deepEqual(findMembersByPhone(members, "91"), []);
  assert.deepEqual(findMembersByPhone(members, "000"), []);
  assert.deepEqual(findMembersByPhone(members, "999"), []);
});
