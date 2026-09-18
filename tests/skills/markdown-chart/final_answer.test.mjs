import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { checkCase, checkFinalAnswer } from "./check_final_answer.mjs";

const skillRoot = new URL("../../../skills/markdown-chart/", import.meta.url);
const fence = value => "```markdown-chart\n" + JSON.stringify(value) + "\n```";
const valid = () => ({
  version: 1, renderer: "echarts",
  data: { kind: "inline", dimensions: ["channel", "gmv"], source: [["PC", 6.35]] },
  spec: { xAxis: { type: "category" }, yAxis: { type: "value" }, series: [{ type: "bar", encode: { x: "channel", y: "gmv" } }] },
});

test("validates all complete chart examples shipped with the skill", () => {
  let total = 0;
  for (const name of ["SKILL.md", "references/echarts.md", "references/kpi.md", "references/table.md"]) {
    const markdown = fs.readFileSync(new URL(name, skillRoot), "utf8");
    const count = (markdown.match(/^```markdown-chart$/gm) ?? []).length;
    total += count;
    if (count === 0) continue;
    const result = checkFinalAnswer(markdown, { blockCount: count });
    assert.deepEqual(result.errors, [], name);
  }
  assert.ok(total > 0, "skill package must ship at least one complete chart example");
});

test("accepts a delivered chart without a draft or validator tool call", () => {
  assert.equal(checkFinalAnswer("PC 渠道数据如下。\n\n" + fence(valid())).ok, true);
});

test("rejects the reported inline JavaScript formatter failure", () => {
  const answer = fence(valid()).replace('"xAxis":', '"tooltip":{"formatter":function(params){return params[0].name;}},"xAxis":');
  assert.equal(checkFinalAnswer(answer).errors[0].code, "INVALID_JSON");
});

test("a successful preflight statement cannot hide an invalid final chart", () => {
  const chart = valid();
  chart.spec.series[0].label = { formatter: "{c}%" };
  const answer = '校验结果 {"ok":true}，图表如下：\n' + fence(chart);
  assert.ok(checkFinalAnswer(answer).errors.some(issue => issue.code === "FORBIDDEN_FORMATTER"));
});

test("rejects duplicate axis and series data in the final block", () => {
  const chart = valid();
  chart.spec.xAxis.data = ["PC"];
  chart.spec.series[0].data = [6.35];
  const codes = checkFinalAnswer(fence(chart)).errors.map(issue => issue.code);
  assert.ok(codes.includes("DUPLICATE_AXIS_DATA"));
  assert.ok(codes.includes("DUPLICATE_SERIES_DATA"));
  const horizontal = valid();
  horizontal.spec.yAxis.data = ["PC"];
  assert.ok(checkFinalAnswer(fence(horizontal)).errors.some(issue => issue.code === "DUPLICATE_CATEGORY_DATA"));
});

test("requires the expected number of complete, visible chart blocks", () => {
  for (const answer of ["只有文字", "```markdown-chart\n{}", fence(valid()) + "\n" + fence(valid()), "````markdown\n" + fence(valid()) + "\n````"]) {
    assert.equal(checkFinalAnswer(answer).ok, false, answer);
  }
});

test("rejects a later invalid chart even if the first chart passed", () => {
  const result = checkFinalAnswer(fence(valid()) + "\n```markdown-chart\n{bad}\n```", { blockCount: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].block, 2);
});

test("checks encoded data, not numbers quoted in the narrative", () => {
  const config = { renderer: "echarts", series: [{ type: "bar", values: { PC: 6.35 } }] };
  assert.equal(checkCase(fence(valid()), config).ok, true);
  const chart = valid();
  chart.data.source[0][1] = 635000000;
  assert.equal(checkCase("PC 为6.35亿元。\n" + fence(chart), config).ok, false);
  chart.data.source[0][1] = 6.35;
  chart.spec.series[0].encode.y = "missing";
  assert.equal(checkCase(fence(chart), config).ok, false);
});

test("checks percentage scale after KPI formatting", () => {
  const chart = {
    version: 1, renderer: "kpi", data: { kind: "inline", source: [{ ontime: 91.89, growth: 1.25 }] },
    spec: { items: [
      { id: "ontime", title: "准时交付率", value: { field: "ontime", format: { style: "decimal", suffix: "%", minimumFractionDigits: 2, maximumFractionDigits: 2 } } },
      { id: "growth", title: "增长率", value: { field: "growth", format: { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } } },
    ] },
  };
  const config = JSON.parse(fs.readFileSync(new URL("./evals.json", import.meta.url))).evals[2];
  assert.equal(checkCase(fence(chart), config).ok, true);
  chart.spec.items[0].value.format = { style: "percent" };
  assert.equal(checkCase(fence(chart), config).ok, false);
});

test("checks that long category data becomes distinct wide series", () => {
  const testCase = JSON.parse(fs.readFileSync(new URL("./evals.json", import.meta.url))).evals[3];
  const chart = {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: ["week", "mooncake", "nuts", "tea", "crab", "tableware"],
      source: [
        ["2025-05-26", 713791, 374594, 447620, 285490, 99877],
        ["2025-07-14", 391199, 282953, 826097, 468431, 100978],
      ],
    },
    spec: {
      tooltip: { trigger: "axis" },
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [
        { name: "月饼礼盒", type: "line", encode: { x: "week", y: "mooncake" } },
        { name: "坚果炒货", type: "line", encode: { x: "week", y: "nuts" } },
        { name: "茶叶茶具", type: "line", encode: { x: "week", y: "tea" } },
        { name: "大闸蟹券", type: "line", encode: { x: "week", y: "crab" } },
        { name: "餐具套装", type: "line", encode: { x: "week", y: "tableware" } },
      ],
    },
  };

  assert.equal(checkCase(fence(chart), testCase).ok, true);
  for (const series of chart.spec.series) {
    series.encode.x = [series.encode.x];
    series.encode.y = [series.encode.y];
  }
  assert.equal(checkCase(fence(chart), testCase).ok, true);
  for (const series of chart.spec.series) {
    series.encode.x = series.encode.x[0];
    series.encode.y = series.encode.y[0];
  }

  chart.data.source.push(["2025-07-21", 1, 2, 3, 4, 5]);
  assert.equal(checkCase(fence(chart), testCase).ok, false);
  chart.data.source.pop();

  chart.spec.series.push({ name: "参考柱", type: "bar", encode: { x: "week", y: "mooncake" } });
  assert.equal(checkCase(fence(chart), testCase).ok, false);
  chart.spec.series.pop();

  chart.spec.series[1].encode.y = chart.spec.series[0].encode.y;
  assert.equal(checkCase(fence(chart), testCase).ok, false);
});

test("all reference files are included in the distributed package", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("package.json", skillRoot)));
  assert.ok(pkg.files.includes("references/"));
  const main = fs.readFileSync(new URL("SKILL.md", skillRoot), "utf8");
  for (const match of main.matchAll(/\]\((references\/[^)]+)\)/g)) {
    assert.ok(fs.existsSync(new URL(match[1], skillRoot)), match[1]);
  }
});
