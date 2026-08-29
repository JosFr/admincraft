const assert = require("node:assert/strict");
const test = require("node:test");
const { parseAdmincraftPerformance } = require("../multicraft-client");

test("Admincraft status log rows expose TPS and MSPT for history", () => {
  const result = parseAdmincraftPerformance([
    { line: "[Server thread/INFO]: unrelated" },
    { line: '[Server thread/INFO]: AdmincraftStatus: {"tps1m":19.87,"tps5m":19.91,"mspt":24.6}' },
  ]);
  assert.deepEqual(result, { tps: 19.87, mspt: 24.6 });
});

test("performance log parsing fails closed on malformed or missing data", () => {
  const result = parseAdmincraftPerformance([
    { line: "AdmincraftStatus: not-json" },
    { line: "ordinary console output" },
  ]);
  assert.deepEqual(result, { tps: null, mspt: null });
});
