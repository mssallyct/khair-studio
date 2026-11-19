import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as rules from "../js/rules.js";
import { summarizeRevenue } from "../js/revenue.js";
import { buildMemberDetail } from "../js/member-detail.js";
import { buildServiceCatalog } from "../js/service-catalog.js";
import * as access from "../js/access-policy.js";
import * as rewardViews from "../js/reward-views.js";
import { createRewardWallet, quoteRewards, rewardStatus } from "../js/loyalty-v2.js";
import { webcrypto } from "node:crypto";

// Exercise the real HTML render functions without opening any browser or
// touching a user's session/storage. DOM event bindings are inert test doubles.
const source = readFileSync(new URL("../js/app.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace("boot();","");
function renderContext() {
  const root = {addEventListener() {}};
  const context = createContext({...rules,...access,...rewardViews,quoteRewards,rewardStatus,crypto:webcrypto,structuredClone,summarizeRevenue,buildMemberDetail,document:{querySelector:()=>root}});
  runInContext(source,context);
  runInContext('state.profile={id:"admin-howood",username:"howood",name:"Howood",role:"admin",active:true};',context);
  runInContext(`api={demoMode:true}; state.data={profiles:[{id:"member-1",name:"測試會員",role:"member"}],appointments:[],sales:[],catalog:[{id:"svc",kind:"service",name:"護理",price:600,active:true}],stylists:[{id:"sty-a",name:"髮型師",active:true}],assistants:[],stamps:[{member_id:"member-1",delta:3}]}; state.modal={type:"sale",memberId:"member-1",redemption:4}; state.saleItems=[{catalogId:"svc",kind:"service",name:"護理",quantity:1,unitPrice:600}];`,context);
  return context;
}

test('會員電話欄只給Howood；新增消費改電話搜尋而不預選第一位會員',()=>{
  for(const username of ['howood','sally','admin135','admin268','admin567','admin889','admin233']){
    const context=renderContext();context.username=username;
    runInContext('state.profile.username=username;api.backendMode=true;state.data.profiles[0].phone="91234567";',context);
    const html=runInContext('renderMembers()',context);
    assert.equal(html.includes('<th>電話</th>'),username==='howood');
    assert.equal(html.includes('91234567'),username==='howood');
    assert.match(html,/搜尋電話、姓名或電郵/);
    runInContext('state.modal.memberId=null;',context);
    const modal=runInContext('saleModal()',context);
    assert.match(modal,/id="sale-member-phone"/);assert.doesNotMatch(modal,/<select name="memberId"/);
    assert.match(modal,/請先用電話搜尋並選擇會員/);assert.match(modal,/type="submit" disabled/);
  }
});

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
  assert.doesNotMatch(html, /name="birthday"|name="birthdayYear"/);
  assert.match(html, /name="joinedDate" type="date" required/);
  const february = runInContext('birthdayDayOptions("2", "29")', context);
  assert.match(february, /value="29" selected/);
  assert.doesNotMatch(february, /value="30"/);
  assert.doesNotMatch(runInContext('birthdayDayOptions("4")', context), /value="31"/);
});

test("五個新管理員首頁只保留待確認及今日行程，不能直入設定或操作記錄",()=>{
  const context=renderContext();
  for(const username of ["admin135","admin268","admin567","admin889","admin233"]){
    context.username=username;runInContext('state.profile={id:username,username,name:username,role:"admin",active:true};',context);
    const home=runInContext("renderAdminDashboard()",context);
    for(const title of ["待確認預約","今日行程"])assert.ok(home.includes(title));
    for(const title of ["營業額","會員人數","本月消費","印花到期"])assert.ok(!home.includes(title));
    for(const fn of ["renderSettings()","renderAuditLog()"]){assert.match(runInContext(fn,context),/沒有此頁面權限/);}
    const app=runInContext("renderApp()",context);assert.doesNotMatch(app,/data-view="(?:settings|audit)"|data-action="export-data"/);
  }
});

test("後端結帳畫面即時使用第4印優惠，但進度不扣走，單價由後端控制",()=>{
  const context=renderContext(),now=new Date();
  const member={id:"member-1",role:"member",name:"測試會員",joined_date:rules.hongKongDateKey(now)};
  const wallet=createRewardWallet(member,now);wallet.stampProgress=3;
  context.wallet=wallet;context.member=member;
  runInContext('api.backendMode=true;state.data.profiles=[member];state.data.rewardWallets={"member-1":wallet};state.modal.requestId="checkout-ui-test-123";',context);
  const initial=runInContext("saleModal()",context);assert.match(initial,/4印花・9折/);
  const id=runInContext("backendSaleQuote(null).addedCoupons[0].id",context);context.coupon=id;
  runInContext("state.modal.couponId=coupon;",context);
  const html=runInContext("saleModal()",context);
  assert.ok(html.includes(rules.formatMoney(540)));assert.match(html,/本輪印花進度<\/span><strong>4／8/);assert.match(html,/data-sale-field="unitPrice"[^>]+readonly/);
  assert.equal(wallet.stampProgress,3);assert.equal(Object.keys(wallet.receipts).length,0);
  runInContext('state.modal.couponId="expired";',context);assert.match(runInContext("saleModal()",context),/原優惠不適用，請重新選擇/);
  runInContext("state.modal.couponId=null;",context);assert.doesNotMatch(runInContext("saleModal()",context),/原優惠不適用/);
});

test("後端剪吹第10次顯示9折而零印花，重畫不多加次數",()=>{
  const context=renderContext(),now=new Date(),wallet=createRewardWallet({id:"member-1",joined_date:rules.hongKongDateKey(now)},now);wallet.hairVisits=9;
  context.wallet=wallet;
  runInContext('api.backendMode=true;state.data.rewardWallets={"member-1":wallet};state.data.catalog=[{id:"svc-20261119-01",kind:"service",name:"洗剪吹",price:168,active:true}];state.saleItems=[catalogToSaleItem(state.data.catalog[0])];state.modal.requestId="haircut-ui-test-123";',context);
  assert.match(runInContext("saleModal()",context),/第10次剪吹・該剪吹項目9折/);
  assert.equal(runInContext('backendSaleQuote().receipt.automaticHairApplied',context),true);
  const html=runInContext("saleModal()",context);assert.ok(html.includes(rules.formatMoney(151.2)));assert.match(html,/新增印花<\/span><strong>\+0/);assert.match(html,/剪吹累積次數<\/span><strong>0／10/);
  runInContext("saleModal()",context);assert.equal(wallet.hairVisits,9);
});

test("會員頁和主管首頁顯示14天到期提示，但員工首頁仍僅兩區",()=>{
  const context=renderContext();
  const now=new Date(),today=rules.hongKongDateKey(now);const year=Number(today.slice(0,4));
  const due=new Date(`${today}T00:00:00Z`);due.setUTCDate(due.getUTCDate()+10);
  const join=`${year-1}-${due.toISOString().slice(5,10)}`;
  const m={id:"member-1",name:"到期會員",role:"member",joined_date:join};
  const wallet=createRewardWallet(m,now);wallet.stampProgress=2;
  context.expiryMember=m;context.expiryWallet=wallet;
  runInContext('state.data.profiles=[expiryMember];state.data.rewardWallets={"member-1":expiryWallet};state.selectedMemberId="member-1";',context);
  for(const fn of ["renderAdminDashboard()","renderMembers()","renderMemberDetail()"]){assert.match(runInContext(fn,context),/到期/);}
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

test("項目選單只有30個新服務；舊預約結帳必須重新選擇，歷史資料不改", () => {
  const context = renderContext();
  context.newServices = buildServiceCatalog();
  runInContext(`state.data.catalog=[{id:"old-color",name:"舊染髮",kind:"service",price:780,duration_minutes:120,active:false},...newServices];`,context);
  const options = runInContext('catalogOptions("")',context);
  assert.equal((options.match(/<option value="svc-/g)||[]).length,30);
  assert.doesNotMatch(options,/舊染髮/);
  for (const price of [498,708,808]) assert.ok(options.includes(`電髮（冷燙） · ${rules.formatMoney(price)}`));
  assert.doesNotMatch(runInContext('catalogOptions("old-color")',context),/舊染髮|value="old-color"/);
  runInContext(`state.data.appointments=[{id:"old-apt",member_id:"member-1",service_id:"old-color",stylist_id:"sty-a",status:"confirmed",start_at:"2026-12-01T05:00:00Z"}];state.modal={type:"sale",memberId:"member-1",appointmentId:"old-apt",redemption:0};state.saleItems=[];`,context);
  const html=runInContext("saleModal()",context);
  assert.match(html,/此預約原有項目已停用，請選擇現行項目/);
  assert.doesNotMatch(html,/<option value="old-color"/);
  assert.match(html,/<button class="button primary full" type="submit" disabled>/);
  assert.equal(runInContext("state.saleItems[0].catalogId",context),"");
  assert.equal(runInContext("state.data.appointments[0].service_id",context),"old-color");
  assert.equal(runInContext("state.data.catalog[0].price",context),780);
  assert.doesNotMatch(runInContext("appointmentModal()",context),/value="old-color"|舊染髮/);
  assert.doesNotMatch(runInContext("renderBooking()",context),/value="old-color"|舊染髮/);
});
