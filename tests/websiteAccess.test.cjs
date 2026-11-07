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
  assert.equal(resolveProjectRole(null, {uid: 'viewer-uid', projectId: 'ksk', role: 'viewer', status: 'approved', approvalDate: 'approval'}, true, 'viewer-uid'), 'viewer');
  assert.equal(resolveProjectRole(null, {uid: 'viewer-uid', projectId: 'other', role: 'viewer', status: 'approved', approvalDate: 'approval'}, true, 'viewer-uid'), null);
  assert.equal(resolveProjectRole(null, {uid: 'viewer-uid', projectId: 'ksk', role: 'owner', status: 'approved', approvalDate: 'approval'}, true, 'viewer-uid'), null);
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

test('signed-out website offers a sign-in-only landing and a discreet owner link', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyViewer.tsx'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'viewerAccess.ts'), 'utf8');
  assert.doesNotMatch(app, /function WebsiteAccessScreen/);
  assert.match(app, /webEntry === 'choices'/);
  assert.match(app, /if \(webEntry === 'choices'\) return <FamilyViewer/);
  assert.match(viewer, /function AccessHome/);
  assert.match(viewer, /label=\{text\(language, 'Sign In'\)\}/);
  assert.match(viewer, /function AccessHeader/);
  assert.match(viewer, /text\(language, 'Owner Login'\)/);
  assert.match(viewer, /TextInput value=\{phone\}/);
  assert.doesNotMatch(viewer, /Sign Up|requestViewerRecovery|registerViewerRequest|Choose language/);
  assert.match(viewer, /Your number is not approved yet\. Please contact the admin\./);
  assert.match(viewer, /Your access has been revoked\. Please contact the admin\./);
  assert.match(viewer, /This number is not linked to this browser\./);
  assert.match(service, /getDocFromServer\(accessPath\(authenticatedUid\)\)/);
  assert.match(service, /if \(snapshot\.metadata\.fromCache\) return/);
  assert.doesNotMatch(viewer, /TextInput value=\{email\}/);
  assert.doesNotMatch(viewer, /TextInput value=\{password\}/);
  assert.match(viewer, /signInAnonymously\(auth\)/);
  assert.match(viewer, /setPersistence\(browserAuth, browserLocalPersistence\)/);
  assert.match(viewer, /canContinueWithApprovedSession\(requester\.uid, result\.request, normalizedPhone\)/);
  assert.match(viewer, /lookupViewerAccessByPhone\(requester\.uid, normalizedPhone\)/);
  assert.match(viewer, /setMobileConfirmed\(!!request && canContinueWithApprovedSession\(/);
  assert.doesNotMatch(viewer, /setMobileConfirmed\(false\);\s*\},\s*\[user\?\.uid,\s*access\?\.status/);
});

test('owner member management is limited to listing, adding, editing and deleting profiles', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyMemberManagement.tsx'), 'utf8');
  assert.match(app, /<FamilyMemberManagement ownerUid=\{user\.uid\}/);
  assert.match(manager, /addApprovedViewer/);
  assert.match(manager, /editViewerMember/);
  assert.match(manager, /deleteViewerAccount/);
  assert.match(manager, /subscribeViewerRequests/);
  assert.doesNotMatch(manager, /decideViewerAccess|decideViewerRecovery|subscribeViewerRecoveryRequests/);
  assert.doesNotMatch(manager, /t\('Approve'|t\('Reject'|t\('Recovery'/);
});
test('a saved approved family session restores directly to the dashboard without a sign-in loop', () => {
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'FamilyViewer.tsx'), 'utf8');
  const persistence = viewer.indexOf('setPersistence(browserAuth, browserLocalPersistence)');
  const authObserver = viewer.indexOf('onAuthStateChanged(browserAuth');
  const accessListener = viewer.indexOf("subscribeViewerRequest(user.uid");
  assert.ok(persistence >= 0 && persistence < authObserver, 'Local Auth persistence must be configured before restoring the saved user.');
  assert.ok(authObserver < accessListener, 'The saved Auth user must be followed by membership resolution.');
  assert.match(viewer, /setMobileConfirmed\(!!request && canContinueWithApprovedSession\(/);
  assert.match(viewer, /const canRead = !!user && \(legacyViewer \|\| \(access\?\.status === 'approved' && mobileConfirmed\)\)/);
  assert.match(viewer, /if \(user && accessMode === 'home' && \(!accessChecked \|\| !legacyCheckComplete\)\)/);
  assert.match(viewer, /return <FamilyData[\s\S]*?sheetsLoading \|\| !\(/);
  assert.match(viewer, /onSignOut=\{\(\) => \{\s*setMobileConfirmed\(false\);/);
});
