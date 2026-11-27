import ChatPreference from '../models/ChatPreference.js';
import Message from '../models/Message.js';
import mongoose from 'mongoose';
import {verifyHiddenChatAccessToken} from '../src/token.js';

const findHiddenPreference = async (userId, roomId) => Boolean(
  await ChatPreference.exists({userId, roomId, hidden: true}),
);

const resolveMessageRoomId = async messageId => {
  const message = await Message.findById(messageId).select('roomId').lean();
  return message?.roomId ? String(message.roomId) : null;
};

export const assertHiddenChatRoomAccess = async ({
  userId,
  roomId,
  token,
  isHiddenRoom = findHiddenPreference,
}) => {
  if (!userId || !roomId || !await isHiddenRoom(userId, roomId)) return null;
  if (typeof token !== 'string' || !token) {
    throw Object.assign(new Error('Hãy mở khóa trò chuyện ẩn trước'), {status: 423});
  }

  let decoded;
  try {
    decoded = verifyHiddenChatAccessToken(token);
  } catch {
    throw Object.assign(new Error('Mã mở khóa đã hết hạn hoặc không hợp lệ'), {status: 423});
  }

  if (String(decoded.id) !== String(userId)) {
    throw Object.assign(new Error('Mã mở khóa không thuộc tài khoản này'), {status: 403});
  }
  return decoded;
};

export const createRequireHiddenRoomAccess = ({
  isHiddenRoom = findHiddenPreference,
  findRoomIdForMessage = resolveMessageRoomId,
} = {}) => async (req, res, next) => {
  try {
    const roomIds = new Set([
      req.params?.roomId,
      req.query?.roomId,
      req.body?.roomId,
      req.body?.targetRoomId,
      req.query?.targetRoomId,
    ].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));

    const messageId = req.params?.messageId;
    if (typeof messageId === 'string' && mongoose.Types.ObjectId.isValid(messageId)) {
      const sourceRoomId = await findRoomIdForMessage(messageId);
      if (sourceRoomId) roomIds.add(String(sourceRoomId));
    }

    const token = req.headers?.['x-hidden-chat-token'];
    for (const roomId of roomIds) {
      await assertHiddenChatRoomAccess({
        userId: req.userId,
        roomId,
        token,
        isHiddenRoom,
      });
    }
    return next();
  } catch (error) {
    return res.status(error.status || 500).json({error: error.message || 'Không thể xác thực quyền truy cập trò chuyện.'});
  }
};

export const requireHiddenRoomAccess = createRequireHiddenRoomAccess();
