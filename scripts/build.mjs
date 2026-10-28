import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root,"dist");
const required = ["index.html","styles.css","config.example.js","manifest.webmanifest","sw.js","assets","js"];

await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for (const item of required) await cp(join(root,item),join(dist,item),{recursive:true});
await cp(join(root,"config.example.js"),join(dist,"config.js"));
const html=await readFile(join(dist,"index.html"),"utf8");
if (!html.includes("K.Hair Studio") || !html.includes("js/app.js")) throw new Error("Build validation failed: invalid index.html");
console.log(`Build complete: ${required.length + 1} app resources copied to dist/`);
