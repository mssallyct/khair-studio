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
