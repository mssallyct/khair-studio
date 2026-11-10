import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as rules from "../js/rules.js";
import { summarizeRevenue } from "../js/revenue.js";
import { buildMemberDetail } from "../js/member-detail.js";

// Exercise the real HTML render functions without opening any browser or
// touching a user's session/storage. DOM event bindings are inert test doubles.
const source = readFileSync(new URL("../js/app.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace("boot();","");
function renderContext() {
  const root = {addEventListener() {}};
  const context = createContext({...rules,summarizeRevenue,buildMemberDetail,document:{querySelector:()=>root}});
  runInContext(source,context);
  runInContext(`api={demoMode:true}; state.data={profiles:[{id:"member-1",name:"測試會員",role:"member"}],appointments:[],sales:[],catalog:[{id:"svc",kind:"service",name:"護理",price:600,active:true}],stylists:[{id:"sty-a",name:"髮型師",active:true}],assistants:[],stamps:[{member_id:"member-1",delta:3}]}; state.modal={type:"sale",memberId:"member-1",redemption:4}; state.saleItems=[{catalogId:"svc",kind:"service",name:"護理",quantity:1,unitPrice:600}];`,context);
  return context;
}

test("消費表單可選本單新印花並正確顯示結餘", () => {
  const context = renderContext();
  const html = runInContext("saleModal()",context);
  assert.match(html,/<option value="4" selected\s*>/);
  assert.ok(html.includes(`實收</span><strong>${rules.formatMoney(540)}</strong>`));
  assert.ok(html.includes(`計印花金額（使用印花優惠前）</span><strong>${rules.formatMoney(600)}</strong>`));
  assert.match(html,/本次消費所得印花<\/span><strong>\+1/);
  assert.match(html,/本單可用 4 個/);
  assert.match(html,/完成後印花結餘<\/span><strong>0<\/strong>/);
  assert.match(html,/<button class="button primary full" type="submit"\s*>/);
  assert.doesNotMatch(html,/新印花不能|下次消費先/);
});

test("金額降至不足600後立即阻止不夠印花的兌換，不先寫入新印花", () => {
  const context = renderContext();
  runInContext("state.saleItems[0].unitPrice=599.99;",context);
  const html = runInContext("saleModal()",context);
  assert.match(html,/<option value="4" selected disabled>/);
  assert.match(html,/role="alert">原有印花加本次消費所得印花仍不足/);
  assert.match(html,/<button class="button primary full" type="submit" disabled>/);
  assert.equal(runInContext("state.data.stamps.length",context),1);
});

test("改成純產品後，原本已選的印花會阻止提交並要求重新選擇", () => {
  const context = renderContext();
  runInContext('state.saleItems[0].kind="product";',context);
  const html = runInContext("saleModal()",context);
  assert.match(html,/role="alert">淨產品消費不適用印花/);
  assert.match(html,/<button class="button primary full" type="submit" disabled>/);
  runInContext("state.modal.redemption=0;",context);
  const updated = runInContext("saleModal()",context);
  assert.match(updated,/本次消費所得印花<\/span><strong>\+0/);
  assert.match(updated,/<button class="button primary full" type="submit"\s*>/);
});

test("首頁顯示本月、上月、歷月以及本機資料保存限制", () => {
  const html = runInContext("renderAdminDashboard()",renderContext());
  for (const label of ["本月營業額","上月營業額","歷月營業額","歷來總營業額","未接駁雲端備份"]) assert.ok(html.includes(label));
});

test("新增會員生日只有月日選單，二月可選29日而不可選30日", () => {
  const context = renderContext();
  const html = runInContext("memberModal()", context);
  assert.match(html, /name="birthdayMonth"/);
  assert.match(html, /name="birthdayDay"/);
  assert.doesNotMatch(html, /name="birthday"|name="birthdayYear"|type="date"/);
  const february = runInContext('birthdayDayOptions("2", "29")', context);
  assert.match(february, /value="29" selected/);
  assert.doesNotMatch(february, /value="30"/);
  assert.doesNotMatch(runInContext('birthdayDayOptions("4")', context), /value="31"/);
});

test("會員名單及詳情顯示入會年份和自動年資，舊生日不顯示出生年份", () => {
  const context = renderContext();
  runInContext('Object.assign(state.data.profiles[0],{birthday:"1990-11-10",created_at:"2023-11-09T16:00:00Z"}); state.selectedMemberId="member-1";', context);
  const expected = rules.membershipInfo({ created_at: "2023-11-09T16:00:00Z" });
  for (const fn of ["renderMembers()", "renderMemberDetail()"]) {
    const html = runInContext(fn, context);
    for (const label of ["入會年份", "會員年資", "2023", expected.label, "11月10日"]) assert.ok(html.includes(label));
    assert.doesNotMatch(html, /1990/);
  }
  assert.equal(runInContext("state.data.profiles[0].birthday", context), "1990-11-10");
  runInContext("delete state.data.profiles[0].created_at;", context);
  assert.match(runInContext("renderMemberDetail()", context), /入會年份<\/span><strong>未記錄/);
});

test("新增會員提交會把月日轉成無年份生日，未選完整日期不會建立會員", async () => {
  const context = renderContext();
  runInContext(`
    let submittedMember = null;
    let submittedCount = 0;
    let memberFields = [["name","測試會員"],["phone","21234567"],["birthdayMonth","2"],["birthdayDay","29"]];
    class FormData { constructor() {} [Symbol.iterator]() { return memberFields[Symbol.iterator](); } }
    api.createMember = async value => { submittedMember = value; submittedCount++; };
    state.profile = {id:"admin-test"};
    busy = async (_, fn) => fn();
    toast = () => {};
    refresh = async () => {};
    const submitEvent = {preventDefault(){},currentTarget:{querySelector(){return null;}}};
  `, context);
  await runInContext("onMember(submitEvent)", context);
  assert.equal(runInContext("submittedMember.birthday", context), "02-29");
  assert.equal(runInContext("submittedMember.adminId", context), "admin-test");
  runInContext('memberFields = [["name","測試會員"],["phone","21234568"],["birthdayMonth","2"]];', context);
  await assert.rejects(() => runInContext("onMember(submitEvent)", context), /同時選擇生日/);
  assert.equal(runInContext("submittedCount", context), 1);
});
