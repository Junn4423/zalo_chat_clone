import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequireHiddenRoomAccess} from '../services/hiddenChatAccess.js';
import {generateHiddenChatAccessToken} from '../src/token.js';

const responseStub = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('hidden room APIs allow visible rooms and require an unlock grant for hidden rooms', async () => {
  const middleware = createRequireHiddenRoomAccess({
    isHiddenRoom: async (_userId, roomId) => roomId === 'hidden-room',
  });
  let visibleNext = false;
  await middleware({userId: 'USER_A', params: {roomId: 'visible-room'}, headers: {}}, responseStub(), () => { visibleNext = true; });
  assert.equal(visibleNext, true);

  const denied = responseStub();
  let deniedNext = false;
  await middleware({userId: 'USER_A', params: {roomId: 'hidden-room'}, headers: {}}, denied, () => { deniedNext = true; });
  assert.equal(denied.statusCode, 423);
  assert.equal(deniedNext, false);
});

test('hidden room grants are account-bound and also protect message-ID routes', async () => {
  const middleware = createRequireHiddenRoomAccess({
    isHiddenRoom: async (_userId, roomId) => roomId === 'hidden-room',
    findRoomIdForMessage: async messageId => messageId === 'message-1' ? 'hidden-room' : null,
  });
  const token = generateHiddenChatAccessToken('USER_A');
  const allowed = responseStub();
  let allowedNext = false;
  await middleware({userId: 'USER_A', params: {messageId: 'message-1'}, headers: {'x-hidden-chat-token': token}}, allowed, () => { allowedNext = true; });
  assert.equal(allowedNext, true);

  const wrongAccount = responseStub();
  await middleware({userId: 'USER_B', params: {roomId: 'hidden-room'}, headers: {'x-hidden-chat-token': token}}, wrongAccount, () => {});
  assert.equal(wrongAccount.statusCode, 403);
});

test('hidden room guard checks upload queries and every room involved in forwarding', async () => {
  const hiddenIds = new Set(['hidden-source', 'hidden-target']);
  const middleware = createRequireHiddenRoomAccess({
    isHiddenRoom: async (_userId, roomId) => hiddenIds.has(roomId),
    findRoomIdForMessage: async () => 'hidden-source',
  });
  const deniedUpload = responseStub();
  await middleware({userId: 'USER_A', query: {roomId: 'hidden-source'}, headers: {}}, deniedUpload, () => {});
  assert.equal(deniedUpload.statusCode, 423);

  const deniedForward = responseStub();
  await middleware({
    userId: 'USER_A',
    params: {messageId: '507f1f77bcf86cd799439011'},
    body: {targetRoomId: 'hidden-target'},
    headers: {},
  }, deniedForward, () => {});
  assert.equal(deniedForward.statusCode, 423);
});

test('invalid hidden-chat grants are rejected before the protected controller', async () => {
  const middleware = createRequireHiddenRoomAccess({
    isHiddenRoom: async (_userId, roomId) => roomId === 'hidden-room',
  });
  const denied = responseStub();
  let nextCalled = false;
  await middleware({
    userId: 'USER_A',
    params: {roomId: 'hidden-room'},
    headers: {'x-hidden-chat-token': 'not-a-jwt'},
  }, denied, () => { nextCalled = true; });
  assert.equal(denied.statusCode, 423);
  assert.equal(nextCalled, false);
});
