const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const paymentMath = require('../src/services/paymentMath.js');

function loadProjectReports() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'projectReports.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  const rendered = [];
  const modules = {
    xlsx: {},
    'expo-file-system/legacy': {cacheDirectory: null, EncodingType: {Base64: 'base64'}},
    'expo-sharing': {},
    'expo-print': {},
    'expo-asset': {Asset: {fromModule: () => ({downloadAsync: async () => {}, localUri: null, uri: null})}},
    'firebase/firestore': {},
    '../firebase': {db: null},
    './reportReceipts': {renderReceiptSection: () => ''},
    './recordMath': {},
    './paymentMath': paymentMath,
    './webFiles': {
      downloadBase64File: () => false,
      printHtmlInBrowser: () => false,
      printHtmlInWindow: (html, title, browserWindow) => {
        rendered.push({html, title, browserWindow});
        return true;
      }
    }
  };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    window: {},
    require: name => {
      if (name === '../../assets/icon.png') return {};
      if (Object.hasOwn(modules, name)) return modules[name];
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return {...module.exports, rendered};
}

test('payment receipt and statement PDFs render existing payment and agreement data in the browser window', async () => {
  const {exportPaymentReceiptPdf, exportPaymentStatementPdf, rendered} = loadProjectReports();
  const payments = [
    {id: 'payment-1', paymentId: 'KSK-PAY-1', date: '2026-04-01', amount: 100, person: 'Vendor A', paymentTo: 'Vendor A', paymentKind: 'advance', contractId: 'agreement-1', description: 'Initial advance'},
    {id: 'payment-2', paymentId: 'KSK-PAY-2', date: '2026-04-05', amount: 50, person: 'Vendor A', paymentTo: 'Vendor A', paymentKind: 'payment', contractId: 'agreement-1', description: 'Second payment'}
  ];
  const contracts = [{id: 'agreement-1', person: 'Vendor A', agreedAmount: 500, startDate: '2026-03-01'}];
  const browserWindow = {closed: false};

  await exportPaymentReceiptPdf(payments[0], {}, payments, contracts, browserWindow);
  assert.equal(rendered[0].title, 'KSK Payment Receipt KSK-PAY-1');
  assert.equal(rendered[0].browserWindow, browserWindow);
  assert.match(rendered[0].html, /PAYMENT RECEIPT/);
  assert.match(rendered[0].html, /TOTAL PAID TO DATE/);
  assert.match(rendered[0].html, /₹ 150\.00/);
  assert.match(rendered[0].html, /₹ 350\.00/);
  assert.match(rendered[0].html, /Advance · Initial advance/);

  await exportPaymentStatementPdf(payments, contracts, {}, false, payments, browserWindow);
  assert.equal(rendered[1].title, 'KSK Construction payment statement');
  assert.equal(rendered[1].browserWindow, browserWindow);
  assert.match(rendered[1].html, /PAYMENT STATEMENT/);
  assert.match(rendered[1].html, /₹ 150\.00/);
  assert.match(rendered[1].html, /₹ 350\.00/);
});

test('payment receipt export surfaces invalid agreement references instead of creating an empty PDF', async () => {
  const {exportPaymentReceiptPdf, rendered} = loadProjectReports();
  const payment = {id: 'payment-bad', paymentId: 'KSK-PAY-BAD', amount: 25, person: 'Vendor A', contractId: 'missing-agreement'};

  await assert.rejects(
    exportPaymentReceiptPdf(payment, {}, [payment], [], {closed: false}),
    /could not be found/
  );
  assert.equal(rendered.length, 0);
});
