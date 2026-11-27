const PUBLIC_INVITE_PREFIX = 'https://login.sof.com.vn/mobilechat-api/invite/';

export type InviteTarget =
  | {type: 'friend'; username: string}
  | {type: 'group'; token: string};

export function createFriendInviteLink(username: string) {
  return `${PUBLIC_INVITE_PREFIX}${encodeURIComponent(username.trim())}`;
}

export function createFriendInviteDeepLink(username: string) {
  return `mobilechat://friend/${encodeURIComponent(username.trim())}`;
}

export function createGroupInviteLink(token: string) {
  return `${PUBLIC_INVITE_PREFIX}group/${encodeURIComponent(token.trim())}`;
}

export function createGroupInviteDeepLink(token: string) {
  return `mobilechat://group/${encodeURIComponent(token.trim())}`;
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return '';
  }
}

export function parseInviteLink(value?: string | null): InviteTarget | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const custom = input.match(/^mobilechat:\/\/(friend|group)\/([^/?#]+)(?:[?#].*)?$/i);
  const publicLink = input.match(/^https:\/\/login\.sof\.com\.vn\/mobilechat-api\/invite\/(group\/)?([^/?#]+)(?:[?#].*)?$/i);
  const kind = custom?.[1]?.toLowerCase() || (publicLink ? (publicLink[1] ? 'group' : 'friend') : '');
  const segment = custom?.[2] || publicLink?.[2];
  if (!kind || !segment) return null;

  const decoded = decodeSegment(segment);
  if (!decoded || decoded.length > 120 || /[\u0000-\u001f]/.test(decoded)) return null;
  if (kind === 'friend') return {type: 'friend', username: decoded};
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(decoded)) return null;
  return {type: 'group', token: decoded};
}

export function parseFriendInviteLink(value?: string | null) {
  const invite = parseInviteLink(value);
  return invite?.type === 'friend' ? invite.username : null;
}

export function parseGroupInviteLink(value?: string | null) {
  const invite = parseInviteLink(value);
  return invite?.type === 'group' ? invite.token : null;
}
