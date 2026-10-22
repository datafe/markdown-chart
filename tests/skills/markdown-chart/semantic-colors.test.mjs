import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { checkCase } from './check_final_answer.mjs';
import { validateEnvelope } from '../../../skills/markdown-chart/scripts/validate_chart.mjs';
const cases = JSON.parse(fs.readFileSync(new URL('./evals.json', import.meta.url))).evals;
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const fence = chart => '```markdown-chart\n' + JSON.stringify(chart) + '\n```';
for (const language of ['zh', 'en']) {
  for (const kind of ['waterfall', 'kpi']) {
    test(`${language} ${kind}: validates delivered values and semantic colors`, () => {
      const chart = fixture(`${kind}-${language}`);
      const testCase = cases.find(c => c.name === `${kind}-${language}`);
      assert.deepEqual(checkCase(fence(chart), testCase).errors, []);
      if (kind === 'kpi') chart.spec.colorConvention = language === 'zh' ? 'green-up-red-down' : 'red-up-green-down';
      else [chart.spec.series[1].itemStyle.color, chart.spec.series[2].itemStyle.color] = [chart.spec.series[2].itemStyle.color, chart.spec.series[1].itemStyle.color];
      assert.equal(checkCase(fence(chart), testCase).ok, false);
    });
  }
}
test('waterfall final output must preserve cross-zero bounds and signed tooltip', () => {
  const testCase = cases.find(c => c.name === 'waterfall-zh');
  for (const mutate of [
    c => { c.data.source[2][4] = 0; },
    c => { c.data.source[2][9] = '180'; },
    c => { c.spec.series[2].encode.tooltip = ['decrease', 'balance']; },
    c => { c.spec.legend.selectedMode = true; },
    c => { c.spec.series[1].stackStrategy = 'samesign'; },
    c => { c.data.source[4][5] = 30; },
  ]) {
    const chart = fixture('waterfall-zh'); mutate(chart);
    assert.equal(checkCase(fence(chart), testCase).ok, false);
  }
});
test('rejects fake native waterfall and accepts the native bar template', () => {
  const chart = fixture('waterfall-zh');
  assert.deepEqual(validateEnvelope(chart), []);
  chart.spec.series[1].type = 'waterfall';
  assert.ok(validateEnvelope(chart).some(e => e.code === 'UNSUPPORTED_WATERFALL_SERIES' && e.path === '$.spec.series[1].type'));
});
test('KPI colorConvention is optional but a strict enum when present', () => {
  const chart = fixture('kpi-zh');
  delete chart.spec.colorConvention;
  assert.deepEqual(validateEnvelope(chart), []);
  for (const invalid of [null, '', 'zh', 1, {}]) {
    chart.spec.colorConvention = invalid;
    assert.ok(validateEnvelope(chart).some(e => e.code === 'INVALID_COLOR_CONVENTION' && e.path === '$.spec.colorConvention'));
  }
});
