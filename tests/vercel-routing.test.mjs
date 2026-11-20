import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import handler from "../api/index.js";
import { nodeHandler } from "../server/runtime.mjs";

test("Vercel explicitly routes all API depths to one function", async () => {
  const config=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.deepEqual(config.rewrites,[{source:"/api/:path*",destination:"/api"}]);
  assert.deepEqual(await readdir(new URL("../api/",import.meta.url)),["index.js"]);
  assert.equal(handler,nodeHandler);
});

test("nested API requests reach the adapter and return JSON without configured credentials", async () => {
  // A missing backend must fail closed with JSON, not a platform 404 page.
  const saved=process.env.KHAIR_BACKEND_ENABLED;
  delete process.env.KHAIR_BACKEND_ENABLED;
  try {
    for(const url of ["/api/login","/api/query/session","/api/query/records?collection=profiles&cursor=0","/api/members/rewards/opening"]) {
      const headers={};let body;
      const res={setHeader:(k,v)=>{headers[k.toLowerCase()]=v;},end:value=>{body=String(value);}};
      await handler({method:"POST",url,headers:{"content-type":"application/json"},body:{}},res);
      assert.equal(res.statusCode,503);
      assert.match(headers["content-type"],/application\/json/);
      assert.equal(typeof JSON.parse(body).error,"string");
    }
  } finally {
    if(saved===undefined)delete process.env.KHAIR_BACKEND_ENABLED;
    else process.env.KHAIR_BACKEND_ENABLED=saved;
  }
});
