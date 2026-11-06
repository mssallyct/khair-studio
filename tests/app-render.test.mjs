import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as rules from "../js/rules.js";
import { summarizeRevenue } from "../js/revenue.js";

// Exercise the real HTML render functions without opening any browser or
// touching a user's session/storage. DOM event bindings are inert test doubles.
const source = readFileSync(new URL("../js/app.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace("boot();","");
function renderContext() {
  const root = {addEventListener() {}};
  const context = createContext({...rules,summarizeRevenue,document:{querySelector:()=>root}});
  runInContext(source,context);
  runInContext(`api={demoMode:true}; state.data={profiles:[{id:"member-1",name:"測試會員",role:"member"}],appointments:[],sales:[],catalog:[{id:"svc",kind:"service",name:"護理",price:800,active:true}],stylists:[{id:"sty-a",name:"髮型師",active:true}],assistants:[],stamps:[{member_id:"member-1",delta:3}]}; state.modal={type:"sale",memberId:"member-1",redemption:4}; state.saleItems=[{catalogId:"svc",kind:"service",name:"護理",quantity:1,unitPrice:800}];`,context);
  return context;
}

test("消費表單可選本單新印花並正確顯示結餘", () => {
  const context = renderContext();
  const html = runInContext("saleModal()",context);
  assert.match(html,/<option value="4" selected\s*>/);
  assert.match(html,/完成後印花結餘<\/span><strong>0<\/strong>/);
  assert.match(html,/<button class="button primary full" type="submit"\s*>/);
  assert.doesNotMatch(html,/新印花不能|下次消費先/);
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
