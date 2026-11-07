const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getPreferredLanguage,
  resolveProjectRole,
  savePreferredLanguage,
  shouldRenderFamilyViewer
} = require('../src/services/websiteAccess.js');

test('website routing opens the family portal only on its route or for a viewer role', () => {
  assert.equal(shouldRenderFamilyViewer('/family', null), true);
  assert.equal(shouldRenderFamilyViewer('/family/', null), true);
  assert.equal(shouldRenderFamilyViewer('/family', 'owner', true), false);
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

test('approved viewer UID resolves to viewer role and revoked access never falls back to legacy membership', () => {
  assert.equal(resolveProjectRole(null, {uid: 'viewer-uid', status: 'approved', approvalDate: 'approval'}, true, 'viewer-uid'), 'viewer');
  assert.equal(resolveProjectRole(null, {uid: 'other-uid', status: 'approved', approvalDate: 'approval'}, true, 'viewer-uid'), null);
  assert.equal(resolveProjectRole(null, {uid: 'viewer-uid', status: 'approved'}, true, 'viewer-uid'), null);
  assert.equal(resolveProjectRole({projectId: 'ksk', role: 'viewer'}, null, false, 'viewer-uid'), 'viewer');
  assert.equal(resolveProjectRole({projectId: 'ksk', role: 'viewer'}, {uid: 'viewer-uid', status: 'revoked'}, true, 'viewer-uid'), null);
  assert.equal(resolveProjectRole({projectId: 'ksk', role: 'owner'}, {uid: 'owner', status: 'revoked'}, true, 'owner'), 'owner');
  assert.equal(resolveProjectRole({projectId: 'other', role: 'owner'}, null, false, 'owner'), null);
});

test('owner login keeps email/password authentication and the owner membership gate', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  assert.match(app, /await signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(app, /resolveProjectRole\(membership, access, accessExists, user\.uid\)/);
  assert.match(app, /onSnapshot\(doc\(db, 'viewerAccess', user\.uid\)/);
  assert.match(app, /if \(role === 'owner'\) setScreen\('Settings'\)/);
});

test('signed-out website offers separate sign-in and sign-up with a discreet owner link', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyViewer.tsx'), 'utf8');
  assert.doesNotMatch(app, /function WebsiteAccessScreen/);
  assert.match(app, /webEntry === 'choices'/);
  assert.match(app, /if \(webEntry === 'choices'\) return <FamilyViewer/);
  assert.match(viewer, /function AccessHome/);
  assert.match(viewer, /label=\{text\(language, 'Sign In'\)\}/);
  assert.match(viewer, /label=\{text\(language, 'Sign Up'\)/);
  assert.match(viewer, /function AccessHeader/);
  assert.match(viewer, /text\(language, 'Owner Login'\)/);
  assert.match(viewer, /mode === 'sign-up'/);
  assert.match(viewer, /TextInput value=\{fullName\}/);
  assert.match(viewer, /TextInput value=\{phone\}/);
  assert.doesNotMatch(viewer, /TextInput value=\{email\}/);
  assert.doesNotMatch(viewer, /TextInput value=\{password\}/);
  assert.match(viewer, /signInAnonymously\(auth\)/);
  assert.match(viewer, /setPersistence\(browserAuth, browserLocalPersistence\)/);
  assert.match(viewer, /canContinueWithApprovedSession\(requester\.uid, result\.request, normalizedPhone\)/);
  assert.match(viewer, /Your registration is awaiting owner approval\./);
  assert.match(viewer, /lookupViewerAccessByPhone\(requester\.uid, normalizedPhone\)/);
  assert.match(viewer, /requestViewerRecovery\(requester\.uid, normalizedPhone\)/);
  assert.match(viewer, /setMobileConfirmed\(request\?\.status === 'approved'\)/);
  assert.doesNotMatch(viewer, /setMobileConfirmed\(false\);\s*\},\s*\[user\?\.uid,\s*access\?\.status/);
  assert.match(viewer, /if \(recovery\.status === 'pending'\) setMessage/);
});
