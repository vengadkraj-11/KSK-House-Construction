const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadCalculations() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'calculations.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  const data = {
    headersForSheet: (_id, sheet) => (sheet.values?.[0] || []).map(value => String(value ?? '')),
    meaningfulRows: sheet => (sheet.values || []).map((row, index) => ({row, index}))
      .filter(({row, index}) => index > 0 && row.some(value => value !== null && value !== undefined && value !== ''))
  };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      if (name === '../data') return data;
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return module.exports;
}

test('dashboard paid total uses unique valid Daily Expenses amounts regardless of column position', () => {
  const {calculateDashboard} = loadCalculations();
  const dailyExpenses = {
    values: [
      ['Expense Category', 'Bill Status', 'Date', 'Amount Paid (₹)', 'Vendor / Person'],
      ['Material', 'Received', '2026-10-01', '₹1,250.50', 'Supplier A'],
      ['Material', 'Received', '2026-10-01', '400', 'Duplicate row'],
      ['Labour', 'Received', '2026-10-02', 300.25, 'Crew'],
      ['Equipment', 'Pending', '2026-10-03', '800', 'Rental vendor'],
      ['Other', 'Received', '2026-10-04', '₹not-a-number', 'Invalid row']
    ],
    recordIds: ['', 'expense-1', 'expense-1', 'expense-2', 'expense-3', 'expense-invalid']
  };

  const dashboard = calculateDashboard({daily_expenses: dailyExpenses});

  assert.equal(dashboard.dailyExpenses, 2350.75);
  assert.equal(dashboard.totalPaid, dashboard.dailyExpenses);
  assert.equal(dashboard.materialsPaid, 1250.5);
  assert.equal(dashboard.labourPaid, 300.25);
});

test('family dashboard total paid comes from Daily Expenses, not the overlapping payment ledger', () => {
  const familyViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyViewer.tsx'), 'utf8');
  assert.match(familyViewer, /StatusPanel title=\{t\('Total paid'\)\} detail=\{money\(dashboard\.totalPaid\)\}/);
  assert.doesNotMatch(familyViewer, /const totalPaid = \(records\.payments \|\| \[\]\)\.reduce/);
});
