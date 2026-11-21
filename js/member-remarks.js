// Keep each source cell / entered line as a separate remark; blank stays empty.
export function normalizeRemarks(value) {
  if(value==null || value==="")return [];
  const lines=typeof value==="string" ? value.split(/\r?\n/) : value;
  if(!Array.isArray(lines) || lines.some(line=>typeof line!=="string"))throw new Error("備註須為文字，每行一點。");
  const remarks=lines.map(line=>line.trim()).filter(Boolean);
  if(remarks.length>100 || remarks.some(line=>line.length>2000) || remarks.join("\n").length>30000)throw new Error("備註過長，請縮短內容。");
  return remarks;
}
