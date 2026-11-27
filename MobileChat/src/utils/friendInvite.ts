const FRIEND_INVITE_PREFIX = 'mobilechat://friend/';
const PUBLIC_INVITE_PREFIX = 'https://login.sof.com.vn/mobilechat-api/invite/';

export function createFriendInviteLink(username: string) {
  return `${PUBLIC_INVITE_PREFIX}${encodeURIComponent(username.trim())}`;
}

export function createFriendInviteDeepLink(username: string) {
  return `${FRIEND_INVITE_PREFIX}${encodeURIComponent(username.trim())}`;
}

export function parseFriendInviteLink(value?: string | null) {
  if (!value?.startsWith(FRIEND_INVITE_PREFIX)) return null;
  const encodedUsername = value.slice(FRIEND_INVITE_PREFIX.length).split(/[?#/]/, 1)[0];
  if (!encodedUsername) return null;
  try {
    const username = decodeURIComponent(encodedUsername).trim();
    return username && username.length <= 120 ? username : null;
  } catch {
    return null;
  }
}
