import test from "node:test";
import assert from "node:assert/strict";
import { KhairApi } from "../js/api.js";

function createApi() { return new KhairApi({demoMode:false,supabaseUrl:"https://example.invalid",supabaseAnonKey:"test-public-key"}); }

test("完整讀取超過1000筆營業額，不受單頁或最近10筆限制", async () => {
  const api = createApi();
  const history = Array.from({length:1505},(_,i)=>({id:`sale-${i}`,final_amount:10}));
  const offsets = [];
  api.rest = async path => {
    const url = new URL(path,"https://example.invalid");
    if (url.pathname !== "/sales") return [];
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    // Simulate a server-side page cap smaller than the requested page size.
    return history.slice(offset,offset+300);
  };
  const data = await api.getAdminDashboard();
  assert.deepEqual(data.sales,history);
  assert.equal(offsets.at(-1),1505);
});

test("歷史分頁失敗會報錯，不會以不完整營業額當成功", async () => {
  const api = createApi();
  let calls = 0;
  api.rest = async () => { if (calls++) throw new Error("網絡中斷"); return [{id:"sale-1"}]; };
  await assert.rejects(()=>api.restAll("/sales?order=id.asc"),/網絡中斷/);
});

test("生日月日兼容既有資料庫日期欄位，不要求用戶出生年份", async () => {
  const api = createApi();
  const calls = [];
  api.rpc = async (name, payload) => { calls.push({ name, payload }); return payload; };
  await api.createMember({ name: "測試", phone: "21234567", birthday: "02-29" });
  assert.equal(calls[0].name, "create_member");
  assert.equal(calls[0].payload.p_birthday, "2000-02-29");
  await api.createMember({ name: "測試", phone: "21234567", birthday: "" });
  assert.equal(calls[1].payload.p_birthday, null);
  await assert.rejects(() => api.createMember({ name: "測試", phone: "21234567", birthday: "04-31" }), /生日/);
  assert.equal(calls.length, 2);
});
