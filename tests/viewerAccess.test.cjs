const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadViewerAccess() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'viewerAccess.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  const firestore = new Proxy({}, {get: () => () => {}});
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'firebase/firestore') return firestore;
      if (name === '../firebase') return {db: null};
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return module.exports;
}

test('returning access requires the same authenticated UID, an approved request, and the matching mobile', () => {
  const {canContinueWithApprovedSession, normalizePhoneNumber} = loadViewerAccess();
  const approved = {
    uid: 'approved-uid',
    status: 'approved',
    normalizedMobileNumber: '+919876543210'
  };

  assert.equal(normalizePhoneNumber('98765 43210'), '+919876543210');
  assert.equal(canContinueWithApprovedSession('approved-uid', approved, '9876543210'), true);
  assert.equal(canContinueWithApprovedSession(null, approved, '9876543210'), false);
  assert.equal(canContinueWithApprovedSession('different-uid', approved, '9876543210'), false);
  assert.equal(canContinueWithApprovedSession('approved-uid', {...approved, status: 'pending'}, '9876543210'), false);
  assert.equal(canContinueWithApprovedSession('approved-uid', {...approved, status: 'revoked'}, '9876543210'), false);
  assert.equal(canContinueWithApprovedSession('approved-uid', approved, '9876543211'), false);
});
