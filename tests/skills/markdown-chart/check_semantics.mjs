// Behavioral checks for fixed-input waterfall/KPI evaluations, independent of prose.
function value(data, row, binding) {
  if (Array.isArray(binding)) binding = binding[0];
  return Array.isArray(row) ? row[typeof binding === 'number' ? binding : data.dimensions.indexOf(binding)] : row[binding];
}
export function checkSemantics(chart, testCase) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push({ code: 'SEMANTIC_MISMATCH', message }); };
  const redUp = testCase.language === 'zh';
  if (testCase.directionKpis) {
    check(chart.spec.colorConvention === (redUp ? 'red-up-green-down' : 'green-up-red-down'), 'KPI language color convention');
    for (const expected of testCase.directionKpis) {
      const item = chart.spec.items.find(item => item.title === expected.title);
      check(Boolean(item), `Missing KPI ${expected.title}`);
      if (!item) continue;
      const data = item.dataset ? chart.datasets[item.dataset] : chart.data;
      const values = data.source.map(row => value(data, row, item.value.field));
      check(JSON.stringify(values) === JSON.stringify(expected.values), `${expected.title}: source values`);
      check(['line', 'area'].includes(item.trend?.type), `${expected.title}: trend`);
      check(item.trend?.compare?.lag === 1 && item.trend?.compare?.mode === 'absolute', `${expected.title}: signed absolute comparison`);
      if (expected.polarity) check(item.trend?.compare?.polarity === expected.polarity, `${expected.title}: business polarity`);
    }
  }
  if (testCase.waterfall) {
    const series = chart.spec.series;
    const base = series.find(s => s.silent === true);
    const increase = series.find(s => s.itemStyle?.color === (redUp ? '#d93025' : '#138a55'));
    const decrease = series.find(s => s.itemStyle?.color === (redUp ? '#138a55' : '#d93025'));
    const total = series.find(s => s !== base && s !== increase && s !== decrease);
    check(series.length === 4 && !!base && !!increase && !!decrease && !!total, 'Four waterfall roles and language colors');
    if (!base || !increase || !decrease || !total) return errors;
    check(series.every(s => s.type === 'bar' && s.stack === base.stack && s.stackStrategy === 'all') && !!base.stack, 'Signed native bar stack');
    check(base.itemStyle?.opacity === 0 && base.tooltip?.show === false && base.label?.show === false && base.emphasis?.disabled === true, 'Invisible noninteractive base');
    check(chart.spec.legend?.selectedMode === false && JSON.stringify(chart.spec.legend?.data) === JSON.stringify([increase.name, decrease.name, total.name]), 'Visible fixed legend');
    check(chart.spec.tooltip?.trigger === 'item', 'Item tooltip');
    check(chart.data.source.length === testCase.waterfall.length, 'Waterfall step count');
    let balance = 0;
    for (const [index, step] of testCase.waterfall.entries()) {
      const row = chart.data.source[index];
      if (!row) continue;
      const isTotal = step.change === null;
      const previous = balance;
      balance = isTotal ? step.balance : balance + step.change;
      const expected = [isTotal ? 0 : Math.min(previous, balance), isTotal ? 0 : Math.max(step.change, 0), isTotal ? 0 : Math.max(-step.change, 0), isTotal ? balance : 0];
      check(JSON.stringify([base, increase, decrease, total].map(s => value(chart.data, row, s.encode.y))) === JSON.stringify(expected), `${step.name}: bar bounds`);
      const active = isTotal ? total : step.change >= 0 ? increase : decrease;
      check(value(chart.data, row, active.encode.x) === step.name, `${step.name}: business order`);
      const label = value(chart.data, row, active.encode.label);
      check(typeof label === 'string' && Number(label.replace('−', '-')) === (isTotal ? balance : step.change), `${step.name}: signed label`);
      const tooltip = (active.encode.tooltip ?? []).map(field => value(chart.data, row, field));
      check(JSON.stringify(tooltip) === JSON.stringify(isTotal ? [balance] : [step.change, balance]), `${step.name}: signed tooltip`);
      check(active.label?.show === true && active.itemStyle?.borderRadius === 0, `${step.name}: visible square bar`);
    }
  }
  return errors;
}
