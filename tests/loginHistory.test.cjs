const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createLoginHistory() {
  const documents = new Map();
  let autoId = 0;
  const doc = (...parts) => ({path: parts.slice(1).join('/')});
  const collection = (...parts) => ({path: parts.slice(1).join('/')});
  const query = (ref, ...constraints) => ({path: ref.path, constraints});
  const firestore = {
    addDoc: async (ref, data) => {
      const id = `generated-${++autoId}`;
      const created = {id, path: `${ref.path}/${id}`};
      documents.set(created.path, {...data});
      return created;
    },
    collection,
    doc,
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
    limit: count => ({limit: count}),
    onSnapshot: () => () => {},
    orderBy: (field, direction) => ({field, direction}),
    query,
    serverTimestamp: () => 'server-time',
    updateDoc: async (ref, data) => {
      if (!documents.has(ref.path)) throw new Error('Missing document');
      documents.set(ref.path, {...documents.get(ref.path), ...data});
    },
    where: (field, operator, value) => ({field, operator, value}),
    writeBatch: () => {
      const writes = [];
      return {
        delete: ref => writes.push({type: 'delete', ref}),
        update: (ref, data) => writes.push({type: 'update', ref, data}),
        commit: async () => {
          for (const write of writes) {
            if (write.type === 'delete') documents.delete(write.ref.path);
            else {
              if (!documents.has(write.ref.path)) throw new Error('Missing document');
              documents.set(write.ref.path, {...documents.get(write.ref.path), ...write.data});
            }
          }
        }
      };
    }
  };
  const storageValues = new Map([['ksk.house.installation-id.v1', 'owner-installation']]);
  const asyncStorage = {
    getItem: async key => storageValues.get(key) || null,
    setItem: async (key, value) => storageValues.set(key, value)
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'loginHistory.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports: {}};
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      if (name === '@react-native-async-storage/async-storage') return {__esModule: true, default: asyncStorage};
      if (name === 'expo-device') return {};
      if (name === 'react-native') return {Platform: {OS: 'web'}};
      if (name === 'firebase/firestore') return firestore;
      if (name === 'firebase/auth') return {};
      if (name === '../firebase') return {auth: {currentUser: {uid: 'owner'}}, db: {}};
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return {...module.exports, documents};
}

test('clearing selected device history removes only selected session records', async () => {
  const {clearLoginHistoryEntries, documents} = createLoginHistory();
  documents.set('projects/ksk/login_history/selected', {userId: 'viewer-a'});
  documents.set('projects/ksk/login_history/other', {userId: 'viewer-b'});
  documents.set('viewerAccess/viewer-a', {status: 'approved'});
  documents.set('projects/ksk/payments/keep-project-data', {amount: 10});

  assert.equal(await clearLoginHistoryEntries(['selected']), 1);
  assert.equal(documents.has('projects/ksk/login_history/selected'), false);
  assert.equal(documents.has('projects/ksk/login_history/other'), true);
  assert.equal(documents.get('viewerAccess/viewer-a').status, 'approved');
  assert.equal(documents.has('projects/ksk/payments/keep-project-data'), true);
});

test('clear all device history preserves the current owner installation and member access', async () => {
  const {clearLoginHistory, documents} = createLoginHistory();
  documents.set('projects/ksk/login_history/current-owner', {userId: 'owner', installationId: 'owner-installation'});
  documents.set('projects/ksk/login_history/old-owner', {userId: 'owner', installationId: 'old-installation'});
  documents.set('projects/ksk/login_history/viewer', {userId: 'viewer', installationId: 'viewer-installation'});
  documents.set('viewerAccess/viewer', {status: 'approved'});

  assert.equal(await clearLoginHistory(), 2);
  assert.equal(documents.has('projects/ksk/login_history/current-owner'), true);
  assert.equal(documents.has('projects/ksk/login_history/old-owner'), false);
  assert.equal(documents.has('projects/ksk/login_history/viewer'), false);
  assert.equal(documents.get('viewerAccess/viewer').status, 'approved');
});

test('login history records close as ended without changing project membership', async () => {
  const {createLoginHistorySession, documents} = createLoginHistory();
  const session = await createLoginHistorySession({uid: 'viewer', email: '', displayName: 'Viewer'}, 'viewer');
  const sessionPath = `projects/ksk/login_history/${session.id}`;
  assert.equal(documents.get(sessionPath).status, 'active');
  await session.end();
  assert.equal(documents.get(sessionPath).status, 'ended');
  assert.ok(documents.get(sessionPath).endedAt);
});
