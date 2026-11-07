const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

async function post(operation, body) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=demo-api-key`,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}
  );
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

test('family registration credential supports a returning password login with the same UID', async () => {
  const email = `family-${randomUUID()}@example.test`;
  const password = 'valid-test-password';
  const registered = await post('signUp', {email, password, returnSecureToken: true});
  assert.ok(registered.localId);
  assert.ok(registered.idToken);

  const returning = await post('signInWithPassword', {email, password, returnSecureToken: true});
  assert.equal(returning.localId, registered.localId);
  assert.ok(returning.idToken);
});

test('anonymous family session is authenticated and resolves to its same UID', async () => {
  const registered = await post('signUp', {returnSecureToken: true});
  assert.ok(registered.localId);
  assert.ok(registered.idToken);

  const lookup = await post('lookup', {idToken: registered.idToken});
  assert.equal(lookup.users[0].localId, registered.localId);
});
