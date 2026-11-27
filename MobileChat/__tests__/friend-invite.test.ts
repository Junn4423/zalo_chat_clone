import {createFriendInviteDeepLink, createFriendInviteLink, parseFriendInviteLink} from '../src/utils/friendInvite';

describe('friend invite links', () => {
  it('creates a public HTTPS invite and app deep link for a CouchDB username', () => {
    const link = createFriendInviteLink('giuxe.pro1');
    const deepLink = createFriendInviteDeepLink('giuxe.pro1');
    expect(link).toBe('https://login.sof.com.vn/mobilechat-api/invite/giuxe.pro1');
    expect(parseFriendInviteLink(deepLink)).toBe('giuxe.pro1');
  });

  it('encodes reserved characters and rejects malformed app deep links', () => {
    const link = createFriendInviteDeepLink('team member/01');
    expect(parseFriendInviteLink(link)).toBe('team member/01');
    expect(parseFriendInviteLink('https://example.com/friend/giuxe.pro1')).toBeNull();
    expect(parseFriendInviteLink('mobilechat://friend/%E0%A4%A')).toBeNull();
    expect(parseFriendInviteLink('mobilechat://friend/')).toBeNull();
  });
});
