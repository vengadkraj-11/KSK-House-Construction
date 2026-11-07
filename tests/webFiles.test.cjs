const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadWebFiles(document, window, urlApi) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'webFiles.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    document,
    window,
    URL: urlApi,
    Blob,
    Uint8Array
  });
  return module.exports;
}

test('bill and receipt download helper creates a named browser download', () => {
  let clicked = false;
  let revoked = false;
  const anchor = {
    href: '',
    download: '',
    click() { clicked = true; },
    remove() {}
  };
  const urlApi = {
    createObjectURL: blob => {
      assert.equal(blob.type, 'image/jpeg');
      return 'blob:receipt';
    },
    revokeObjectURL: value => {
      assert.equal(value, 'blob:receipt');
      revoked = true;
    }
  };
  const document = {
    body: {appendChild() {}},
    createElement: tag => {
      assert.equal(tag, 'a');
      return anchor;
    }
  };
  const window = {
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: callback => {
      callback();
      return 1;
    }
  };
  const {downloadBase64File} = loadWebFiles(document, window, urlApi);

  assert.equal(downloadBase64File('YWJj', 'receipt-1.jpg', 'image/jpeg'), true);
  assert.equal(anchor.download, 'receipt-1.jpg');
  assert.equal(clicked, true);
  assert.equal(revoked, true);
});

test('download helper fails closed when browser download APIs are unavailable', () => {
  const {downloadBase64File} = loadWebFiles(undefined, undefined, URL);
  assert.equal(downloadBase64File('YWJj', 'receipt.jpg', 'image/jpeg'), false);
});

test('payment PDF uses a user-gesture popup and prints the prepared receipt for Chrome Save as PDF', () => {
  let opened = false;
  let printed = false;
  let written = '';
  const printWindow = {
    closed: false,
    document: {
      title: '',
      body: {textContent: ''},
      open() {},
      write(html) { written = html; },
      close() {}
    },
    focus() {},
    print() { printed = true; },
    onload: null
  };
  const window = {
    open() { opened = true; return printWindow; }
  };
  const document = {};
  const {openBrowserPrintWindow, printHtmlInWindow} = loadWebFiles(document, window, URL);

  const popup = openBrowserPrintWindow();
  assert.equal(opened, true);
  assert.equal(popup, printWindow);
  assert.equal(printWindow.document.title, 'Preparing PDF');
  assert.equal(printHtmlInWindow('<html><body>Payment receipt</body></html>', 'KSK Payment Receipt P-1', popup), true);
  assert.match(written, /Payment receipt/);
  assert.equal(printWindow.document.title, 'KSK Payment Receipt P-1');
  printWindow.onload();
  assert.equal(printed, true);
});

test('payment PDF reports when Chrome blocks the required pop-up', () => {
  const {openBrowserPrintWindow} = loadWebFiles({}, {open: () => null}, URL);
  assert.equal(openBrowserPrintWindow(), null);
});
