const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getPreferredLanguage,
  savePreferredLanguage,
  shouldRenderFamilyViewer
} = require('../src/services/websiteAccess.js');

test('website routing opens the family portal only on its route or for a viewer role', () => {
  assert.equal(shouldRenderFamilyViewer('/family', null), true);
  assert.equal(shouldRenderFamilyViewer('/family/', null), true);
  assert.equal(shouldRenderFamilyViewer('/', 'viewer'), true);
  assert.equal(shouldRenderFamilyViewer('/', 'owner'), false);
  assert.equal(shouldRenderFamilyViewer('/', null), false);
  assert.equal(shouldRenderFamilyViewer('/', null, true), true);
  assert.equal(shouldRenderFamilyViewer('/', 'owner', true), false);
});

test('preferred language persists across owner and family website visits', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };

  assert.equal(getPreferredLanguage(storage), null);
  savePreferredLanguage(storage, 'ta');
  assert.equal(getPreferredLanguage(storage), 'ta');
  assert.equal(values.get('ksk_family_language'), 'ta');
  savePreferredLanguage(storage, 'en');
  assert.equal(getPreferredLanguage(storage), 'en');
  assert.throws(() => savePreferredLanguage(storage, 'fr'), /Choose English or Tamil/);
});

test('owner login keeps email/password authentication and the owner membership gate', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  assert.match(app, /await signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(app, /membership\?\.projectId === 'ksk'/);
  assert.match(app, /assigned === 'owner' \|\| assigned === 'viewer'/);
  assert.match(app, /if \(role === 'owner'\) setScreen\('Settings'\)/);
});

test('signed-out website entry offers language, owner login, and family viewer login', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyViewer.tsx'), 'utf8');
  assert.match(app, /function WebsiteAccessScreen/);
  assert.match(app, /Preferred language/);
  assert.match(app, /t\('Owner Login'/);
  assert.match(app, /t\('Family Viewer Login'/);
  assert.match(app, /webEntry === 'choices'/);
  assert.match(viewer, /useState<'register' \| 'login'>\('login'\)/);
});
