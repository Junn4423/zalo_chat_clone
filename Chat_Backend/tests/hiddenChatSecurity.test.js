import test from 'node:test';
import assert from 'node:assert/strict';
import {hashHiddenChatPin, isValidHiddenChatPin, verifyHiddenChatPin} from '../services/hiddenChatSecurity.js';
import {generateHiddenChatAccessToken, verifyHiddenChatAccessToken} from '../src/token.js';
import {requireHiddenChatAccess} from '../middleware/auth.middleware.js';

test('hidden-chat PINs are stored as salted scrypt hashes', async () => {
  const first = await hashHiddenChatPin('0427');
  const second = await hashHiddenChatPin('0427');
  assert.notEqual(first, second);
  assert.match(first, /^v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyHiddenChatPin('0427', first), true);
  assert.equal(await verifyHiddenChatPin('1427', first), false);
});

test('hidden-chat PIN validation rejects non-four-digit codes and malformed hashes', async () => {
  assert.equal(isValidHiddenChatPin('0427'), true);
  assert.equal(isValidHiddenChatPin('427'), false);
  assert.equal(isValidHiddenChatPin('42a7'), false);
  assert.equal(await verifyHiddenChatPin('0427', 'not-a-hash'), false);
  await assert.rejects(hashHiddenChatPin('12345'), /4 chữ số/);
});

test('hidden-chat unlock grants are time-limited, scoped, and bound to the account', () => {
  const token = generateHiddenChatAccessToken('USER_A');
  const decoded = verifyHiddenChatAccessToken(token);
  assert.equal(decoded.id, 'USER_A');
  assert.equal(decoded.scope, 'hidden_chat');
  assert.ok(decoded.exp - decoded.iat <= 600);

  const response = {statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }};
  let nextCalled = false;
  requireHiddenChatAccess({headers: {'x-hidden-chat-token': token}, userId: 'USER_A'}, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const wrongAccountResponse = {statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }};
  requireHiddenChatAccess({headers: {'x-hidden-chat-token': token}, userId: 'USER_B'}, wrongAccountResponse, () => {});
  assert.equal(wrongAccountResponse.statusCode, 403);
});

