import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { DemoStore } from "../js/demo-store.js";
import { buildServiceCatalog, prepareServiceCatalogUpdate, SERVICE_CATALOG_BACKUP_KEY, SERVICE_CATALOG_REVISION, SERVICE_PRICE_LIST } from "../js/service-catalog.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  clear() { this.values.clear(); }
}
globalThis.localStorage = new MemoryStorage();
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const config = { accounts: { tester: {profileId:"admin-test",name:"Test Admin"} }, credentialIterations: 1000 };
const password = "test-password-only";
const storageKey = "khair-demo-v1";
function legacyStore() {
  localStorage.clear();
  const store = new DemoStore(config);
  delete store.data.catalogUpdates;
  store.data.catalog = [
    {id:"old-cut",name:"洗剪吹",kind:"service",price:280,duration_minutes:90,active:true},
    {id:"old-color",name:"染髮",kind:"service",price:780,duration_minutes:180,active:true},
    {id:"custom",name:"舊自訂服務",kind:"service",price:350,duration_minutes:60,active:true},
    {id:"old-deleted",name:"已停用服務",kind:"service",price:400,duration_minutes:60,active:false},
    {id:"product",name:"保留產品",kind:"product",price:260,duration_minutes:0,active:true},
    {id:"deleted-product",name:"已停用產品",kind:"product",price:200,duration_minutes:0,active:false}
  ];
  store.data.sales = [{id:"history-sale",member_id:"member-1",subtotal:280,discount:28,final_amount:252,completed_at:"2020-01-01T05:00:00Z"}];
  store.data.saleItems = [{id:"history-line",sale_id:"history-sale",kind:"service",name:"洗剪吹",quantity:1,unit_price:280}];
  store.data.appointments = [{id:"old-booking",member_id:"member-1",stylist_id:"sty-a",service_id:"old-color",status:"confirmed",start_at:"2026-12-01T05:00:00Z",end_at:"2026-12-01T08:00:00Z"}];
  store.save();
  return store;
}

test("30個價目完整一致，同名不同價錢不合併", () => {
  const expected = [
    ["洗剪吹",168],["洗吹造型",108],["單剪",130],
    ["染髮（加長收費）",175],["染髮（IDA）",398],["染髮（Shiseido）",658],["染髮（Milbon）",758],
    ["漂染（挑染）",150],["漂染（漂髮）",200],["漂染（漂髮/漸變）",250],["漂染（漂髮）",300],
    ["電髮（髮根燙/上直下曲）",200],["電髮（冷燙）",498],["電髮（拉直）",598],["電髮（基本熱燙）",698],
    ["電髮（冷燙）",708],["電髮（冷燙）",808],["電髮（ATS拉直）",798],["電髮（Shiseido拉直/ATS熱燙）",898],
    ["電髮（Shiseido 熱燙）",998],["電髮（直療）",1098],["電髮（熱療）",1198],
    ["頭髮護理（強韌劑）",180],["頭髮護理（電前護理）",190],["頭髮護理（髮膜）",200],["頭髮護理（補水焗油）",350],
    ["頭髮護理（頭皮護理）",370],["頭髮護理（Milbon）",650],["頭髮護理（Milbon Color Preserve）",780],["頭髮護理（角蛋白修護）",1098]
  ];
  assert.deepEqual(SERVICE_PRICE_LIST.map(row => [row.name,row.price]), expected);
  assert.equal(new Set(SERVICE_PRICE_LIST.map(row => row.id)).size,30);
});

test("資料庫初始化價目與本機版的30個名稱及價格一致", () => {
  const sql = readFileSync(new URL("../supabase/schema.sql",import.meta.url),"utf8");
  const rows = [...sql.matchAll(/\('([^']+)','service'(?:::public\.catalog_kind)?,(\d+),(\d+),(\d+)\)/g)].map(match=>[match[1],Number(match[2])]);
  assert.deepEqual(rows,SERVICE_PRICE_LIST.map(row=>[row.name,row.price]));
});

test("只在成功登入後更新，先備份，歷史消費、產品、預約和會員逐項保持原樣", async () => {
  const store = legacyStore();
  const before = JSON.parse(JSON.stringify(store.data));
  const rawBefore = localStorage.getItem(storageKey);
  assert.equal(store.data.catalog.filter(row => row.kind === "service" && row.active).length,3);
  await store.signIn("tester",password);
  assert.equal(localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY),rawBefore);
  for (const key of ["sales","saleItems","appointments","profiles","stampLedger","referrals"]) assert.deepEqual(store.data[key],before[key],key);
  assert.deepEqual(store.data.catalog.filter(row => row.kind === "product"),before.catalog.filter(row => row.kind === "product"));
  for (const old of before.catalog.filter(row => row.kind === "service")) {
    const archived = store.data.catalog.find(row => row.id === old.id);
    for (const key of ["id","name","price","duration_minutes"]) assert.equal(archived[key],old[key]);
    assert.equal(archived.active,false);
  }
  assert.equal((await store.getCatalog()).filter(row => row.kind === "service").length,30);
  assert.equal(store.data.auditLog.at(-1).action,"catalog.replaced");
  assert.equal(store.data.auditLog.at(-1).actor_username,"tester");
  const updated = store.data.catalogUpdates[SERVICE_CATALOG_REVISION];
  assert.equal(updated.archived_count,3);
  assert.equal(updated.added_count,30);
  assert.equal(store.data.catalog.find(row => row.name === "洗剪吹" && row.active).duration_minutes,90);
  assert.ok(store.data.catalog.filter(row => ["染髮","漂染"].includes(row.category)).every(row => row.duration_minutes === 180));
});

test("重新登入不重複插入，不復活已刪服務，不覆蓋管理員後續修改", async () => {
  const store = legacyStore();
  await store.signIn("tester",password);
  const cut = store.data.catalog.find(row => row.name === "洗剪吹" && row.active);
  await store.updateCatalogItem(cut.id,{name:cut.name,kind:"service",price:170,durationMinutes:90});
  const remove = store.data.catalog.find(row => row.name === "單剪" && row.active);
  await store.deleteCatalogItem(remove.id);
  const before = localStorage.getItem(storageKey);
  const backup = localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY);
  const reopened = new DemoStore(config);
  await reopened.signIn("tester",password);
  assert.equal(localStorage.getItem(storageKey),before);
  assert.equal(localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY),backup);
  assert.equal(reopened.data.catalog.find(row => row.id === cut.id).price,170);
  assert.equal(reopened.data.catalog.find(row => row.id === remove.id).active,false);
  assert.equal(reopened.data.auditLog.filter(row => row.action === "catalog.replaced").length,1);
});

test("備份失敗或主資料寫入失敗都保留完整舊資料，重試只更新一次", async () => {
  for (const blockedKey of [SERVICE_CATALOG_BACKUP_KEY,storageKey]) {
    const store = legacyStore();
    const before = localStorage.getItem(storageKey);
    const originalSet = localStorage.setItem;
    localStorage.setItem = function(key,value) { if(key===blockedKey) throw new Error("QuotaExceededError"); return originalSet.call(this,key,value); };
    try { await assert.rejects(() => store.signIn("tester",password),/備份|儲存/); }
    finally { localStorage.setItem=originalSet; }
    assert.equal(localStorage.getItem(storageKey),before);
    assert.equal(JSON.stringify(store.data),before);
    assert.equal(store.session,null);
    await store.signIn("tester",password);
    assert.equal(store.data.auditLog.filter(row => row.action === "catalog.replaced").length,1);
  }
});

test("另一分頁更新後，舊分頁不能覆蓋價目與歷史資料", async () => {
  const first = legacyStore();
  const stale = new DemoStore(config);
  await first.signIn("tester",password);
  const updated = localStorage.getItem(storageKey);
  await assert.rejects(() => stale.signIn("tester",password),/另一個分頁/);
  assert.equal(localStorage.getItem(storageKey),updated);
});

test("錯誤登入不啟動更新；已有備份不會被覆蓋", async () => {
  const store = legacyStore();
  const before = localStorage.getItem(storageKey);
  await assert.rejects(() => store.signIn("unknown",password),/不正確/);
  assert.equal(localStorage.getItem(storageKey),before);
  assert.equal(localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY),null);
  localStorage.setItem(SERVICE_CATALOG_BACKUP_KEY,"EXISTING BACKUP");
  await store.signIn("tester",password);
  assert.equal(localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY),"EXISTING BACKUP");
});

test("同名冷燙和漂髮選項仍可修改或刪除，完全重複價錢則阻止", async () => {
  localStorage.clear();
  const store = new DemoStore(config);
  await store.signIn("tester",password);
  assert.equal(store.data.catalog.filter(row => row.kind === "service" && row.active).length,30);
  assert.equal(localStorage.getItem(SERVICE_CATALOG_BACKUP_KEY),null);
  const cold = store.data.catalog.filter(row => row.name === "電髮（冷燙）");
  assert.deepEqual(cold.map(row => row.price),[498,708,808]);
  await store.updateCatalogItem(cold[0].id,{name:cold[0].name,kind:"service",price:498,durationMinutes:180});
  await assert.rejects(() => store.updateCatalogItem(cold[0].id,{name:cold[0].name,kind:"service",price:708,durationMinutes:180}),/已存在/);
  await store.deleteCatalogItem(cold[1].id);
  assert.equal(store.data.catalog.find(row=>row.id===cold[1].id).active,false);
});

test("已停用項目不能用於新消費或預約，但不刪除任何舊紀錄", async () => {
  const store = legacyStore();
  await store.signIn("tester",password);
  const before = JSON.stringify(store.data);
  await assert.rejects(()=>store.completeSale({memberId:"member-1",stylistId:"sty-a",items:[{catalogId:"old-cut",kind:"service",name:"洗剪吹",unitPrice:280,quantity:1}],requestedRedemption:0}),/現行/);
  await assert.rejects(()=>store.createAppointment({memberId:"member-1",stylistId:"sty-a",serviceId:"old-cut",date:"2026-12-02",time:"13:00"}),/有效服務/);
  assert.equal(JSON.stringify(store.data),before);
});

test("無效項目資料及新ID衝突會停止更新，不清空或改寫原資料", () => {
  for (const data of [{catalog:null},{catalog:[buildServiceCatalog()[0]]}]) {
    const before=JSON.stringify(data);
    assert.throws(() => prepareServiceCatalogUpdate(data,"admin","2026-11-19T00:00:00Z"),/停止/);
    assert.equal(JSON.stringify(data),before);
  }
});
