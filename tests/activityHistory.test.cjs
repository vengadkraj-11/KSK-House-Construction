const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createActivityHistory({failOnCommit = 0} = {}) {
  const documents = new Map();
  let commits = 0;
  const collection = (_database, ...parts) => ({path: parts.join('/')});
  const query = (reference, ...constraints) => ({path: reference.path, constraints});
  const firestore = {
    collection,
    getDocsFromServer: async queryRef => {
      const max = queryRef.constraints.find(item => item.limit)?.limit;
      const docs = [...documents.entries()]
        .filter(([key]) => key.startsWith(`${queryRef.path}/`) && !key.slice(queryRef.path.length + 1).includes('/'))
        .slice(0, max)
        .map(([key]) => ({ref: {path: key}}));
      return {docs, empty: docs.length === 0, size: docs.length};
    },
    limit: count => ({limit: count}),
    query,
    writeBatch: () => {
      const writes = [];
      return {
        delete: ref => writes.push(ref),
        commit: async () => {
          commits += 1;
          if (commits === failOnCommit) throw new Error('simulated batch failure');
          writes.forEach(ref => documents.delete(ref.path));
        }
      };
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'projectSync.ts'), 'utf8');
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
      if (name === '../data') return {};
      throw new Error(`Unexpected module: ${name}`);
    }
  });
  return {...module.exports, documents};
}

test('activity clear paginates batches and preserves project and login history', async () => {
  const {clearActivityHistory, documents} = createActivityHistory();
  for (let index = 0; index < 451; index += 1) {
    documents.set(`projects/ksk/activity/event-${index}`, {title: `Event ${index}`});
  }
  documents.set('projects/ksk/payments/keep-payment', {amount: 10});
  documents.set('projects/ksk/login_history/keep-session', {userId: 'owner'});

  assert.equal(await clearActivityHistory(), 451);
  assert.equal([...documents.keys()].filter(key => key.startsWith('projects/ksk/activity/')).length, 0);
  assert.equal(documents.has('projects/ksk/payments/keep-payment'), true);
  assert.equal(documents.has('projects/ksk/login_history/keep-session'), true);
});

test('empty activity history clears successfully with an accurate zero count', async () => {
  const {clearActivityHistory} = createActivityHistory();
  assert.equal(await clearActivityHistory(), 0);
});

test('a later batch failure reports completed deletions and preserves unrelated records', async () => {
  const {clearActivityHistory, ActivityHistoryClearError, documents} = createActivityHistory({failOnCommit: 2});
  for (let index = 0; index < 451; index += 1) {
    documents.set(`projects/ksk/activity/event-${index}`, {title: `Event ${index}`});
  }
  documents.set('projects/ksk/payments/keep-payment', {amount: 10});

  await assert.rejects(clearActivityHistory(), error => {
    assert.ok(error instanceof ActivityHistoryClearError);
    assert.equal(error.deletedCount, 450);
    assert.match(error.message, /simulated batch failure/);
    return true;
  });
  assert.equal([...documents.keys()].filter(key => key.startsWith('projects/ksk/activity/')).length, 1);
  assert.equal(documents.has('projects/ksk/payments/keep-payment'), true);
});
