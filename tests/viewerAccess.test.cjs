const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createViewerAccess() {
  const documents = new Map();
  let timestamp = 0;
  let autoId = 0;
  let transactionQueue = Promise.resolve();
  const reference = (...parts) => {
    const refPath = parts.length === 1 && parts[0]?.path
      ? `${parts[0].path}/generated-${++autoId}`
      : parts.slice(1).join('/');
    return {path: refPath, id: refPath.split('/').pop()};
  };
  const snapshot = ref => {
    const data = documents.get(ref.path);
    return {exists: () => data !== undefined, data: () => data};
  };
  const commitWrites = writes => {
    for (const write of writes) {
      if (write.type === 'update' && !documents.has(write.ref.path)) throw new Error('Missing document');
      if (write.type === 'set' && write.ref.path.startsWith('viewerPhoneIndex/')
          && documents.has(write.ref.path)
          && documents.get(write.ref.path).uid !== write.data.uid) {
        const error = new Error('Phone number is already registered.');
        error.code = 'permission-denied';
        throw error;
      }
    }
    for (const write of writes) {
      if (write.type === 'delete') documents.delete(write.ref.path);
      else documents.set(write.ref.path, {
        ...(write.type === 'update' ? documents.get(write.ref.path) : {}),
        ...write.data
      });
    }
  };
  const firestore = new Proxy({
    doc: reference,
    collection: (...parts) => ({path: parts.slice(1).join('/')}),
    where: (field, operator, value) => ({field, operator, value}),
    limit: count => ({limit: count}),
    query: (ref, ...constraints) => ({path: ref.path, constraints}),
    serverTimestamp: () => `server-time-${++timestamp}`,
    getDoc: async ref => snapshot(ref),
    getDocFromServer: async ref => snapshot(ref),
    getDocs: async queryRef => {
      const filters = queryRef.constraints?.filter(item => item.field) || [];
      let docs = [...documents.entries()]
        .filter(([key]) => key.startsWith(`${queryRef.path}/`))
        .filter(([, data]) => filters.every(filter => data[filter.field] === filter.value))
        .map(([key, data]) => ({id: key.split('/').pop(), ref: {path: key}, data: () => data}));
      const max = queryRef.constraints?.find(item => item.limit)?.limit;
      if (max) docs = docs.slice(0, max);
      return {docs, empty: docs.length === 0, size: docs.length};
    },
    updateDoc: async (ref, data) => {
      if (!documents.has(ref.path)) throw new Error('Missing document');
      documents.set(ref.path, {...documents.get(ref.path), ...data});
    },
    writeBatch: () => {
      const writes = [];
      return {
        set: (ref, data) => writes.push({type: 'set', ref, data}),
        update: (ref, data) => writes.push({type: 'update', ref, data}),
        delete: ref => writes.push({type: 'delete', ref}),
        commit: async () => commitWrites(writes)
      };
    },
    runTransaction: async (_database, callback) => {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise(resolve => { release = resolve; });
      await previous;
      const writes = [];
      const transaction = {
        get: async ref => snapshot(ref),
        set: (ref, data) => writes.push({type: 'set', ref, data}),
        update: (ref, data) => writes.push({type: 'update', ref, data}),
        delete: ref => writes.push({type: 'delete', ref})
      };
      try {
        const result = await callback(transaction);
        commitWrites(writes);
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
  assert.equal([...documents.values()].filter(item => item.action === 'registered').length, 1);
});

test('a pending member submitting again is idempotent and keeps pending status', async () => {
  const {registerViewerRequest, documents} = createViewerAccess();
  await registerViewerRequest('pending-uid', '9876543210', 'Pending Member', 'en');
  const repeated = await registerViewerRequest('pending-uid', '+91 (98765) 43210', 'Changed Name', 'ta');

  assert.equal(repeated.created, false);
  assert.equal(repeated.status, 'pending');
  assert.equal(documents.get('viewerAccess/pending-uid').fullName, 'Pending Member');
  assert.equal(documents.size, 4);
});

test('signup approval enables first and later logins without another approval', async () => {
  const {registerViewerRequest, decideViewerAccess, lookupViewerAccessByPhone, canContinueWithApprovedSession, documents} = createViewerAccess();
  const registration = await registerViewerRequest('persistent-uid', '9876543210', 'Persistent Member', 'en');
  assert.equal(registration.status, 'pending');
  assert.equal(canContinueWithApprovedSession('persistent-uid', documents.get('viewerAccess/persistent-uid'), '9876543210'), false);

  await decideViewerAccess(documents.get('viewerAccess/persistent-uid'), 'approved', 'owner');
  const firstLogin = await lookupViewerAccessByPhone('persistent-uid', '+91 (98765) 43210');
  assert.equal(firstLogin.status, 'approved');
  assert.equal(canContinueWithApprovedSession('persistent-uid', firstLogin.request, '+919876543210'), true);

  const laterLogin = await lookupViewerAccessByPhone('persistent-uid', '0091-98765-43210');
  assert.equal(laterLogin.status, 'approved');
  assert.equal(canContinueWithApprovedSession('persistent-uid', laterLogin.request, '9876543210'), true);
  assert.equal((await registerViewerRequest('persistent-uid', '+91 98765 43210', 'Changed Name', 'ta')).created, false);
  assert.equal(documents.get('viewerAccess/persistent-uid').status, 'approved');
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerAccess/')).length, 1);
});

test('approved members returning or choosing Sign Up do not create or reset a request', async () => {
  const {registerViewerRequest, lookupViewerAccessByPhone, canContinueWithApprovedSession, documents} = createViewerAccess();
  const request = {
    uid: 'approved-uid',
    fullName: 'Approved Member',
    normalizedMobileNumber: '+919876543210',
    status: 'approved',
    preferredLanguage: 'en',
    approvalDate: 'approval-time',
    projectId: 'ksk',
    role: 'viewer'
  };
  documents.set('viewerAccess/approved-uid', request);
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'approved-uid', status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});

  const lookup = await lookupViewerAccessByPhone('approved-uid', '98765-43210');
  assert.equal(lookup.currentSession, true);
  assert.equal(canContinueWithApprovedSession('approved-uid', lookup.request, '+91 98765 43210'), true);
  assert.equal(canContinueWithApprovedSession('approved-uid', {...lookup.request, role: 'owner'}, '+919876543210'), false);
  assert.equal(canContinueWithApprovedSession('approved-uid', {...lookup.request, projectId: 'other'}, '+919876543210'), false);
  assert.equal(canContinueWithApprovedSession('approved-uid', {...lookup.request, approvalDate: undefined}, '+919876543210'), false);

  const repeatedSignUp = await registerViewerRequest('approved-uid', '0091 98765 43210', 'Changed Name', 'ta');
  assert.equal(repeatedSignUp.status, 'approved');
  assert.equal(repeatedSignUp.created, false);
  assert.equal(documents.get('viewerAccess/approved-uid').status, 'approved');
  assert.equal(documents.get('viewerAccess/approved-uid').fullName, 'Approved Member');
  assert.equal(documents.size, 3);
});

test('approved membership takes precedence over an old pending recovery request', async () => {
  const {lookupViewerAccessByPhone, requestViewerRecovery, canContinueWithApprovedSession, documents} = createViewerAccess();
  const member = {
    uid: 'approved-session',
    fullName: 'Approved Member',
    normalizedMobileNumber: '+919876543210',
    status: 'approved',
    preferredLanguage: 'en',
    projectId: 'ksk',
    role: 'viewer',
    approvalDate: 'approval-time'
  };
  documents.set('viewerAccess/approved-session', member);
  documents.set('viewerPhoneIndex/+919876543210', {uid: member.uid, status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});
  documents.set('viewerRecoveryRequests/approved-session', {
    uid: member.uid,
    normalizedMobileNumber: '+91 (98765) 43210',
    status: 'pending'
  });

  const lookup = await lookupViewerAccessByPhone(member.uid, '0091 98765 43210');
  assert.equal(lookup.status, 'approved');
  assert.equal(canContinueWithApprovedSession(member.uid, lookup.request, '+91 98765 43210'), true);

  const recovery = await requestViewerRecovery(member.uid, '9876543210');
  assert.equal(recovery.status, 'approved');
  assert.equal(recovery.currentSession, true);
  assert.equal(recovery.request.status, 'approved');
  assert.equal(canContinueWithApprovedSession(member.uid, recovery.request, '+919876543210'), true);
  assert.equal(documents.get('viewerRecoveryRequests/approved-session').status, 'pending');
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerRecoveryRequests/')).length, 1);
});

test('owner can add an approved invitation without granting access to a phone-only session', async () => {
  const {addApprovedViewer, lookupViewerAccessByPhone, documents} = createViewerAccess();
  const invite = await addApprovedViewer('Invited Member', '9876543210', 'owner', 'ta');

  assert.equal(invite.status, 'approved');
  assert.equal(invite.manualInvite, true);
  assert.equal(invite.normalizedMobileNumber, '+919876543210');
  assert.equal(documents.get(`viewerAccess/${invite.uid}`).approverUid, 'owner');
  assert.equal(documents.get(`viewerAccess/${invite.uid}`).projectId, 'ksk');
  assert.equal(documents.get(`viewerAccess/${invite.uid}`).role, 'viewer');
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').uid, invite.uid);
  assert.equal(documents.get('viewerPhoneStatus/+919876543210').status, 'approved');
  assert.equal(documents.get('viewerAccessHistory/generated-2').action, 'approved');
  assert.equal(await lookupViewerAccessByPhone('fresh-session', '9876543210'), null);
});

test('manual member addition rejects duplicate phone numbers and invalid details', async () => {
  const {addApprovedViewer, documents} = createViewerAccess();
  await addApprovedViewer('First Member', '9876543210', 'owner', 'en');

  await assert.rejects(
    addApprovedViewer('Second Member', '+91 98765 43210', 'owner', 'en'),
    /already has a member or invitation/
  );
  await assert.rejects(addApprovedViewer(' ', '9876543211', 'owner', 'en'), /full name/);
  await assert.rejects(addApprovedViewer('Another Member', 'invalid', 'owner', 'en'), /mobile number/);
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerAccess/')).length, 1);
});

test('owner edits member details atomically and refuses duplicate mobile numbers', async () => {
  const {addApprovedViewer, editViewerMember, documents} = createViewerAccess();
  const member = await addApprovedViewer('First Member', '9876543210', 'owner', 'en');
  await addApprovedViewer('Second Member', '9876543212', 'owner', 'en');

  await editViewerMember(member, 'Updated Member', '09876543211', 'owner');
  assert.equal(documents.get(`viewerAccess/${member.uid}`).fullName, 'Updated Member');
  assert.equal(documents.get(`viewerAccess/${member.uid}`).normalizedMobileNumber, '+919876543211');
  assert.equal(documents.has('viewerPhoneIndex/+919876543210'), false);
  assert.equal(documents.has('viewerPhoneStatus/+919876543210'), false);
  assert.equal(documents.get('viewerPhoneIndex/+919876543211').uid, member.uid);
  assert.equal(documents.get('viewerPhoneStatus/+919876543211').status, 'approved');

  await assert.rejects(
    editViewerMember(documents.get(`viewerAccess/${member.uid}`), 'Updated Member', '9876543212', 'owner'),
    /already belongs to another member/
  );
  assert.equal(documents.get(`viewerAccess/${member.uid}`).normalizedMobileNumber, '+919876543211');
});

test('owner can attach a number to an existing legacy viewer UID without changing its identity', async () => {
  const {editViewerMember, documents} = createViewerAccess();
  documents.set('users/legacy-viewer', {projectId: 'ksk', role: 'viewer', displayName: 'Legacy Viewer'});
  const legacy = {
    uid: 'legacy-viewer',
    fullName: 'Legacy Viewer',
    normalizedMobileNumber: '',
    status: 'approved',
    preferredLanguage: 'en',
    legacy: true
  };

  await editViewerMember(legacy, 'Updated Legacy Viewer', '9876543210', 'owner');
  const member = documents.get('viewerAccess/legacy-viewer');
  assert.equal(member.uid, 'legacy-viewer');
  assert.equal(member.fullName, 'Updated Legacy Viewer');
  assert.equal(member.normalizedMobileNumber, '+919876543210');
  assert.equal(member.status, 'approved');
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').uid, 'legacy-viewer');
});

test('a different session cannot enumerate another member through phone status lookup', async () => {
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
  assert.equal(lookup, null, 'Phone-only lookups must not expose whether another number is approved.');
  assert.equal(canContinueWithApprovedSession('new-device-uid', null, '9876543210'), false);
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

test('local and international formats normalize consistently without merging distinct numbers', async () => {
  const {normalizePhoneNumber, registerViewerRequest, documents} = createViewerAccess();
  assert.equal(normalizePhoneNumber('9876543210'), '+919876543210');
  assert.equal(normalizePhoneNumber('09876543210'), '+919876543210');
  assert.equal(normalizePhoneNumber('+91 09876543210'), '+919876543210');
  assert.equal(normalizePhoneNumber('+91 (98765) 43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('0091-98765-43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('91 98765 43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('+1 (202) 555-0100'), '+12025550100');
  assert.equal(normalizePhoneNumber('12025550100'), '+12025550100');
  assert.notEqual(normalizePhoneNumber('9876543210'), normalizePhoneNumber('+1 9876543210'));
  assert.equal(normalizePhoneNumber('9876543210 ext 1'), '');
  assert.equal(normalizePhoneNumber('12345'), '');

  const results = await Promise.all([
    registerViewerRequest('simultaneous-a', '9876543210', 'Member A', 'en').then(value => ({status: 'fulfilled', value}), error => ({status: 'rejected', error})),
    registerViewerRequest('simultaneous-b', '+91 98765-43210', 'Member B', 'ta').then(value => ({status: 'fulfilled', value}), error => ({status: 'rejected', error}))
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal([...documents.keys()].filter(key => key.startsWith('viewerAccess/')).length, 1);
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').status, 'pending');
  assert.equal(documents.get('viewerPhoneStatus/+919876543210').status, 'pending');
});

test('a new session can only request owner-verified recovery and never gains access from the phone lookup', async () => {
  const {lookupViewerAccessByPhone, requestViewerRecovery, documents} = createViewerAccess();
  documents.set('viewerPhoneIndex/+919876543210', {uid: 'approved-uid', status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});
  const lookup = await lookupViewerAccessByPhone('new-session', '+91 98765 43210');
  assert.equal(lookup, null);
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

test('clearing request history removes eligible records and archives the clear without changing approved access', async () => {
  const {clearViewerRequestHistory, canContinueWithApprovedSession, documents} = createViewerAccess();
  const addAccess = (uid, phone, status) => {
    documents.set(`viewerAccess/${uid}`, {
      uid,
      fullName: uid,
      normalizedMobileNumber: phone,
      status,
      preferredLanguage: 'en'
    });
    documents.set(`viewerPhoneIndex/${phone}`, {uid, status});
    documents.set(`viewerPhoneStatus/${phone}`, {status});
    return documents.get(`viewerAccess/${uid}`);
  };
  const pending = addAccess('pending-member', '+919876543210', 'pending');
  const rejected = addAccess('rejected-member', '+919876543211', 'rejected');
  const approved = addAccess('approved-member', '+919876543212', 'approved');
  const revoked = addAccess('revoked-member', '+919876543213', 'revoked');
  approved.approvalDate = 'approval-time';
  documents.set('viewerRecoveryRequests/recovery-pending', {
    uid: 'recovery-pending',
    normalizedMobileNumber: '+919876543212',
    status: 'pending'
  });
  documents.set('viewerRecoveryRequests/recovery-restored', {
    uid: 'recovery-restored',
    normalizedMobileNumber: '+919876543212',
    status: 'restored'
  });

  const cleared = await clearViewerRequestHistory([
    {kind: 'access', request: pending},
    {kind: 'access', request: rejected},
    {kind: 'access', request: approved},
    {kind: 'access', request: revoked},
    {kind: 'recovery', request: {uid: 'recovery-pending', status: 'pending'}},
    {kind: 'recovery', request: {uid: 'recovery-restored', status: 'restored'}}
  ], 'owner');

  assert.equal(cleared, 4);
  for (const [uid, phone] of [
    ['pending-member', '+919876543210'],
    ['rejected-member', '+919876543211']
  ]) {
    assert.equal(documents.has(`viewerAccess/${uid}`), false);
    assert.equal(documents.has(`viewerPhoneIndex/${phone}`), false);
    assert.equal(documents.has(`viewerPhoneStatus/${phone}`), false);
  }
  assert.equal(documents.has('viewerRecoveryRequests/recovery-pending'), false);
  assert.equal(documents.has('viewerRecoveryRequests/recovery-restored'), false);
  assert.equal(documents.get('viewerAccess/approved-member').status, 'approved');
  assert.equal(documents.get('viewerAccess/approved-member').approvalDate, 'approval-time');
  assert.equal(documents.get('viewerPhoneIndex/+919876543212').status, 'approved');
  assert.equal(documents.get('viewerPhoneStatus/+919876543212').status, 'approved');
  assert.equal(canContinueWithApprovedSession('approved-member', documents.get('viewerAccess/approved-member'), '+919876543212'), true);
  assert.equal(documents.get('viewerAccess/revoked-member').status, 'revoked');
  assert.equal(documents.get('viewerPhoneIndex/+919876543213').status, 'revoked');
  assert.equal([...documents.values()].filter(item => item.action === 'history_cleared').length, 4);
});

test('owner decisions approve, reject and revoke while preserving transition history', async () => {
  const {decideViewerAccess, documents} = createViewerAccess();
  const addPending = (uid, phone) => {
    const request = {uid, fullName: uid, normalizedMobileNumber: phone, status: 'pending', preferredLanguage: 'en'};
    documents.set(`viewerAccess/${uid}`, request);
    documents.set(`viewerPhoneIndex/${phone}`, {uid, status: 'pending'});
    documents.set(`viewerPhoneStatus/${phone}`, {status: 'pending'});
    return request;
  };
  const approve = addPending('approval-test', '+919876543210');
  await decideViewerAccess(approve, 'approved', 'owner');
  assert.equal(documents.get('viewerAccess/approval-test').status, 'approved');
  assert.equal(documents.get('viewerAccess/approval-test').projectId, 'ksk');
  assert.equal(documents.get('viewerAccess/approval-test').role, 'viewer');
  assert.ok(documents.get('viewerAccess/approval-test').approvalDate);
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').status, 'approved');
  await assert.rejects(
    decideViewerAccess(documents.get('viewerAccess/approval-test'), 'approved', 'owner'),
    /can no longer be decided/
  );
  await decideViewerAccess(documents.get('viewerAccess/approval-test'), 'revoked', 'owner');
  assert.equal(documents.get('viewerAccess/approval-test').status, 'revoked');
  assert.equal(documents.get('viewerAccess/approval-test').projectId, 'ksk');
  assert.equal(documents.get('viewerAccess/approval-test').role, 'viewer');
  assert.equal(documents.get('viewerPhoneIndex/+919876543210').status, 'revoked');

  const reject = addPending('reject-test', '+919876543211');
  await decideViewerAccess(reject, 'rejected', 'owner');
  assert.equal(documents.get('viewerAccess/reject-test').status, 'rejected');
  assert.deepEqual(
    [...documents.values()].filter(item => item.uid === 'approval-test' || item.uid === 'reject-test').map(item => item.action).filter(Boolean).sort(),
    ['approved', 'rejected', 'revoked']
  );
});

test('Delete Account removes only eligible viewer access and device records, retaining a deletion audit and Auth identity', async () => {
  const {deleteViewerAccount, documents} = createViewerAccess();
  const member = {
    uid: 'deleted-viewer',
    fullName: 'Deleted Viewer',
    normalizedMobileNumber: '+919876543210',
    status: 'approved',
    preferredLanguage: 'en',
    approvalDate: 'approval-time'
  };
  documents.set('viewerAccess/deleted-viewer', member);
  documents.set('viewerPhoneIndex/+919876543210', {uid: member.uid, status: 'approved'});
  documents.set('viewerPhoneStatus/+919876543210', {status: 'approved'});
  documents.set('users/deleted-viewer', {projectId: 'ksk', role: 'viewer', fullName: member.fullName});
  documents.set('viewerRecoveryRequests/deleted-viewer', {uid: member.uid, normalizedMobileNumber: member.normalizedMobileNumber, status: 'rejected'});
  documents.set('users/deleted-viewer/devices/device-token', {token: 'private'});
  documents.set('projects/ksk/login_history/session-1', {userId: member.uid, role: 'viewer'});
  documents.set('projects/ksk/payments/keep-project-record', {amount: 100});

  const result = await deleteViewerAccount(member, 'owner');

  assert.equal(result.authAccountDeleted, false);
  assert.equal(result.deviceHistoryCount, 1);
  for (const path of [
    'viewerAccess/deleted-viewer',
    'viewerPhoneIndex/+919876543210',
    'viewerPhoneStatus/+919876543210',
    'viewerRecoveryRequests/deleted-viewer',
    'users/deleted-viewer',
    'users/deleted-viewer/devices/device-token',
    'projects/ksk/login_history/session-1'
  ]) assert.equal(documents.has(path), false, `${path} should be removed`);
  assert.equal(documents.has('projects/ksk/payments/keep-project-record'), true);
  assert.equal(documents.get('viewerAccountDeletions/deleted-viewer').actorUid, 'owner');
  assert.equal([...documents.values()].some(item => item.action === 'account_deleted' && item.previousStatus === 'approved'), true);
});

test('Delete Account refuses the owner UID', async () => {
  const {deleteViewerAccount} = createViewerAccess();
  await assert.rejects(
    deleteViewerAccount({uid: 'owner', fullName: 'Owner', status: 'approved'}, 'owner'),
    /owner account cannot be deleted/i
  );
});
