import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGroupPoll, serializeGroupPoll, serializeGroupPollDetails, recalculatePollCounts} from '../services/groupPoll.service.js';

test('normalizes poll content and supports Zalo-style privacy/settings', () => {
  const poll = normalizeGroupPoll({
    question: '  Ăn gì trưa nay? ',
    options: [' Phở ', 'Cơm'],
    allowMultiple: true,
    allowAddOptions: true,
    anonymous: true,
    hideResultsUntilVote: true,
  }, 'qa-user', new Date('2026-11-27T00:00:00.000Z'));

  assert.equal(poll.question, 'Ăn gì trưa nay?');
  assert.equal(poll.options.length, 2);
  assert.ok(poll.options.every(option => option.voteCount === 0 && option.id));
  assert.equal(poll.allowMultiple, true);
  assert.equal(poll.allowAddOptions, true);
  assert.equal(poll.anonymous, true);
  assert.equal(poll.createdBy, 'qa-user');
});

test('rejects duplicate options and expired/overlong poll deadlines', () => {
  assert.throws(() => normalizeGroupPoll({question: 'Q?', options: ['Yes', ' yes ']}, 'qa'), /không được trùng/);
  assert.throws(() => normalizeGroupPoll({question: 'Q?', options: ['Yes', 'No'], endAt: '2026-11-26T23:59:00Z'}, 'qa', new Date('2026-11-27T00:00:00Z')), /30 ngày/);
  assert.throws(() => normalizeGroupPoll({question: 'Q?', options: ['Yes']}, 'qa'), /từ 2 đến 10/);
});

test('serializes per-user choices without exposing ballots and hides results until the user votes', () => {
  const poll = {
    question: 'Choose',
    options: [{id: 'a', text: 'A', voteCount: 1}, {id: 'b', text: 'B', voteCount: 0}],
    ballots: [{userId: 'voter', optionIds: ['a']}],
    hideResultsUntilVote: true,
    createdBy: 'owner',
  };
  const anonymous = serializeGroupPoll(poll, 'other');
  assert.equal(anonymous.resultsHidden, true);
  assert.equal(anonymous.options[0].voteCount, null);
  assert.deepEqual(anonymous.selectedOptionIds, []);
  assert.equal(Object.hasOwn(anonymous, 'ballots'), false);

  const voter = serializeGroupPoll(poll, 'voter');
  assert.equal(voter.resultsHidden, false);
  assert.equal(voter.options[0].voteCount, 1);
  assert.deepEqual(voter.selectedOptionIds, ['a']);
});

test('recalculates aggregate counts from ballots', () => {
  const poll = {
    options: [{id: 'a', voteCount: 0}, {id: 'b', voteCount: 0}],
    ballots: [{optionIds: ['a', 'b']}, {optionIds: ['a']}],
  };
  recalculatePollCounts(poll);
  assert.deepEqual(poll.options.map(option => option.voteCount), [2, 1]);
});

test('returns member names only for visible non-anonymous results', () => {
  const poll = {
    question: 'Choose',
    options: [{id: 'a', text: 'A', voteCount: 1}],
    ballots: [{userId: 'voter', optionIds: ['a']}],
    anonymous: false,
    createdBy: 'owner',
  };
  const details = serializeGroupPollDetails(poll, 'owner', [{lv001: 'voter', name: 'QA Voter'}]);
  assert.deepEqual(details.options[0].voters, [{username: 'voter', name: 'QA Voter', avatar: null}]);
  assert.equal(Object.hasOwn(details, 'ballots'), false);

  const anonymous = serializeGroupPollDetails({...poll, anonymous: true}, 'owner', [{lv001: 'voter', name: 'QA Voter'}]);
  assert.equal(Object.hasOwn(anonymous.options[0], 'voters'), false);

  const hidden = serializeGroupPollDetails({...poll, hideResultsUntilVote: true}, 'other', [{lv001: 'voter', name: 'QA Voter'}]);
  assert.equal(hidden.resultsHidden, true);
  assert.equal(Object.hasOwn(hidden.options[0], 'voters'), false);
});
