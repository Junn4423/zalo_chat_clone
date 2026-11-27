import Friendship from '../models/Friendship.js';
import User from '../models/User.js';

const pairKey = (left, right) => JSON.stringify([String(left), String(right)].sort());

export const assertCanContactInRoom = async (room, senderId, channel = 'messages') => {
  if (room?.type !== 'one-to-one') return;

  const sender = String(senderId);
  const recipientIds = (room.participants || []).map(String).filter(id => id !== sender);
  if (!recipientIds.length) return;

  const preferenceField = channel === 'calls' ? 'allowCallsFromNonFriends' : 'allowMessagesFromNonFriends';
  const users = await User.find({lv001: {$in: [sender, ...recipientIds]}}).select(`lv001 ${preferenceField} blockedUsers`).lean();
  const usersById = new Map(users.map(user => [user.lv001, user]));
  const senderUser = usersById.get(sender);
  const blocked = recipientIds.some(id =>
    (usersById.get(id)?.blockedUsers || []).includes(sender) || (senderUser?.blockedUsers || []).includes(id));
  if (blocked) throw Object.assign(new Error('Không thể liên hệ vì một người đang chặn người còn lại'), {status: 403, code: 'CONTACT_BLOCKED'});

  const recipients = recipientIds.map(id => usersById.get(id)).filter(Boolean);
  const restrictedIds = recipients.filter(user => user[preferenceField] === false).map(user => user.lv001);
  if (!restrictedIds.length) return;

  const keys = restrictedIds.map(id => pairKey(sender, id));
  const friendships = await Friendship.find({pairKey: {$in: keys}, status: 'accepted'}).select('pairKey').lean();
  const accepted = new Set(friendships.map(item => item.pairKey));
  if (restrictedIds.some(id => !accepted.has(pairKey(sender, id)))) {
    const noun = channel === 'calls' ? 'cuộc gọi' : 'tin nhắn';
    throw Object.assign(new Error(`Người dùng chỉ nhận ${noun} từ bạn bè`), {status: 403, code: 'CONTACT_RESTRICTED'});
  }
};
