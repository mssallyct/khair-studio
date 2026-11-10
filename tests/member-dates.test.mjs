import test from "node:test";
import assert from "node:assert/strict";
import { birthdayDaysInMonth, birthdayFromParts, birthdayStampAward, formatBirthday, isBirthdayMonth, membershipInfo, normalizeBirthday } from "../js/rules.js";

test("生日只需月日，兼容舊生日但不顯示出生年份", () => {
  assert.equal(birthdayFromParts("2", "29"), "02-29");
  assert.equal(birthdayFromParts("", ""), null);
  assert.equal(normalizeBirthday("1996-02-29"), "02-29");
  assert.equal(normalizeBirthday(""), null);
  assert.equal(formatBirthday("1996-02-29"), "2月29日");
  assert.equal(formatBirthday("02-29"), "2月29日");
  assert.equal(formatBirthday(null), "未記錄");
  assert.equal(birthdayDaysInMonth(2), 29);
  assert.equal(birthdayDaysInMonth(4), 30);
  for (const [month, day] of [["2", "30"], ["4", "31"], ["13", "1"], ["0", "1"], ["1", "0"], ["11", ""], ["", "10"]]) {
    assert.throws(() => birthdayFromParts(month, day), /生日/);
  }
  assert.throws(() => normalizeBirthday("02-30"), /生日/);
});

test("只填月日仍按香港生日月份發一次獎賞，兼容舊格式", () => {
  const date = new Date("2026-12-31T16:00:00Z");
  for (const birthday of ["01-02", "1990-01-02", "2000-01-02"]) {
    const profile = { id: "m1", birthday };
    assert.equal(isBirthdayMonth(birthday, date), true);
    assert.equal(birthdayStampAward(profile, [], date), 1);
    assert.equal(birthdayStampAward(profile, [{ member_id: "m1", type: "birthday", created_at: "2026-12-31T16:00:00Z" }], date), 0);
  }
  assert.equal(isBirthdayMonth("02-29", new Date("2027-02-01T00:00:00Z")), true);
  assert.equal(isBirthdayMonth("02-30", new Date("2027-02-01T00:00:00Z")), false);
});

test("入會年份與年資按香港週年累積，不因跨年提早加一年", () => {
  const profile = { created_at: "2023-11-09T16:00:00Z" };
  const before = membershipInfo(profile, new Date("2026-11-09T15:59:59Z"));
  assert.deepEqual(before, { joinedDate: "2023-11-10", joinedYear: 2023, years: 2, months: 11, label: "2年11個月" });
  const anniversary = membershipInfo(profile, new Date("2026-11-09T16:00:00Z"));
  assert.equal(anniversary.label, "3年0個月");
  assert.equal(membershipInfo(profile, new Date("2027-01-01T00:00:00Z")).label, "3年1個月");
  assert.equal(profile.created_at, "2023-11-09T16:00:00Z");
  assert.equal(membershipInfo({ created_at: "2026-12-31T16:00:00Z" }, new Date("2027-01-01T00:00:00Z")).joinedYear, 2027);
});

test("新會員未滿一個月，月尾及閏日年資有明確邊界", () => {
  assert.equal(membershipInfo({ created_at: "2026-11-10T00:00:00Z" }, new Date("2026-11-10T01:00:00Z")).label, "未滿1個月");
  assert.equal(membershipInfo({ created_at: "2026-01-31T00:00:00Z" }, new Date("2026-02-28T00:00:00Z")).label, "0年1個月");
  assert.equal(membershipInfo({ created_at: "2024-02-29T00:00:00Z" }, new Date("2025-02-28T00:00:00Z")).label, "1年0個月");
});

test("缺失或不正確入會日期不會被填成今日或假年資", () => {
  for (const profile of [{}, { created_at: null }, { created_at: "" }, { created_at: "invalid" }]) {
    const before = JSON.stringify(profile);
    const summary = membershipInfo(profile, new Date("2026-11-10T00:00:00Z"));
    assert.equal(summary.joinedYear, null);
    assert.equal(summary.years, null);
    assert.equal(summary.label, "未記錄");
    assert.equal(JSON.stringify(profile), before);
  }
  const future = membershipInfo({ created_at: "2028-01-01T00:00:00Z" }, new Date("2026-11-10T00:00:00Z"));
  assert.equal(future.years, null);
  assert.equal(future.label, "入會日期待核對");
});
