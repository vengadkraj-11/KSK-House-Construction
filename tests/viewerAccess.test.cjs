const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createViewerAccess() {
  const documents = new Map();
  let timestamp = 0;
  let transactionQueue = Promise.resolve();
  const reference = (...parts) => ({path: parts.slice(1).join('/')});
  const snapshot = ref => {
    const data = documents.get(ref.path);
    return {exists: () => data !== undefined, data: () => data};
  };
  const firestore = new Proxy({
    doc: reference,
    serverTimestamp: () => `server-time-${++timestamp}`,
    getDoc: async ref => snapshot(ref),
    runTransaction: async (_database, callback) => {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise(resolve => { release = resolve; });
      await previous;
      const writes = [];
      const transaction = {
        get: async ref => snapshot(ref),
        set: (ref, data) => writes.push({type: 'set', ref, data}),
        update: (ref, data) => writes.push({type: 'update', ref, data})
      };
      try {
        const result = await callback(transaction);
        for (const write of writes) {
          if (write.type === 'update' && !documents.has(write.ref.path)) throw new Error('Missing document');
          documents.set(write.ref.path, {
            ...(documents.get(write.ref.path) || {}),
            ...write.data
          });
        }
        return result;
      } finally {
        release();
      }
    }
  }, {get: (target, key) => target[key] || (() => {})});
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'viewerAccess.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'firebase/firestore') return firestore;
      if (name === '../firebase') return {db: {}};
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return {...module.exports, documents};
}

test('new family registration creates one normalized pending member and phone index', async () => {
  const {registerViewerRequest, documents} = createViewerAccess();
  const result = await registerViewerRequest('new-uid', '98765 43210', 'New Member', 'en');

  assert.equal(JSON.stringify(result), JSON.stringify({uid: 'new-uid', status: 'pending', created: true, currentSession: true}));
  assert.equal(documents.get('viewerAccess/new-uid').normalizedMobileNumber, '+919876543210');
  assert.equal(documents.get('viewerAccess/new-uid').status, 'pending');
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').uid, 'new-uid');
  assert.equal(documents.get('viewerPhoneStatus/+919876543210').status, 'pending');
});

test('a pending member submitting again is idempotent and keeps pending status', async () => {
  const {registerViewerRequest, documents} = createViewerAccess();
  await registerViewerRequest('pending-uid', '9876543210', 'Pending Member', 'en');
  const repeated = await registerViewerRequest('pending-uid', '+91 (98765) 43210', 'Changed Name', 'ta');

  assert.equal(repeated.created, false);
  assert.equal(repeated.status, 'pending');
  assert.equal(documents.get('viewerAccess/pending-uid').fullName, 'Pending Member');
  assert.equal(documents.size, 3);
});

test('approved members returning or choosing Sign Up do not create or reset a request', async () => {
  const {registerViewerRequest, lookupViewerAccessByPhone, canContinueWithApprovedSession, documents} = createViewerAccess();
  const request = {
    uid: 'approved-uid',
    fullName: 'Approved Member',
    normalizedMobileNumber: '+919876543210',
    status: 'approved',
    preferredLanguage: 'en'
  };
  documents.set('viewerAccess/approved-uid', request);
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'approved-uid', status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});

  const lookup = await lookupViewerAccessByPhone('approved-uid', '98765-43210');
  assert.equal(lookup.currentSession, true);
  assert.equal(canContinueWithApprovedSession('approved-uid', lookup.request, '+91 98765 43210'), true);

  const repeatedSignUp = await registerViewerRequest('approved-uid', '0091 98765 43210', 'Changed Name', 'ta');
  assert.equal(repeatedSignUp.status, 'approved');
  assert.equal(repeatedSignUp.created, false);
  assert.equal(documents.get('viewerAccess/approved-uid').status, 'approved');
  assert.equal(documents.get('viewerAccess/approved-uid').fullName, 'Approved Member');
  assert.equal(documents.size, 3);
});

test('a different session finds an approved number but cannot authenticate as its member', async () => {
  const {lookupViewerAccessByPhone, canContinueWithApprovedSession, documents} = createViewerAccess();
  documents.set('viewerAccess/approved-uid', {
    uid: 'approved-uid',
    fullName: 'Approved Member',
    normalizedMobileNumber: '+919876543210',
    status: 'approved',
    preferredLanguage: 'en'
  });
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'approved-uid', status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});

  const lookup = await lookupViewerAccessByPhone('new-device-uid', '+91 (98765) 43210');
  assert.equal(lookup.status, 'approved');
  assert.equal(lookup.currentSession, false);
  assert.equal(lookup.uid, '', 'Phone lookups must not expose another member UID.');
  assert.equal(canContinueWithApprovedSession('new-device-uid', lookup.request, '9876543210'), false);
});

test('revoked members cannot continue and repeated sign-up does not restore access', async () => {
  const {lookupViewerAccessByPhone, registerViewerRequest, canContinueWithApprovedSession, documents} = createViewerAccess();
  const request = {
    uid: 'revoked-uid',
    fullName: 'Revoked Member',
    normalizedMobileNumber: '+919876543210',
    status: 'revoked',
    preferredLanguage: 'en'
  };
  documents.set('viewerAccess/revoked-uid', request);
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'revoked-uid', status: 'revoked'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'revoked'});

  const lookup = await lookupViewerAccessByPhone('revoked-uid', '9876543210');
  assert.equal(lookup.status, 'revoked');
  assert.equal(canContinueWithApprovedSession('revoked-uid', lookup.request, '9876543210'), false);
  assert.equal((await registerViewerRequest('revoked-uid', '9876543210', 'Revoked Member', 'en')).status, 'revoked');
  assert.equal(documents.get('viewerAccess/revoked-uid').status, 'revoked');
});

test('different number formatting and simultaneous submissions create only one pending request', async () => {
  const {normalizePhoneNumber, registerViewerRequest, documents} = createViewerAccess();
  assert.equal(normalizePhoneNumber('+91 (98765) 43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('0091-98765-43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('91 98765 43210'), '+919876543210');

  const results = await Promise.all([
    registerViewerRequest('simultaneous-a', '9876543210', 'Member A', 'en'),
    registerViewerRequest('simultaneous-b', '+91 98765-43210', 'Member B', 'ta')
  ]);
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results.filter(result => result.status === 'pending').length, 2);
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerAccess/')).length, 1);
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').status, 'pending');
  assert.equal(documents.get('viewerPhoneStatus/+919876543210').status, 'pending');
});

test('a new session can only request owner-verified recovery and never gains access from the phone lookup', async () => {
  const {lookupViewerAccessByPhone, requestViewerRecovery, documents} = createViewerAccess();
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'approved-uid', status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});
  const lookup = await lookupViewerAccessByPhone('new-session', '+91 98765 43210');
  assert.equal(lookup?.status, 'approved');
  assert.equal(lookup?.currentSession, false);
  assert.equal(documents.has('viewerAccess/new-session'), false);

  const recovery = await requestViewerRecovery('new-session', '9876543210');
  assert.equal(recovery.status, 'pending');
  assert.equal(documents.get('viewerRecoveryRequests/new-session').status, 'pending');
  assert.equal(documents.has('viewerAccess/new-session'), false);
  const repeatedRecovery = await requestViewerRecovery('new-session', '+91 (98765) 43210');
  assert.equal(repeatedRecovery.created, false);
  assert.equal(repeatedRecovery.status, 'pending');
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerRecoveryRequests/')).length, 1);
});
