import {randomUUID} from 'crypto';

const MAX_OPTIONS = 10;
const MAX_QUESTION_LENGTH = 160;
const MAX_OPTION_LENGTH = 100;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const fail = (message, status = 400) => Object.assign(new Error(message), {status});

export function normalizeGroupPoll(input, createdBy, now = new Date()) {
  if (!input || typeof input !== 'object') throw fail('Thiếu nội dung bình chọn');
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) throw fail(`Câu hỏi phải có từ 1 đến ${MAX_QUESTION_LENGTH} ký tự`);
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > MAX_OPTIONS) {
    throw fail(`Bình chọn cần từ 2 đến ${MAX_OPTIONS} lựa chọn`);
  }
  const options = input.options.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (options.length !== input.options.length || options.some(item => item.length > MAX_OPTION_LENGTH)) {
    throw fail(`Mỗi lựa chọn cần từ 1 đến ${MAX_OPTION_LENGTH} ký tự`);
  }
  if (new Set(options.map(item => item.toLocaleLowerCase())).size !== options.length) throw fail('Các lựa chọn không được trùng nhau');

  let endAt = null;
  if (input.endAt) {
    endAt = new Date(input.endAt);
    if (Number.isNaN(endAt.getTime()) || endAt.getTime() <= now.getTime() || endAt.getTime() > now.getTime() + MAX_DURATION_MS) {
      throw fail('Thời hạn bình chọn phải nằm trong 30 ngày tới');
    }
  }

  return {
    question,
    options: options.map(text => ({id: randomUUID(), text, voteCount: 0})),
    ballots: [],
    allowMultiple: input.allowMultiple === true,
    allowAddOptions: input.allowAddOptions === true,
    anonymous: input.anonymous === true,
    hideResultsUntilVote: input.hideResultsUntilVote === true,
    endAt,
    closedAt: null,
    createdBy: String(createdBy),
  };
}

export function serializeGroupPoll(pollValue, userId, now = new Date()) {
  if (!pollValue) return null;
  const poll = typeof pollValue.toObject === 'function' ? pollValue.toObject() : pollValue;
  const ballots = Array.isArray(poll.ballots) ? poll.ballots : [];
  const mine = ballots.find(ballot => String(ballot.userId) === String(userId));
  const selectedOptionIds = Array.isArray(mine?.optionIds) ? mine.optionIds.map(String) : [];
  const active = !poll.closedAt && (!poll.endAt || new Date(poll.endAt).getTime() > now.getTime());
  const resultsHidden = Boolean(poll.hideResultsUntilVote && !selectedOptionIds.length && active);
  return {
    question: poll.question,
    options: (Array.isArray(poll.options) ? poll.options : []).map(option => ({
      id: String(option.id),
      text: option.text,
      voteCount: resultsHidden ? null : Number(option.voteCount || 0),
    })),
    allowMultiple: Boolean(poll.allowMultiple),
    allowAddOptions: Boolean(poll.allowAddOptions),
    anonymous: Boolean(poll.anonymous),
    hideResultsUntilVote: Boolean(poll.hideResultsUntilVote),
    resultsHidden,
    selectedOptionIds,
    endAt: poll.endAt || null,
    closedAt: poll.closedAt || null,
    createdBy: String(poll.createdBy || ''),
    isOpen: active,
  };
}

export function serializeGroupPollDetails(pollValue, userId, profiles = [], now = new Date()) {
  const result = serializeGroupPoll(pollValue, userId, now);
  if (result.anonymous || result.resultsHidden) return result;
  const poll = typeof pollValue.toObject === 'function' ? pollValue.toObject() : pollValue;
  const ballots = Array.isArray(poll.ballots) ? poll.ballots : [];
  const profileById = new Map(profiles.map(profile => [String(profile.lv001 || profile.username), {
    username: String(profile.lv001 || profile.username),
    name: profile.name || String(profile.lv001 || profile.username),
    avatar: profile.avatar || null,
  }]));
  result.options = result.options.map(option => ({
    ...option,
    voters: ballots.filter(ballot => (ballot.optionIds || []).some(id => String(id) === option.id))
      .map(ballot => profileById.get(String(ballot.userId))).filter(Boolean),
  }));
  return result;
}

export function recalculatePollCounts(poll) {
  const ballots = Array.isArray(poll.ballots) ? poll.ballots : [];
  for (const option of poll.options || []) {
    option.voteCount = ballots.reduce((total, ballot) => total + ((ballot.optionIds || []).some(id => String(id) === String(option.id)) ? 1 : 0), 0);
  }
}

export const GROUP_POLL_LIMITS = Object.freeze({MAX_OPTIONS, MAX_QUESTION_LENGTH, MAX_OPTION_LENGTH});
