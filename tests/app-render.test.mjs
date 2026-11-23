import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as rules from "../js/rules.js";
import { normalizeRemarks } from "../js/member-remarks.js";
import { summarizeRevenue } from "../js/revenue.js";
import { buildMemberDetail } from "../js/member-detail.js";
import { buildServiceCatalog, sortedActiveCatalog } from "../js/service-catalog.js";
import * as access from "../js/access-policy.js";
import * as rewardViews from "../js/reward-views.js";
import { createRewardWallet, quoteRewards, rewardStatus } from "../js/loyalty-v2.js";
import { webcrypto } from "node:crypto";

// Exercise the real HTML render functions without opening any browser or
// touching a user's session/storage. DOM event bindings are inert test doubles.
const source = readFileSync(new URL("../js/app.js",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace("boot();","");
function renderContext() {
  const root = {addEventListener() {}};
  const context = createContext({...rules,...access,...rewardViews,normalizeRemarks,sortedActiveCatalog,quoteRewards,rewardStatus,crypto:webcrypto,structuredClone,summarizeRevenue,buildMemberDetail,document:{querySelector:()=>root}});
  runInContext(source,context);
  runInContext('state.profile={id:"admin-howood",username:"howood",name:"Howood",role:"admin",active:true};',context);
  runInContext(`api={demoMode:true}; state.data={profiles:[{id:"member-1",name:"測試會員",role:"member"}],appointments:[],sales:[],catalog:[{id:"svc",kind:"service",name:"護理",price:600,active:true}],stylists:[{id:"sty-a",name:"髮型師",active:true}],assistants:[],stamps:[{member_id:"member-1",delta:3}]}; state.modal={type:"sale",memberId:"member-1",redemption:4}; state.saleItems=[{catalogId:"svc",kind:"service",name:"護理",quantity:1,unitPrice:600}];`,context);
  return context;
}

test('新增預約包含新客自動入會，無會員亦可提交，有穩定防重複編號',()=>{
 const context=renderContext();runInContext('api.backendMode=true;state.modal={type:"appointment"};state.data.profiles=[];',context);
 const html=runInContext('appointmentModal()',context),id=runInContext('state.modal.requestId',context);
 assert.match(html,/新客人（預約時自動入會）/);assert.match(html,/name="newName" required/);assert.match(html,/name="newPhone"/);assert.match(html,/name="newEmail"/);assert.match(html,/id="appointment-new-customer"[^>]*hidden disabled/);
 assert.doesNotMatch(html,/type="submit" disabled/);assert.match(html,/appointment-member-phone/);
 assert.match(html,/appointment-referrer-phone/);assert.match(html,/介紹人（選填，輸入電話搜尋）/);assert.match(html,/name="referrerId"/);
 runInContext('appointmentModal()',context);assert.equal(runInContext('state.modal.requestId',context),id);
 runInContext('state.data.stylists=[];',context);assert.match(runInContext('appointmentModal()',context),/type="submit" disabled/);
});

test('切換新客／已有會員只切換欄位，保留其他已填預約資料',()=>{
 const context=renderContext();context.fields={existing:{},customer:{},submit:{}};
 runInContext('root.querySelector=s=>s==="#appointment-existing-customer"?fields.existing:s==="#appointment-new-customer"?fields.customer:fields.submit;',context);
 runInContext('updateAppointmentCustomerType({target:{value:"new"}})',context);
 assert.equal(context.fields.existing.disabled,true);assert.equal(context.fields.customer.disabled,false);assert.equal(context.fields.submit.textContent,'建立會員及預約');
 runInContext('updateAppointmentCustomerType({target:{value:"existing"}})',context);
 assert.equal(context.fields.existing.disabled,false);assert.equal(context.fields.customer.disabled,true);assert.equal(context.fields.submit.textContent,'建立預約');
});

test('新客預約以單一請求提交會員資料，舊會員流程保持不變',async()=>{
 const context=renderContext();context.form={customerType:'new',requestId:'request-appointment-001',newName:'新客人',newPhone:'61234567',newEmail:'',birthdayMonth:'11',birthdayDay:'',serviceId:'svc',stylistId:'sty-a',date:'2026-11-25',time:'12:00',status:'confirmed',note:'客人備註'};
 context.FormData=class {constructor(){return Object.entries(context.form);}};
 runInContext('busy=async(button,fn)=>fn();toast=()=>{};refresh=async()=>{};api.createAppointment=async input=>{globalThis.sent=input;};',context);
 await runInContext('onAdminAppointment({preventDefault(){},currentTarget:{},submitter:{}})',context);
 assert.equal(context.sent.newMember.name,'新客人');assert.equal(context.sent.newMember.phone,'61234567');assert.equal(context.sent.newMember.birthday,'11');assert.equal(context.sent.memberId,undefined);assert.equal(context.sent.requestId,context.form.requestId);assert.equal(context.sent.note,'客人備註');
 assert.equal(context.sent.newMember.referrerId,null);
 context.form.referrerId='member-referrer';await runInContext('onAdminAppointment({preventDefault(){},currentTarget:{},submitter:{}})',context);assert.equal(context.sent.newMember.referrerId,'member-referrer');
 delete context.form.referrerId;context.sent=null;await runInContext('onAdminAppointment({preventDefault(){},currentTarget:{querySelector:()=>({value:"9123"})},submitter:{}})',context);assert.equal(context.sent,null);
 context.form={customerType:'existing',memberId:'member-1',serviceId:'svc'};await runInContext('onAdminAppointment({preventDefault(){},currentTarget:{},submitter:{}})',context);assert.equal(context.sent.memberId,'member-1');assert.equal(context.sent.newMember,undefined);
});

test('會員介紹獎賞分開列印花和剪吹次數，不把剪吹次數寫成印花',()=>{
 const context=renderContext();runInContext('state.selectedMemberId="member-1";state.data.referrals=[{referrer_id:"member-1",referred_member_id:"a",awarded_at:"2026-11-24T00:00:00Z",reward_type:"hair_visit"}];',context);
 const html=runInContext('renderMemberDetail()',context);assert.match(html,/已獲介紹剪吹次數/);assert.match(html,/已獲介紹印花/);assert.doesNotMatch(html,/位已消費並獲印花/);
});

test('備註在會員底部，逐點顯示、轉義及可新增／確認刪除',()=>{
  const context=renderContext();
  runInContext('api.backendMode=true;state.selectedMemberId="member-1";state.data.profiles[0].remarks=["第一點 <script>alert(1)</script>","第二點"];',context);
  const html=runInContext('renderMemberDetail()',context);
  assert.match(html,/備註 Remark/);assert.match(html,/data-action="edit-member-remarks"/);assert.equal((html.match(/data-action="delete-member-remark"/g)||[]).length,2);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.ok(html.indexOf('member-remarks')>html.indexOf('member-profile-hero'));
  runInContext('state.modal={type:"member-remark-delete",memberId:"member-1",index:1,version:0};',context);
  const confirm=runInContext('memberRemarksModal()',context);assert.match(confirm,/確認刪除/);assert.match(confirm,/第二點/);assert.doesNotMatch(confirm,/第一點/);
  runInContext('state.data.profiles[0].remarks=[];state.data.profiles[0].import_opening={stamps:null,hairVisits:null};state.data.profiles[0].joined_date=null;',context);
  assert.equal(runInContext('memberBalance("member-1")',context),'');
  assert.doesNotMatch(runInContext('renderMemberDetail()',context),/<ul class="remark-list">/);
});

test('會員詳情最頂先顯示Member Profile，再顯示優惠進度或待核對資訊',()=>{
  const context=renderContext();
  runInContext('state.selectedMemberId="member-1";api.backendMode=true;',context);
  let html=runInContext('renderMemberDetail()',context);
  assert.ok(html.indexOf('member-profile-hero')<html.indexOf('新制優惠'));
  assert.ok(html.indexOf('member-profile-hero')<html.indexOf('核對入會日期'));
  const now=new Date();context.wallet=createRewardWallet({id:'member-1',joined_date:rules.hongKongDateKey(now)},now);
  runInContext('state.data.rewardWallets={"member-1":wallet};',context);
  html=runInContext('renderMemberDetail()',context);
  assert.ok(html.indexOf('member-profile-hero')<html.indexOf('會員優惠進度'));
});

test('確認消費只顯示實際優惠；零減免及沒有折扣不顯示',()=>{
  const context=renderContext();
  for(const [product,hair,total,label] of [[0,0,0,'沒有折扣'],[10,0,10,'會員產品95折'],[0,16.8,16.8,'剪吹9折'],[10,16.8,26.8,'產品及剪吹優惠']]){
    context.receipt={productDiscount:product,hairDiscount:hair,discount:total,discountLabel:label};
    const html=runInContext('saleDiscountRows(receipt)',context);
    assert.equal(html.includes('只限產品95折減免'),product>0);assert.equal(html.includes('第10次剪吹項目減免'),hair>0);
    assert.equal(html.includes('優惠合計'),total>0);assert.doesNotMatch(html,/沒有折扣|−HK\$0/);
  }
  context.receipt={productDiscount:10,hairDiscount:0,discount:60,discountLabel:'4印花優惠'};
  const html=runInContext('saleDiscountRows(receipt,false)',context);assert.match(html,/4印花優惠/);assert.doesNotMatch(html,/只限產品95折減免/);
});

test('所有管理員營運總覽置頂到期通知及空狀態，其他權限不變',()=>{
  const context=renderContext();
  for(const username of ['howood','sally','admin135','admin268','admin567','admin889','admin233']){
    context.username=username;runInContext('state.profile.username=username;',context);
    const html=runInContext('renderAdminDashboard()',context),owner=['howood','sally'].includes(username);
    assert.equal(html.includes('30天內印花到期'),true);assert.equal(html.includes('暫時沒有30天內到期'),true);
    assert.ok(html.indexOf('30天內印花到期')<html.indexOf('待確認預約'));
    assert.equal(html.includes('營業額'),owner);assert.equal(html.includes('匯出 Excel'),owner);
    runInContext('state.expiryNoticeRows=[{memberId:"member-1",displayName:"未填姓名會員 · 9123 4567",daysRemaining:3,expiresAt:"2026-11-26T00:00:00+08:00",stampProgress:2}];',context);
    const populated=runInContext('renderAdminDashboard()',context);
    assert.match(populated,/未填姓名會員 · 9123 4567/);assert.match(populated,/data-member="member-1"/);assert.match(populated,/今日行程/);
    runInContext('state.expiryNoticeRows=null;',context);
  }
});

test('從會員列按印花直接固定該會員，其他管理員只讀而不重新搜尋',()=>{
  for(const username of ['howood','sally','admin135']){
    const context=renderContext();context.username=username;
    runInContext('state.profile.username=username;state.data.profiles.push({id:"member-2",name:"指定第二位會員",role:"member"});state.data.stamps.push({id:"stamp-2",member_id:"member-2",delta:5,reason:"第二位會員紀錄",created_at:"2026-11-19T04:00:00Z"});state.modal={type:"stamps",memberId:"member-2"};',context);
    const html=runInContext('stampModal()',context);
    assert.match(html,/指定第二位會員・印花資料/);assert.match(html,/name="memberId" value="member-2"/);
    assert.doesNotMatch(html,/<select|data-member-lookup-input/);assert.match(html,/現有印花：5 個/);
    assert.equal(html.includes('id="stamp-form"'),username!=='admin135');
  }
});

test('消費選單剪吹置頂、同名依價排序，保留已選項目及原資料',()=>{
  const context=renderContext();
  runInContext('state.data.catalog=[{id:"wash-high",name:"洗剪吹",price:198,kind:"service"},{id:"color",name:"染髮",price:600,kind:"service"},{id:"wash-low",name:"洗剪吹",price:168,kind:"service"},{id:"cut-high",name:"單剪",price:160,kind:"service"},{id:"cut-low",name:"單剪",price:130,kind:"service"},{id:"blow",name:"洗吹",price:138,kind:"service"}];',context);
  const before=runInContext('JSON.stringify(state.data.catalog)',context),html=runInContext('catalogOptions("wash-high")',context);
  const ids=['cut-low','cut-high','wash-low','wash-high','blow','color'];
  for(let i=1;i<ids.length;i++)assert.ok(html.indexOf(`value="${ids[i-1]}"`)<html.indexOf(`value="${ids[i]}"`));
  assert.match(html,/value="wash-high" selected/);assert.equal(runInContext('JSON.stringify(state.data.catalog)',context),before);
});

test('產品在設定及消費選單按價錢排序，停用舊產品不顯示',()=>{
  const context=renderContext();
  runInContext('state.data.catalog.push({id:"p200",kind:"product",name:"產品200",price:200},{id:"p80",kind:"product",name:"產品80",price:80},{id:"old",kind:"product",name:"停用舊產品",price:1,active:false});',context);
  for(const expr of ['renderSettings()','catalogOptions("")']){
    const html=runInContext(expr,context);assert.ok(html.indexOf('產品80')<html.indexOf('產品200'));assert.doesNotMatch(html,/停用舊產品/);
  }
});

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

test("五個管理員首頁有到期提醒、待確認及今日行程，不能直入設定或操作記錄",()=>{
  const context=renderContext();
  for(const username of ["admin135","admin268","admin567","admin889","admin233"]){
    context.username=username;runInContext('state.profile={id:username,username,name:username,role:"admin",active:true};',context);
    const home=runInContext("renderAdminDashboard()",context);
    for(const title of ["待確認預約","今日行程","30天內印花到期"])assert.ok(home.includes(title));
    for(const title of ["營業額","會員人數","本月消費"])assert.ok(!home.includes(title));
    for(const fn of ["renderSettings()","renderAuditLog()"]){assert.match(runInContext(fn,context),/沒有此頁面權限/);}
    const app=runInContext("renderApp()",context);assert.doesNotMatch(app,/data-view="(?:settings|audit)"|data-action="export-data"/);
  }
});

test("後端結帳畫面即時使用第4印優惠，進度不扣走，單價可修改",()=>{
  const context=renderContext(),now=new Date();
  const member={id:"member-1",role:"member",name:"測試會員",joined_date:rules.hongKongDateKey(now)};
  const wallet=createRewardWallet(member,now);wallet.stampProgress=3;
  context.wallet=wallet;context.member=member;
  runInContext('api.backendMode=true;state.data.profiles=[member];state.data.rewardWallets={"member-1":wallet};state.modal.requestId="checkout-ui-test-123";',context);
  const initial=runInContext("saleModal()",context);assert.match(initial,/4印花・9折/);
  const id=runInContext("backendSaleQuote(null).addedCoupons[0].id",context);context.coupon=id;
  runInContext("state.modal.couponId=coupon;",context);
  const html=runInContext("saleModal()",context);
  assert.ok(html.includes(rules.formatMoney(540)));assert.match(html,/本輪印花進度<\/span><strong>4／8/);assert.doesNotMatch(html,/data-sale-field="unitPrice"[^>]+readonly/);assert.match(html,/本次單價（可修改）/);
  assert.equal(wallet.stampProgress,3);assert.equal(Object.keys(wallet.receipts).length,0);
  runInContext('state.modal.couponId="expired";',context);assert.match(runInContext("saleModal()",context),/原優惠不適用，請重新選擇/);
  runInContext("state.modal.couponId=null;",context);assert.doesNotMatch(runInContext("saleModal()",context),/原優惠不適用/);
});

test('輸入單價即時重算，不重建輸入框；空白禁止結帳，再輸入可繼續',()=>{
 const context=renderContext(),now=new Date();context.wallet=createRewardWallet({id:'member-1',joined_date:rules.hongKongDateKey(now)},now);context.financials={innerHTML:''};
 runInContext('api.backendMode=true;state.data.rewardWallets={"member-1":wallet};state.modal.requestId="live-price-input-test";state.modal.couponId=null;root.querySelector=selector=>selector==="#sale-financials"?financials:null;root.innerHTML="input preserved";',context);
 for(const [value,total] of [['800',800],['500.5',500.5]]){
  context.value=value;runInContext('updateSaleItem({target:{dataset:{index:"0",saleField:"unitPrice"},value}})',context);
  assert.equal(runInContext('backendSaleQuote().receipt.finalAmount',context),total);assert.match(financialsHtml(context),/實收/);assert.equal(runInContext('root.innerHTML',context),'input preserved');
 }
 runInContext('updateSaleItem({target:{dataset:{index:"0",saleField:"unitPrice"},value:""}})',context);assert.match(financialsHtml(context),/type="submit" disabled/);
 runInContext('setSaleItemInput({dataset:{index:"0",saleField:"unitPrice"},value:"700"})',context);assert.equal(runInContext('backendSaleQuote().receipt.finalAmount',context),700);
});
function financialsHtml(context){return runInContext('financials.innerHTML',context);}

test('其他管理員電話只出現於到期通知，不滲入會員列或個人資料',()=>{
 const context=renderContext();
 runInContext('api.backendMode=true;state.profile.username="sally";state.data.profiles[0].name="";state.expiryNoticeRows=[{memberId:"member-1",displayName:"9123 4567",daysRemaining:10,expiresAt:"2026-12-03T00:00:00+08:00",stampProgress:2}];',context);
 const list=runInContext('renderMembers()',context);assert.match(list,/9123 4567/);assert.doesNotMatch(runInContext('memberRow(state.data.profiles[0])',context),/9123|4567|<th>電話/);
 runInContext('state.selectedMemberId="member-1";',context);assert.doesNotMatch(runInContext('renderMemberDetail()',context),/9123|4567/);
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

test("會員頁及營運總覽顯示30天到期提示",()=>{
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

test("新增會員提交支援月日或只填月份，不可只填日子", async () => {
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
  await runInContext("onMember(submitEvent)",context);
  assert.equal(runInContext("submittedMember.birthday",context),"02");
  runInContext('memberFields = [["name","測試會員"],["phone","21234568"],["birthdayDay","2"]];',context);
  await assert.rejects(() => runInContext("onMember(submitEvent)", context), /生日月份/);
  assert.equal(runInContext("submittedCount", context), 2);
});

test("只有Howood有管理員頁及新增入口，刪除有確認而主帳戶不可刪",()=>{
  const context=renderContext();
  runInContext('api.backendMode=true;state.adminAccounts=[{id:"admin-howood",username:"howood",name:"Howood",active:true},{id:"new",username:"staffnew",name:"新管理員",active:true},{id:"old",username:"staffold",name:"舊管理員",active:false}];state.modal=null;',context);
  assert.match(runInContext('renderApp()',context),/data-view="admins"/);
  const html=runInContext('renderAdmins()',context);
  assert.match(html,/data-action="new-admin"/);assert.match(html,/主帳戶・不可刪除/);
  assert.doesNotMatch(html,/data-action="delete-admin" data-id="admin-howood"/);
  assert.match(html,/已停用帳戶/);
  runInContext('state.modal={type:"admin-delete",adminId:"new"};',context);
  assert.match(runInContext('adminModal()',context),/確認停用|過往操作紀錄不會刪除/);
  for(const name of ['sally','admin135','staffnew']){
    context.username=name;runInContext('state.profile.username=username;state.modal=null;',context);
    assert.doesNotMatch(runInContext('renderApp()',context),/data-view="admins"/);
    assert.match(runInContext('renderAdmins()',context),/沒有此頁面權限/);
  }
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
