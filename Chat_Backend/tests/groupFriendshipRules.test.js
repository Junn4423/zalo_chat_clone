import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGroupParticipantIds} from '../services/room.service.js';

const pairKey = (a, b) => JSON.stringify([String(a), String(b)].sort());

test('group creation includes the creator and accepted friend recipients', () => {
  const participants = validateGroupParticipantIds({
    memberIds: ['friend-a', 'friend-b'],
    createdBy: 'creator',
    acceptedPairKeys: [pairKey('creator', 'friend-a'), pairKey('creator', 'friend-b')],
  });

  assert.deepEqual(participants, ['friend-a', 'friend-b', 'creator']);
});

test('group creation rejects a recipient who is not an accepted friend', () => {
  assert.throws(
    () => validateGroupParticipantIds({
      memberIds: ['friend-a', 'stranger'],
      createdBy: 'creator',
      acceptedPairKeys: [pairKey('creator', 'friend-a')],
    }),
    error => error.status === 403 && /bạn bè đã kết bạn/.test(error.message),
  );
});

test('group creation requires two distinct friends besides the creator', () => {
  assert.throws(
    () => validateGroupParticipantIds({
      memberIds: ['friend-a', 'friend-a', 'creator'],
      createdBy: 'creator',
      acceptedPairKeys: [pairKey('creator', 'friend-a')],
    }),
    error => error.status === 400,
  );
});

