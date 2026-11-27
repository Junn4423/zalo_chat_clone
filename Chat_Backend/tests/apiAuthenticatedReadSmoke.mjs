const base = (process.env.MOBILECHAT_QA_API_BASE || 'http://127.0.0.1:5070').replace(/\/$/, '');
const username = process.env.MOBILECHAT_QA_USERNAME;
const password = process.env.MOBILECHAT_QA_PASSWORD;

if (!username || !password) {
  throw new Error('Set MOBILECHAT_QA_USERNAME and MOBILECHAT_QA_PASSWORD for this read-only smoke pass.');
}

const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({username, password}),
});
const loginBody = await loginResponse.json().catch(() => ({}));
if (!loginResponse.ok || !loginBody.token) {
  throw new Error(`QA login failed with HTTP ${loginResponse.status}.`);
}

const headers = {Authorization: `Bearer ${loginBody.token}`};
const failures = [];
let checks = 0;
let messageCount = 0;
let groupCount = 0;
let pollCount = 0;
let pollDetailsWithoutBallots = 0;

const read = async (label, path) => {
  checks++;
  let response;
  try {
    response = await fetch(`${base}${path}`, {headers, redirect: 'manual'});
  } catch {
    failures.push({label, status: 'NETWORK_ERROR'});
    return {status: 0, body: null};
  }
  const body = await response.json().catch(() => null);
  if (response.status !== 200) failures.push({label, status: response.status});
  return {status: response.status, body};
};

for (const [label, path] of [
  ['my-rooms', '/api/room/my-rooms'],
  ['my-groups', '/api/room/my-groups'],
  ['hidden-room-ids', '/api/room/hidden-ids'],
  ['privacy', '/api/user/privacy'],
  ['blocked-users', '/api/user/privacy/blocked'],
  ['hidden-chat-pin', '/api/user/hidden-chat/pin'],
  ['employees', '/api/user/nhan-vien'],
  ['friends', '/api/friends'],
  ['friend-discovery', '/api/friends/discover?q=qa'],
  ['calls-history', '/api/calls/history'],
  ['online-users', '/api/user/online'],
  ['user-statuses', '/api/user/all-with-status'],
]) {
  await read(label, path);
}

const roomsResult = await read('rooms-for-detail-check', '/api/room/my-rooms');
const rooms = Array.isArray(roomsResult.body)
  ? roomsResult.body
  : Array.isArray(roomsResult.body?.rooms) ? roomsResult.body.rooms : [];

for (let index = 0; index < rooms.length; index++) {
  const room = rooms[index];
  const roomId = String(room?._id || '');
  if (!roomId) {
    failures.push({label: `room-${index + 1}-id`, status: 'MISSING'});
    continue;
  }
  const roomPath = encodeURIComponent(roomId);
  const historyResult = await read(`room-${index + 1}-history`, `/api/chat/get?roomId=${roomPath}`);
  const messages = Array.isArray(historyResult.body?.messages) ? historyResult.body.messages : [];
  messageCount += messages.length;

  const latestResult = await read(`room-${index + 1}-latest`, `/api/chat/get-latest?roomId=${roomPath}`);
  const latestMessages = latestResult.body?.messages;
  if (!Array.isArray(latestMessages) || (messages.length === 0 ? latestMessages.length !== 0 : latestMessages.length !== 1)) {
    failures.push({label: `room-${index + 1}-latest-shape`, status: 'INVALID'});
  }

  for (const kind of ['media', 'file', 'link']) {
    await read(`room-${index + 1}-shared-${kind}`, `/api/chat/shared?roomId=${roomPath}&kind=${kind}`);
  }
  await read(`room-${index + 1}-unread`, `/api/chat/unread-count/${roomPath}`);
  await read(`room-${index + 1}-preference`, `/api/room/${roomPath}/preference`);

  if (room.type !== 'group') continue;
  groupCount++;
  await read(`group-${index + 1}-members`, `/api/room/${roomPath}/members`);
  await read(`group-${index + 1}-pins`, `/api/chat/group/${roomPath}/pins`);
  for (const message of messages.filter(item => item?.type === 'poll' && item?._id)) {
    pollCount++;
    const pollResult = await read(
      `group-${index + 1}-poll-${pollCount}`,
      `/api/chat/group/${roomPath}/polls/${encodeURIComponent(String(message._id))}`,
    );
    if (pollResult.body?.poll && !Object.hasOwn(pollResult.body.poll, 'ballots')) pollDetailsWithoutBallots++;
    else failures.push({label: `group-${index + 1}-poll-privacy`, status: 'BALLOTS_EXPOSED'});
  }
}

console.log(JSON.stringify({
  login: loginResponse.status,
  rooms: rooms.length,
  groups: groupCount,
  historyMessages: messageCount,
  polls: pollCount,
  pollDetailsWithoutBallots,
  authenticatedReadChecks: checks,
  failures,
}));

if (failures.length) process.exitCode = 1;
