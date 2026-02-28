const cookies = "CF_AppSession=aae4182918fe9f4a; CF_Authorization=eyJhbGciOiJSUzI1NiIsImtpZCI6ImVmMDcwODk2OTJiMzg0NmI3Mzg2NTVmOGVhNzZmOTM0YjYzNTM3MjEzZDgyYTAyYjU5OWQxNjFmYmY3MmY1MGEifQ.eyJhdWQiOlsiY2Y2OGI3MTg5ODNjYmNiNjE5MmY3ZDExZDFhYTdkYjNkM2I3OTI3YWQ1NDkxNjFhNGQzZDE5MTY5OTYwOWU4NCJdLCJlbWFpbCI6InExNDgzNzY4MzlAZ21haWwuY29tIiwiZXhwIjoxNzcyMTIyNzQ0LCJpYXQiOjE3NzIwMzYzNDQsIm5iZiI6MTc3MjAzNjM0NCwiaXNzIjoiaHR0cHM6Ly9yaW93YW5nLmNsb3VkZmxhcmVhY2Nlc3MuY29tIiwidHlwZSI6ImFwcCIsImlkZW50aXR5X25vbmNlIjoiZmV6RG5ZODV0aHJGa0NBSCIsInN1YiI6ImYyODE1ZjVhLWMyZjktNTcyOC1iZGRiLWEwZWMzMzBjMjc2ZCIsImNvdW50cnkiOiJDTiIsInBvbGljeV9pZCI6IjFjNzUyYTUwLTVmODktNDQyYi1hMjk4LWM5NGMxMGY1OTU1YSJ9.YMeI3EeAH6YJ9_eLe9qQ1J_uAF9L0mw57DgFa_y5vJmVrcq5r6nR2Iz-LJYhrqcUM5TfhxabnkU1p2Apf2g3l4stGc2tI2_NuaNOsR1jnVeNHApWs4tCVujxHVdgV3Tpx8mwcuKh3oH1FlIt_s-3hTSY61DezrLvfu3L1wtA-xtd6Cf-s4Bj_JyI4YiK1tGVjfIwL71aeJ8aI1cn4smC-GLf1u0CjHpOHTjUfi-ie_DamVgRjZdKf8JnTudQkGXMhjo5hlqioBvsXVL327W13XjZE3guJt1TFwnEziF7isLCTVb5Wz_G60JGBl_8fBYnVEf2fdsB-A9bMS9rJa2_aA; cf_clearance=6cxBFV_emlLkIUryvAo6trow.JbqSNqIF58iRjzl3Ag-1772073871-1.2.1.1-n5SZTG.CsK__GfCK.lUy6iMhMbB5T198uD_JWtXz1.OtJ71T_qnpbUHKrHqjASgqsf5eUj8MuoHYcva7vN3L8UEo0bhzg0G4PXlyYEi4u4F18IISIYSIz9zjezAJYm8qZPuXUOUrORIgbKt5ZoIOvvDDSPhjI7KaQj0OFpu3bW.2_SZsIearfpr822jH5h.Ap8bukpkvhU4Xgs6AWvZyd_fmrSkSpuCHXXu.GLj2_X4";

const resp = await fetch("https://cq.riowang.win/api/option-backtest/86", {
  headers: { accept: "application/json", cookie: cookies, "User-Agent": "Mozilla/5.0", Referer: "https://cq.riowang.win/" }
});
const data = await resp.json();
const d = data.data;
const trades = d.trades || [];

console.log("Total trades:", trades.length);
console.log("Dates:", JSON.stringify(d.dates));
console.log("Config:", JSON.stringify(d.config));
console.log("Summary:", JSON.stringify(d.summary));

console.log("\n=== TRADES ===");
trades.forEach((t, i) => {
  const et = (t.entryTime || "").split("T")[1] || "";
  const xt = (t.exitTime || "").split("T")[1] || "";
  console.log(`[${i+1}] ${t.date} ${et.substring(0,5)}->${xt.substring(0,5)} ${t.direction} ${t.optionSymbol} qty=${t.quantity} entry=${t.entryPrice} exit=${t.exitPrice} grossPnL=$${(t.grossPnL||0).toFixed(0)} net=$${(t.netPnL||0).toFixed(0)} pct=${(t.grossPnLPercent||0).toFixed(1)}% peak=${(t.peakPnLPercent||0).toFixed(1)}% hold=${t.holdingMinutes}min tag=${t.exitTag||"TAKE_PROFIT"}`);
});

// Group by date
const byDate = {};
trades.forEach(t => {
  if (!(t.date in byDate)) byDate[t.date] = {count:0, netPnL:0};
  byDate[t.date].count++;
  byDate[t.date].netPnL += t.netPnL;
});
console.log("\n=== BY DATE ===");
for (const [dt, v] of Object.entries(byDate)) {
  console.log(`${dt}: ${v.count} trades, net=$${v.netPnL.toFixed(0)}`);
}

// Signals summary
const signals = (d.diagnosticLog || {}).signals || [];
console.log(`\n=== SIGNALS: ${signals.length} total ===`);
const sigByDate = {};
signals.forEach(s => {
  if (!(s.date in sigByDate)) sigByDate[s.date] = {total:0, enter:0, reject:0, firstTime:"", lastTime:""};
  sigByDate[s.date].total++;
  if (s.action === "ENTER" || s.action === "enter") sigByDate[s.date].enter++;
  else sigByDate[s.date].reject++;
  if (!sigByDate[s.date].firstTime) sigByDate[s.date].firstTime = s.time;
  sigByDate[s.date].lastTime = s.time;
});
for (const [dt, v] of Object.entries(sigByDate)) {
  console.log(`  ${dt}: ${v.total} signals (${v.enter} enter, ${v.reject} reject) range: ${v.firstTime} - ${v.lastTime}`);
}

// Analyze time distribution of entries
console.log("\n=== ENTRY TIME DISTRIBUTION ===");
const timeSlots = {};
trades.forEach(t => {
  const hour = (t.entryTime || "").split("T")[1]?.substring(0,5) || "??";
  if (!(hour in timeSlots)) timeSlots[hour] = 0;
  timeSlots[hour]++;
});
for (const [t, c] of Object.entries(timeSlots).sort()) {
  console.log(`  ${t}: ${c} trades`);
}

// Analyze the 120%+ profit trades on 2/20
console.log("\n=== HIGH PROFIT TRADES (2/20) ===");
trades.filter(t => t.date === "2026-02-20" && t.grossPnLPercent > 50).forEach(t => {
  console.log(`  ${t.optionSymbol} entry=${t.entryPrice} exit=${t.exitPrice} peak=${t.peakPnLPercent?.toFixed(1)}% final=${t.grossPnLPercent?.toFixed(1)}% exitReason=${t.exitReason}`);
});

// Check signals that were rejected (score below threshold) - sample late day signals
console.log("\n=== SAMPLE REJECTED SIGNALS (scores) ===");
const rejectedLate = signals.filter(s => s.action !== "ENTER" && s.action !== "enter").slice(0, 10);
rejectedLate.forEach(s => {
  console.log(`  ${s.date} ${s.time} score=${s.score?.toFixed(1)} threshold=${s.threshold} action=${s.action} reason=${s.reason || ""}`);
});
