import mongoose from 'mongoose';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Room from '../models/Room.js';
import { getContext, runWithContext } from '../utils/context.js';
import { assertCanContactInRoom } from './contact-policy.service.js';
import {normalizeGroupPoll, serializeGroupPoll} from './groupPoll.service.js';

// Lưu tin nhắn
export const createReplyPreview = async (roomId, replyToId) => {
  if (!replyToId) return undefined;
  if (!mongoose.Types.ObjectId.isValid(replyToId)) throw new Error('replyToId không hợp lệ');

  const original = await Message.findOne({ _id: replyToId, roomId })
    .select('_id userId content type fileMeta.fileName')
    .lean();
  if (!original) throw new Error('Không tìm thấy tin nhắn được trả lời trong phòng này');

  return {
    messageId: original._id,
    userId: original.userId,
    content: String(original.content || '').slice(0, 300),
    type: original.type,
    fileName: original.fileMeta?.fileName,
  };
};

export const saveMessage = async ({ roomId, userId, content, type = 'text', fileMeta, location, poll, replyTo, forwardedFrom, clientMessageId }) => {
  const context = getContext();
  return runWithContext(context, async () => {
    try {
      // Kiểm tra userId tồn tại
      const user = await User.findOne({ lv001: userId });
      if (!user) {
        throw new Error('Người dùng không tồn tại');
      }

      // Kiểm tra roomId là ObjectId hợp lệ
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        throw new Error('roomId không hợp lệ');
      }

      // Kiểm tra content bắt buộc
      const room = await Room.findOne({_id: roomId, participants: userId, deletedAt: null}).select('_id type participants').lean();
      if (!room) throw Object.assign(new Error('Không có quyền gửi tin nhắn vào phòng này'), {status: 403});
      await assertCanContactInRoom(room, userId, 'messages');

      let normalizedPoll;
      if (type === 'poll') {
        if (room.type !== 'group') throw Object.assign(new Error('Chỉ có thể tạo bình chọn trong nhóm'), {status: 400});
        normalizedPoll = normalizeGroupPoll(poll, userId);
        content = normalizedPoll.question;
      } else if (poll !== undefined) {
        throw Object.assign(new Error('Dữ liệu bình chọn không hợp lệ'), {status: 400});
      }

      if (!content && type === 'text') {
        throw new Error('content là bắt buộc cho tin nhắn văn bản');
      }

      // Lấy thời gian Việt Nam (UTC+7)
      if (clientMessageId) {
        const existing = await Message.findOne({roomId, userId, clientMessageId}).lean();
        if (existing) return {...existing, deduplicated: true};
      }

      const messageData = {
        roomId,
        userId,
        content,
        type,
        replyTo,
        forwardedFrom,
        ...(clientMessageId ? {clientMessageId} : {}),
        timestamp: new Date(),
        status: 'pending',
      };
      if (fileMeta && typeof fileMeta === 'object') messageData.fileMeta = fileMeta;
      if (location && typeof location === 'object') messageData.location = location;
      if (normalizedPoll) messageData.poll = normalizedPoll;

      const message = new Message(messageData);
      await message.save();
      const saved = message.toObject();
      if (saved.poll) saved.poll = serializeGroupPoll(saved.poll, userId);
      return saved;
    } catch (error) {
      if (error?.code === 11000 && clientMessageId) {
        const existing = await Message.findOne({roomId, userId, clientMessageId}).lean();
        if (existing) return {...existing, deduplicated: true};
      }
      console.error(`Chat Service: Error saving message for user ${userId}`, { error: error.message });
      throw Object.assign(new Error(`Lỗi lưu tin nhắn: ${error.message}`), {status: error.status || 500});
    }
  });
};

// Lấy lịch sử tin nhắn
export const getMessagesService = async (roomId, { limit = 25, page = 1, before, after, userId } = {}) => {
  try {
    const parsedLimit = Number.parseInt(limit, 10);
    const parsedPage = Number.parseInt(page, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100
      || !Number.isInteger(parsedPage) || parsedPage < 1 || (before && after)) {
      throw new Error('limit, page hoặc cursor không hợp lệ');
    }

    const roomFilter = { roomId };
    if (userId) roomFilter.deletedFor = { $ne: userId };
    let cursor = null;
    let direction = 'page';
    if (before || after) {
      const cursorId = before || after;
      if (!mongoose.Types.ObjectId.isValid(cursorId)) throw new Error('Cursor không hợp lệ');
      cursor = await Message.findOne({ _id: cursorId, roomId }).select('_id timestamp').lean();
      if (!cursor) throw new Error('Không tìm thấy tin nhắn làm mốc trong phòng này');
      direction = before ? 'before' : 'after';
      roomFilter.$or = direction === 'before'
        ? [{ timestamp: { $lt: cursor.timestamp } }, { timestamp: cursor.timestamp, _id: { $lt: cursor._id } }]
        : [{ timestamp: { $gt: cursor.timestamp } }, { timestamp: cursor.timestamp, _id: { $gt: cursor._id } }];
    }

    const isAscending = direction === 'after';
    let query = Message.find(roomFilter)
      .sort(isAscending ? { timestamp: 1, _id: 1 } : { timestamp: -1, _id: -1 })
      .limit(parsedLimit + 1)
      .select('+poll.ballots');
    if (direction === 'page') query = query.skip((parsedPage - 1) * parsedLimit);
    const results = await query.lean();
    const hasMore = results.length > parsedLimit;
    if (hasMore) results.pop();
    if (!isAscending) results.reverse();
    const safeResults = results.map(message => message.type === 'poll' && message.poll
      ? {...message, poll: serializeGroupPoll(message.poll, userId)}
      : message);

    const totalMessages = direction === 'page' ? await Message.countDocuments(roomFilter) : null;
    const nextCursor = direction === 'after'
      ? results.at(-1)?._id?.toString() ?? null
      : results[0]?._id?.toString() ?? null;
    return {
      messages: safeResults,
      totalMessages,
      totalPages: totalMessages === null ? null : Math.ceil(totalMessages / parsedLimit),
      currentPage: parsedPage,
      hasMore: direction === 'page'
        ? (parsedPage * parsedLimit < totalMessages)
        : hasMore,
      nextCursor,
    };
  } catch (error) {
    console.error(`Chat Service: Error retrieving messages for room ${roomId}`, { error: error.message });
    throw new Error(`Lỗi lấy tin nhắn: ${error.message}`);
  }
};

export const uploadFileService = async (userId, roomId, meta, io, replyToId) => {
  const replyTo = await createReplyPreview(roomId, replyToId);
  // Lưu tin nhắn với file meta
  const savedMessage = await saveMessage({
    roomId,
    userId,
    content: '',
    type: meta.fileType.startsWith('image') ? 'image' :
      meta.fileType.startsWith('video') ? 'video' :
        meta.fileType.startsWith('audio') ? 'audio' : 'file',
    fileMeta: meta,
    replyTo,
  });

  io.to(roomId).emit("receiveMessage", {
    _id: savedMessage._id,
    from: userId,
    to: [],
    content: meta.fileUrl,
    type: savedMessage.type,
    createdAt: savedMessage.timestamp,
    roomId: roomId,
    fileMeta: meta,
    replyTo: savedMessage.replyTo || null,
  });

  return meta;

}

const getMessageAndAuthorizedRoom = async (messageId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    throw Object.assign(new Error('Tin nhắn không hợp lệ'), {status: 400});
  }
  const message = await Message.findById(messageId);
  if (!message) throw Object.assign(new Error('Không tìm thấy tin nhắn'), {status: 404});
  const room = await Room.findOne({_id: message.roomId, participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Bạn không có quyền truy cập tin nhắn này'), {status: 403});
  return {message, room};
};

export const editMessageService = async ({messageId, userId, content, io}) => {
  const {message, room} = await getMessageAndAuthorizedRoom(messageId, userId);
  if (String(message.userId) !== String(userId)) throw Object.assign(new Error('Chỉ người gửi mới có thể sửa tin nhắn'), {status: 403});
  if (message.type !== 'text' || message.deletedAt) throw Object.assign(new Error('Chỉ sửa được tin nhắn văn bản còn hiệu lực'), {status: 409});
  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  if (!normalizedContent || normalizedContent.length > 2000) throw Object.assign(new Error('Nội dung phải từ 1 đến 2000 ký tự'), {status: 400});

  message.content = normalizedContent;
  message.editedAt = new Date();
  await message.save();
  const result = message.toObject();
  io.to(room._id.toString()).emit('messageUpdated', result);
  return result;
};

export const deleteMessageService = async ({messageId, userId, scope, io}) => {
  const {message, room} = await getMessageAndAuthorizedRoom(messageId, userId);
  if (!['me', 'everyone'].includes(scope)) throw Object.assign(new Error('Phạm vi xóa không hợp lệ'), {status: 400});

  if (scope === 'everyone') {
    if (String(message.userId) !== String(userId)) throw Object.assign(new Error('Chỉ người gửi mới có thể thu hồi tin nhắn'), {status: 403});
    if (message.deletedAt) return {messageId: String(message._id), roomId: String(room._id), scope, deletedAt: message.deletedAt};
    message.deletedAt = new Date();
    message.deletedBy = userId;
    message.content = '';
      if (message.location?.liveSessionId && message.location?.isLive) {
        io.to(room._id.toString()).emit('liveLocationStopped', {
          roomId: String(room._id),
          sessionId: message.location.liveSessionId,
          userId: String(userId),
          status: 'stopped',
        });
      }
    message.location = undefined;
    await message.save();
    const payload = {messageId: String(message._id), roomId: String(room._id), scope, deletedAt: message.deletedAt, deletedBy: userId};
    io.to(room._id.toString()).emit('messageDeleted', payload);
    return payload;
  }

  await Message.updateOne({_id: message._id}, {$addToSet: {deletedFor: userId}});
  const payload = {messageId: String(message._id), roomId: String(room._id), scope, userId};
  io.to(room._id.toString()).emit('messageHidden', payload);
  return payload;
};

export const toggleMessageReactionService = async ({messageId, userId, emoji, io}) => {
  const {message, room} = await getMessageAndAuthorizedRoom(messageId, userId);
  if (message.deletedAt) throw Object.assign(new Error('Không thể phản ứng với tin nhắn đã thu hồi'), {status: 409});
  const normalizedEmoji = typeof emoji === 'string' ? emoji.trim() : '';
  if (!normalizedEmoji || normalizedEmoji.length > 32) throw Object.assign(new Error('Emoji không hợp lệ'), {status: 400});

  const reactions = message.reactions || [];
  const index = reactions.findIndex(item => String(item.userId) === String(userId) && item.emoji === normalizedEmoji);
  if (index >= 0) reactions.splice(index, 1);
  else reactions.push({userId, emoji: normalizedEmoji, updatedAt: new Date()});
  message.reactions = reactions;
  await message.save();

  const payload = {
    messageId: String(message._id),
    roomId: String(room._id),
    reactions: message.reactions.map(item => ({userId: String(item.userId), emoji: item.emoji, updatedAt: item.updatedAt})),
  };
  io.to(room._id.toString()).emit('messageReactionUpdated', payload);
  return payload;
};

export const forwardMessageService = async ({messageId, userId, targetRoomId, io}) => {
  const {message: original} = await getMessageAndAuthorizedRoom(messageId, userId);
  if (original.deletedAt || original.deletedFor?.some(id => String(id) === String(userId))) {
    throw Object.assign(new Error('Tin nhắn này không thể chuyển tiếp'), {status: 409});
  }
  if (original.type === 'call') throw Object.assign(new Error('Không thể chuyển tiếp thẻ cuộc gọi'), {status: 409});
  if (original.type === 'poll') throw Object.assign(new Error('Không thể chuyển tiếp bình chọn'), {status: 409});

  if (!mongoose.Types.ObjectId.isValid(targetRoomId)) throw Object.assign(new Error('Phòng đích không hợp lệ'), {status: 400});
  const targetRoom = await Room.findOne({_id: targetRoomId, participants: userId, deletedAt: null});
  if (!targetRoom) throw Object.assign(new Error('Bạn không có quyền gửi vào phòng đích này'), {status: 403});

  // Hydrated nested paths can wrap a stored null as a truthy subdocument.
  // Do not fall back to that wrapper when toObject() correctly returns null.
  const fileMeta = typeof original.fileMeta?.toObject === 'function'
    ? original.fileMeta.toObject()
    : original.fileMeta;
  const forwarded = await saveMessage({
    roomId: targetRoom._id.toString(),
    userId,
    content: original.content,
    type: original.type,
    ...(original.location ? {location: typeof original.location.toObject === 'function' ? original.location.toObject() : original.location} : {}),
    ...(fileMeta ? {fileMeta} : {}),
    forwardedFrom: {messageId: original._id, userId: original.userId},
  });
  const payload = {
    _id: forwarded._id,
    roomId: targetRoom._id,
    from: userId,
    to: targetRoom.participants.filter(id => String(id) !== String(userId)),
    content: forwarded.content,
    type: forwarded.type,
    createdAt: forwarded.timestamp,
    fileMeta: forwarded.fileMeta,
    location: forwarded.location,
    forwardedFrom: forwarded.forwardedFrom,
  };
  io.to(targetRoom._id.toString()).emit('receiveMessage', payload);
  return forwarded;
};

// Đánh dấu tin nhắn đã đọc
export const markMessageAsRead = async (messageId, userId) => {
  try {
    // Kiểm tra messageId là ObjectId hợp lệ
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new Error('messageId không hợp lệ');
    }

    // Kiểm tra userId tồn tại
    const user = await User.findOne({ lv001: userId });
    if (!user) {
      throw new Error('Người dùng không tồn tại');
    }

    // Tìm tin nhắn và thêm userId vào readBy nếu chưa có
    const message = await Message.findByIdAndUpdate(
      messageId,
      { $addToSet: { readBy: userId } }, // $addToSet để tránh trùng lặp
      { new: true }
    );

    if (!message) {
      throw new Error('Tin nhắn không tồn tại');
    }

    return message.toObject();
  } catch (error) {
    console.error(`Chat Service: Error marking message as read for user ${userId}`, { error: error.message });
    throw new Error(`Lỗi đánh dấu tin nhắn đã đọc: ${error.message}`);
  }
};

// Đánh dấu tất cả tin nhắn trong room đã đọc
export const markAllMessagesAsRead = async (roomId, userId) => {
  try {
    // Kiểm tra roomId là ObjectId hợp lệ
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      throw new Error('roomId không hợp lệ');
    }

    // Kiểm tra userId tồn tại
    const user = await User.findOne({ lv001: userId });
    if (!user) {
      throw new Error('Người dùng không tồn tại');
    }

    // Cập nhật tất cả tin nhắn trong room để thêm userId vào readBy
    const result = await Message.updateMany(
      { 
        roomId: roomId,
        deletedAt: null,
        deletedFor: { $ne: userId },
        readBy: { $ne: userId } // Chỉ cập nhật những tin nhắn user chưa đọc
      },
      { $addToSet: { readBy: userId } }
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `Đã đánh dấu ${result.modifiedCount} tin nhắn là đã đọc`
    };
  } catch (error) {
    console.error(`Chat Service: Error marking all messages as read for user ${userId} in room ${roomId}`, { error: error.message });
    throw new Error(`Lỗi đánh dấu tất cả tin nhắn đã đọc: ${error.message}`);
  }
};

// Lấy số lượng tin nhắn chưa đọc trong room
export const getUnreadMessagesCount = async (roomId, userId) => {
  try {
    // Kiểm tra roomId là ObjectId hợp lệ
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      throw new Error('roomId không hợp lệ');
    }

    // Kiểm tra userId tồn tại
    const user = await User.findOne({ lv001: userId });
    if (!user) {
      throw new Error('Người dùng không tồn tại');
    }

    // Đếm số tin nhắn chưa đọc (không có userId trong readBy array)
    const unreadCount = await Message.countDocuments({
      roomId: roomId,
        deletedAt: null,
        deletedFor: { $ne: userId },
      userId: { $ne: userId }, // Không đếm tin nhắn của chính user
      readBy: { $ne: userId } // Tin nhắn chưa được user đọc
    });

    return unreadCount;
  } catch (error) {
    console.error(`Chat Service: Error getting unread messages count for user ${userId} in room ${roomId}`, { error: error.message });
    throw new Error(`Lỗi lấy số tin nhắn chưa đọc: ${error.message}`);
  }
};
