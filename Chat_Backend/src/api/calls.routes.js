import express from 'express';
import Call from '../../models/Call.js';
import Room from '../../models/Room.js';
import User from '../../models/User.js';
import ChatPreference from '../../models/ChatPreference.js';
import {protect} from '../../middleware/auth.middleware.js';
import {assertHiddenChatRoomAccess} from '../../services/hiddenChatAccess.js';

const router = express.Router();

router.get('/history', protect, async (req, res) => {
  try {
    const userId = String(req.userId);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return res.status(400).json({error: 'limit phải từ 1 đến 100'});
    }

    const hiddenRoomIds = await ChatPreference.find({userId, hidden: true}).distinct('roomId');
    let canReadHiddenRooms = hiddenRoomIds.length === 0;
    if (!canReadHiddenRooms) {
      try {
        await assertHiddenChatRoomAccess({
          userId,
          roomId: String(hiddenRoomIds[0]),
          token: req.headers['x-hidden-chat-token'],
        });
        canReadHiddenRooms = true;
      } catch {
        canReadHiddenRooms = false;
      }
    }
    const callFilter = {$or: [
      {caller: userId},
      {callee: userId},
      {participants: userId},
    ]};
    if (!canReadHiddenRooms) callFilter.$nor = [{roomId: {$in: hiddenRoomIds}}];
    const calls = await Call.find(callFilter).sort({startedAt: -1, _id: -1}).limit(requestedLimit).lean();
    if (!calls.length) return res.json({calls: []});

    const roomIds = [...new Set(calls.map(call => String(call.roomId)))];
    const rooms = await Room.find({_id: {$in: roomIds}, participants: userId})
      .select('_id name type participants groupImage deletedAt')
      .lean();
    const roomById = new Map(rooms.map(room => [String(room._id), room]));
    const relatedUserIds = new Set();
    calls.forEach(call => {
      relatedUserIds.add(String(call.caller));
      relatedUserIds.add(String(call.callee));
      (call.participants || []).forEach(id => relatedUserIds.add(String(id)));
    });
    const users = await User.find({lv001: {$in: [...relatedUserIds]}}).select('lv001 name avatar').lean();
    const userById = new Map(users.map(user => [String(user.lv001), user]));

    const result = calls.flatMap(call => {
      const room = roomById.get(String(call.roomId));
      if (!room || room.deletedAt) return [];
      const memberIds = [...new Set((room.type === 'group' && call.participants?.length
        ? call.participants
        : room.participants).map(String))];
      const otherIds = memberIds.filter(id => id !== userId);
      const primaryPeer = room.type === 'group' ? null : (call.caller === userId ? call.callee : call.caller);
      const peer = primaryPeer ? userById.get(String(primaryPeer)) : null;
      const groupNames = otherIds.map(id => userById.get(id)?.name || id);
      return [{
        id: String(call._id),
        roomId: String(room._id),
        roomType: room.type,
        title: room.type === 'group' ? (room.name || 'Nhóm') : (peer?.name || primaryPeer || 'Bạn bè'),
        peerId: primaryPeer ? String(primaryPeer) : null,
        avatar: primaryPeer ? (peer?.avatar || '') : (room.groupImage || userById.get(otherIds[0])?.avatar || ''),
        participantNames: groupNames,
        caller: String(call.caller),
        status: call.status,
        callType: call.callType || 'audio',
        startedAt: call.startedAt,
        duration: Number(call.duration || 0),
      }];
    });
    res.json({calls: result});
  } catch (error) {
    res.status(500).json({error: 'Không thể tải lịch sử cuộc gọi'});
  }
});

export default router;
