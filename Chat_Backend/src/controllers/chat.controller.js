import { saveMessage, createReplyPreview, getMessagesService, uploadFileService, markMessageAsRead, markAllMessagesAsRead, getUnreadMessagesCount, editMessageService, deleteMessageService, toggleMessageReactionService, forwardMessageService } from '../../services/chat.service.js';
import Room from '../../models/Room.js';
import User from '../../models/User.js';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import Message from '../../models/Message.js';
import {serializeGroupPoll, serializeGroupPollDetails, recalculatePollCounts, GROUP_POLL_LIMITS} from '../../services/groupPoll.service.js';
import {randomUUID} from 'crypto';

const requireRoom = async (req, res) => {
  const { roomId } = req.query;
  if (typeof roomId !== 'string' || !mongoose.Types.ObjectId.isValid(roomId)) {
    res.status(400).json({ error: 'Phòng chat không hợp lệ' });
    return false;
  }
  const room = await Room.findOne({ _id: roomId, participants: req.userId, deletedAt: null }).lean();
  if (!room) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập phòng này' });
    return false;
  }
  return true;
};

const serializePollMessage = (message, userId) => message?.type === 'poll' && message.poll
  ? {...message, poll: serializeGroupPoll(message.poll, userId)}
  : message;

// Lấy lịch sử tin nhắn
export const getMessages = async (req, res) => {
  try {
    const { roomId, limit = 25, page = 1, before, after } = req.query;
    if (!await requireRoom(req, res)) return;
    if (!/^\d+$/.test(String(limit)) || !/^\d+$/.test(String(page)) || Number(limit) < 1 || Number(limit) > 100 || Number(page) < 1 || Number(page) > 10000 || (before && after)) return res.status(400).json({ error: 'Trang, giới hạn hoặc cursor không hợp lệ' });
    const cursorId = before || after;
    if (cursorId !== undefined && (typeof cursorId !== 'string' || !mongoose.Types.ObjectId.isValid(cursorId))) return res.status(400).json({ error: 'Cursor không hợp lệ' });
    if (cursorId && !await Message.exists({ _id: cursorId, roomId })) {
      // The client may resume from an offline cache after the cursor message
      // was recalled or removed. Rebase incremental sync to the latest page
      // instead of returning a permanent 404 for every reconnect.
      if (after) {
        const latestPage = await getMessagesService(roomId, {
          limit: Number.parseInt(String(limit), 10),
          page: 1,
          userId: req.userId,
        });
        return res.json({...latestPage, cursorReset: true});
      }
      return res.status(404).json({ error: 'Không tìm thấy tin nhắn làm mốc trong phòng này' });
    }

    const messages = await getMessagesService(roomId, { limit: parseInt(limit, 10), page: parseInt(page, 10), before, after, userId: req.userId });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy tin nhắn: ${error.message}` });
  }
};

export const getLatestMessage = async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!await requireRoom(req, res)) return;

    const latestMessage = await getMessagesService(roomId, { limit: 1, page: 1, userId: req.userId });
    if (latestMessage.messages.length === 0) {
      // An empty room is a valid conversation state, not a missing resource.
      // Keep the same response shape as /get so clients can render its empty state.
      return res.status(200).json(latestMessage);
    }

    res.json(latestMessage);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy tin nhắn mới nhất: ${error.message}` });
  }
}

export const searchMessages = async (req, res) => {
  try {
    if (!await requireRoom(req, res)) return;
    const { roomId, q, page = '1' } = req.query;
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query || query.length > 100 || !/^\d+$/.test(String(page)) || Number(page) < 1 || Number(page) > 10000) {
      return res.status(400).json({ error: 'Từ khóa hoặc trang không hợp lệ' });
    }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const condition = { roomId, deletedAt: null, deletedFor: { $ne: req.userId }, $or: [{ content: { $regex: escaped, $options: 'i' } }, { 'fileMeta.fileName': { $regex: escaped, $options: 'i' } }] };
    const limit = 30;
    const [messages, total] = await Promise.all([
      Message.find(condition).select('+poll.ballots').sort({ timestamp: -1, _id: -1 }).skip((Number(page) - 1) * limit).limit(limit).lean(),
      Message.countDocuments(condition),
    ]);
    res.json({ messages: messages.map(message => serializePollMessage(message, req.userId)), total, page: Number(page), hasMore: Number(page) * limit < total });
  } catch (error) {
    res.status(500).json({ error: `Lỗi tìm tin nhắn: ${error.message}` });
  }
};

export const getMessageContext = async (req, res) => {
  try {
    if (!await requireRoom(req, res)) return;
    const { roomId, messageId } = req.query;
    if (typeof messageId !== 'string' || !mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({ error: 'Tin nhắn không hợp lệ' });
    const target = await Message.findOne({ _id: messageId, roomId, deletedFor: { $ne: req.userId } }).select('+poll.ballots').lean();
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
    const [older, newer] = await Promise.all([
      Message.find({roomId, deletedFor: { $ne: req.userId }, $or: [{timestamp: {$lt: target.timestamp}}, {timestamp: target.timestamp, _id: {$lt: target._id}}]}).select('+poll.ballots').sort({timestamp: -1, _id: -1}).limit(10).lean(),
      Message.find({roomId, deletedFor: { $ne: req.userId }, $or: [{timestamp: {$gt: target.timestamp}}, {timestamp: target.timestamp, _id: {$gt: target._id}}]}).select('+poll.ballots').sort({timestamp: 1, _id: 1}).limit(10).lean(),
    ]);
    res.json({messages: [...older.reverse(), target, ...newer].map(message => serializePollMessage(message, req.userId))});
  } catch (error) {
    res.status(500).json({error: `Lỗi lấy ngữ cảnh tin nhắn: ${error.message}`});
  }
};

export const getSharedItems = async (req, res) => {
  try {
    if (!await requireRoom(req, res)) return;
    const {roomId, kind, page = '1'} = req.query;
    if (!['media', 'file', 'link'].includes(kind) || !/^\d+$/.test(String(page)) || Number(page) < 1 || Number(page) > 10000) {
      return res.status(400).json({error: 'Loại nội dung hoặc trang không hợp lệ'});
    }
    const condition = {roomId, deletedAt: null, deletedFor: { $ne: req.userId }};
    if (kind === 'media') condition['fileMeta.fileType'] = {$regex: '^(image|video)/', $options: 'i'};
    if (kind === 'file') {
      condition['fileMeta.fileUrl'] = {$exists: true, $ne: ''};
      condition['fileMeta.fileType'] = {$not: /^(image|video)\//i};
    }
    if (kind === 'link') condition.content = {$regex: 'https?://[^\\s<>]+', $options: 'i'};
    const limit = 30;
    const items = await Message.find(condition).select('+poll.ballots').sort({timestamp: -1, _id: -1}).skip((Number(page) - 1) * limit).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({messages: items.map(message => serializePollMessage(message, req.userId)), page: Number(page), hasMore});
  } catch (error) {
    res.status(500).json({error: `Lỗi lấy nội dung chia sẻ: ${error.message}`});
  }
};

// Gửi tin nhắn (text hoặc file)
export const sendMessages = async (req, res) => {
  try {

    const { roomId, content, replyToId } = req.body;
    const { userId } = req.user;

    if (!roomId) {
      return res.status(400).json({ error: 'roomId là bắt buộc' });
    }

    if (content && content.length > 1000) {
      return res.status(400).json({ error: 'Nội dung tin nhắn quá dài' });
    }
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ error: 'roomId không hợp lệ' });
    }

    // Kiểm tra user có phải thành viên của phòng không
    const room = await Room.findOne({ _id: roomId });
    if (!room || !room.participants.includes(userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền gửi tin nhắn vào phòng này' });
    }

    let messageData = { roomId, userId, content, type: 'text', replyTo: await createReplyPreview(roomId, replyToId) };
    if (req.file) {
      messageData = {
        ...messageData,
        type: req.file.mimetype.startsWith('image') ? 'image' :
          req.file.mimetype.startsWith('video') ? 'video' :
            req.file.mimetype.startsWith('audio') ? 'audio' : 'file',
        content: content || '', // content có thể rỗng cho file
        fileMeta: {
          fileName: req.file.originalname,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          fileUrl: `/uploads/${req.file.filename}`,
        },
      };
    } else if (!content) {
      return res.status(400).json({ error: 'content là bắt buộc cho tin nhắn văn bản' });
    }

    const message = await saveMessage(messageData);
    res.status(201).json(message);
  } catch (error) {
    res.status(error.status || 500).json({ error: `Lỗi gửi tin nhắn: ${error.message}` });
  }
};

// Client gửi file qua API (REST)
export const uploadFile = async (req, res) => {
  const uploadedFiles = req.files || (req.file ? [req.file] : []);
  try {
    const io = req.app.get('io');
    const { roomId, replyToId } = req.body;
    const userId = req.userId;

    if (!uploadedFiles.length) return res.status(400).json({ error: 'Chưa có file' });
    const groupedPhotos = uploadedFiles.length > 1;
    if (groupedPhotos && uploadedFiles.some(file => !file.mimetype.startsWith('image/'))) {
      await Promise.all(uploadedFiles.map(file => fs.unlink(file.path).catch(() => {})));
      return res.status(400).json({error: 'Tin nhắn ảnh nhóm chỉ hỗ trợ ảnh'});
    }
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      await Promise.all(uploadedFiles.map(file => fs.unlink(file.path).catch(() => {})));
      return res.status(400).json({ error: 'Phòng chat không hợp lệ' });
    }
    const room = await Room.findById(roomId).lean();
    if (!room || !room.participants.includes(userId)) {
      await Promise.all(uploadedFiles.map(file => fs.unlink(file.path).catch(() => {})));
      return res.status(403).json({ error: 'Bạn không có quyền gửi vào phòng này' });
    }

    const makeMeta = file => {
      const meta = {fileName: file.originalname, fileUrl: `/Uploads/${file.filename}`, fileType: file.mimetype, fileSize: file.size};
      const duration = Number(req.body?.fileDuration);
      if (file.mimetype.startsWith('audio/') && Number.isFinite(duration) && duration > 0 && duration <= 3600) meta.duration = duration;
      return meta;
    };
    let result;
    if (groupedPhotos) {
      const images = uploadedFiles.map(makeMeta);
      const replyTo = await createReplyPreview(roomId, replyToId);
      const savedMessage = await saveMessage({roomId, userId, content: '', type: 'image', fileMeta: {...images[0], images}, replyTo});
      io.to(roomId).emit('receiveMessage', {
        _id: savedMessage._id, from: userId, to: [], content: '', type: 'image',
        createdAt: savedMessage.timestamp, roomId, fileMeta: savedMessage.fileMeta,
        replyTo: savedMessage.replyTo || null,
      });
      result = savedMessage.fileMeta;
    } else {
      result = await uploadFileService(userId, roomId, makeMeta(uploadedFiles[0]), io, replyToId);
    }

    return res.json({ success: true, result });
  } catch (err) {
    await Promise.all(uploadedFiles.map(file => fs.unlink(file.path).catch(() => {})));
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// Đánh dấu tin nhắn đã đọc
export const editMessage = async (req, res) => {
  try {
    const message = await editMessageService({
      messageId: req.params.messageId,
      userId: req.userId,
      content: req.body?.content,
      io: req.app.get('io'),
    });
    res.json({ success: true, message });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const result = await deleteMessageService({
      messageId: req.params.messageId,
      userId: req.userId,
      scope: req.body?.scope,
      io: req.app.get('io'),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const toggleMessageReaction = async (req, res) => {
  try {
    const result = await toggleMessageReactionService({
      messageId: req.params.messageId,
      userId: req.userId,
      emoji: req.body?.emoji,
      io: req.app.get('io'),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

export const forwardMessage = async (req, res) => {
  try {
    const message = await forwardMessageService({
      messageId: req.params.messageId,
      userId: req.userId,
      targetRoomId: req.body?.targetRoomId,
      io: req.app.get('io'),
    });
    res.status(201).json({ success: true, message });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
};

const getMemberGroupForPins = async (req, res) => {
  const {roomId} = req.params;
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    res.status(400).json({error: 'Phòng chat không hợp lệ'});
    return null;
  }
  const room = await Room.findOne({_id: roomId, participants: req.userId, deletedAt: null}).lean();
  if (!room) {
    res.status(403).json({error: 'Bạn không có quyền truy cập phòng này'});
    return null;
  }
  if (room.type !== 'group') {
    res.status(409).json({error: 'Bảng tin ghim chỉ khả dụng trong nhóm'});
    return null;
  }
  return room;
};

const loadGroupPins = async (room, userId) => {
  const ids = Array.isArray(room.pinnedMessageIds) ? room.pinnedMessageIds : [];
  if (!ids.length) return [];
  const messages = await Message.find({
    _id: {$in: ids},
    roomId: room._id,
    deletedAt: null,
    deletedFor: {$ne: userId},
  }).select('+poll.ballots').sort({timestamp: -1, _id: -1}).lean();
  return messages.map(message => serializePollMessage(message, userId));
};

export const getGroupPins = async (req, res) => {
  try {
    const room = await getMemberGroupForPins(req, res);
    if (!room) return;
    res.json({roomId: String(room._id), messages: await loadGroupPins(room, req.userId)});
  } catch (error) {
    res.status(500).json({error: `Không tải được bảng tin nhóm: ${error.message}`});
  }
};

export const pinGroupMessage = async (req, res) => {
  try {
    const room = await getMemberGroupForPins(req, res);
    if (!room) return;
    const {messageId} = req.params;
    if (!mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({error: 'Tin nhắn không hợp lệ'});
    const message = await Message.findOne({
      _id: messageId,
      roomId: room._id,
      deletedAt: null,
      deletedFor: {$ne: req.userId},
    }).select('_id').lean();
    if (!message) return res.status(404).json({error: 'Không tìm thấy tin nhắn trong nhóm này'});

    const updated = await Room.updateOne(
      {_id: room._id, participants: req.userId, type: 'group', deletedAt: null},
      {$addToSet: {pinnedMessageIds: message._id}},
    );
    if (!updated.matchedCount) return res.status(403).json({error: 'Bạn không còn quyền truy cập nhóm này'});
    const updatedRoom = await Room.findById(room._id).lean();
    const messages = await loadGroupPins(updatedRoom || room, req.userId);
    const payload = {roomId: String(room._id), messageId: String(message._id), action: 'pin', updatedBy: String(req.userId)};
    req.app.get('io')?.to(String(room._id)).emit('groupPinUpdated', payload);
    res.json({success: true, ...payload, messages});
  } catch (error) {
    res.status(error.status || 500).json({error: `Không ghim được tin nhắn: ${error.message}`});
  }
};

export const unpinGroupMessage = async (req, res) => {
  try {
    const room = await getMemberGroupForPins(req, res);
    if (!room) return;
    const {messageId} = req.params;
    if (!mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({error: 'Tin nhắn không hợp lệ'});

    const updated = await Room.updateOne(
      {_id: room._id, participants: req.userId, type: 'group', deletedAt: null},
      {$pull: {pinnedMessageIds: new mongoose.Types.ObjectId(messageId)}},
    );
    if (!updated.matchedCount) return res.status(403).json({error: 'Bạn không còn quyền truy cập nhóm này'});
    const updatedRoom = await Room.findById(room._id).lean();
    const messages = await loadGroupPins(updatedRoom || room, req.userId);
    const payload = {roomId: String(room._id), messageId, action: 'unpin', updatedBy: String(req.userId)};
    req.app.get('io')?.to(String(room._id)).emit('groupPinUpdated', payload);
    res.json({success: true, ...payload, messages});
  } catch (error) {
    res.status(error.status || 500).json({error: `Không bỏ ghim được tin nhắn: ${error.message}`});
  }
};

const getMemberGroupForPolls = async (req, res) => {
  const {roomId} = req.params;
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    res.status(400).json({error: 'Phòng chat không hợp lệ'});
    return null;
  }
  const room = await Room.findOne({_id: roomId, participants: req.userId, deletedAt: null}).lean();
  if (!room) {
    res.status(403).json({error: 'Bạn không có quyền truy cập phòng này'});
    return null;
  }
  if (room.type !== 'group') {
    res.status(409).json({error: 'Bình chọn chỉ khả dụng trong nhóm'});
    return null;
  }
  return room;
};

const loadPollMessage = async (roomId, messageId) => {
  if (!mongoose.Types.ObjectId.isValid(messageId)) throw Object.assign(new Error('Tin nhắn không hợp lệ'), {status: 400});
  const message = await Message.findOne({_id: messageId, roomId, type: 'poll', deletedAt: null}).select('+poll.ballots');
  if (!message) throw Object.assign(new Error('Không tìm thấy bình chọn trong nhóm này'), {status: 404});
  return message;
};

const pollIsOpen = poll => !poll.closedAt && (!poll.endAt || new Date(poll.endAt).getTime() > Date.now());
const emitPollUpdated = (req, roomId, messageId) => {
  req.app.get('io')?.to(String(roomId)).emit('pollUpdated', {roomId: String(roomId), messageId: String(messageId)});
};

export const getGroupPoll = async (req, res) => {
  try {
    const room = await getMemberGroupForPolls(req, res);
    if (!room) return;
    const message = await loadPollMessage(room._id, req.params.messageId);
    const publicPoll = serializeGroupPoll(message.poll, req.userId);
    let profiles = [];
    if (!publicPoll.anonymous && !publicPoll.resultsHidden) {
      const ballots = message.poll.ballots || [];
      const voterIds = Array.from(new Set(ballots.map(ballot => String(ballot.userId))));
      profiles = voterIds.length ? await User.find({lv001: {$in: voterIds}}).select('lv001 name avatar').lean() : [];
    }
    const poll = serializeGroupPollDetails(message.poll, req.userId, profiles);
    res.json({roomId: String(room._id), messageId: String(message._id), poll});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không tải được bình chọn'});
  }
};

export const voteGroupPoll = async (req, res) => {
  try {
    const room = await getMemberGroupForPolls(req, res);
    if (!room) return;
    const message = await loadPollMessage(room._id, req.params.messageId);
    if (!pollIsOpen(message.poll)) return res.status(409).json({error: 'Bình chọn đã kết thúc'});

    const requested = req.body?.optionIds;
    if (!Array.isArray(requested) || requested.length > GROUP_POLL_LIMITS.MAX_OPTIONS
      || requested.some(id => typeof id !== 'string') || new Set(requested).size !== requested.length) {
      return res.status(400).json({error: 'Danh sách lựa chọn không hợp lệ'});
    }
    if (!message.poll.allowMultiple && requested.length > 1) return res.status(400).json({error: 'Bình chọn này chỉ cho phép chọn một đáp án'});
    const availableIds = new Set(message.poll.options.map(option => String(option.id)));
    if (requested.some(id => !availableIds.has(id))) return res.status(400).json({error: 'Lựa chọn không thuộc bình chọn này'});

    const ballots = (message.poll.ballots || []).filter(ballot => String(ballot.userId) !== String(req.userId))
      .map(ballot => ({userId: String(ballot.userId), optionIds: ballot.optionIds.map(String)}));
    if (requested.length) ballots.push({userId: String(req.userId), optionIds: requested});
    message.poll.ballots = ballots;
    recalculatePollCounts(message.poll);
    await message.save();
    emitPollUpdated(req, room._id, message._id);
    res.json({success: true, poll: serializeGroupPoll(message.poll, req.userId)});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không gửi được bình chọn'});
  }
};

export const addGroupPollOption = async (req, res) => {
  try {
    const room = await getMemberGroupForPolls(req, res);
    if (!room) return;
    const message = await loadPollMessage(room._id, req.params.messageId);
    if (!pollIsOpen(message.poll)) return res.status(409).json({error: 'Bình chọn đã kết thúc'});
    if (!message.poll.allowAddOptions) return res.status(403).json({error: 'Người tạo không cho phép thêm lựa chọn'});
    if (message.poll.options.length >= GROUP_POLL_LIMITS.MAX_OPTIONS) return res.status(409).json({error: 'Bình chọn đã đủ số lựa chọn'});

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > GROUP_POLL_LIMITS.MAX_OPTION_LENGTH) return res.status(400).json({error: `Lựa chọn cần từ 1 đến ${GROUP_POLL_LIMITS.MAX_OPTION_LENGTH} ký tự`});
    if (message.poll.options.some(option => option.text.toLocaleLowerCase() === text.toLocaleLowerCase())) return res.status(409).json({error: 'Lựa chọn này đã có trong bình chọn'});
    message.poll.options.push({id: randomUUID(), text, voteCount: 0});
    await message.save();
    emitPollUpdated(req, room._id, message._id);
    res.json({success: true, poll: serializeGroupPoll(message.poll, req.userId)});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thêm được lựa chọn'});
  }
};

export const closeGroupPoll = async (req, res) => {
  try {
    const room = await getMemberGroupForPolls(req, res);
    if (!room) return;
    const message = await loadPollMessage(room._id, req.params.messageId);
    const isAdmin = String(room.createdBy) === String(req.userId) || (room.admins || []).some(id => String(id) === String(req.userId));
    if (String(message.poll.createdBy) !== String(req.userId) && !isAdmin) return res.status(403).json({error: 'Chỉ người tạo bình chọn hoặc quản trị viên mới có thể kết thúc'});
    if (!message.poll.closedAt) {
      message.poll.closedAt = new Date();
      await message.save();
    }
    emitPollUpdated(req, room._id, message._id);
    res.json({success: true, poll: serializeGroupPoll(message.poll, req.userId)});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không kết thúc được bình chọn'});
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.user;

    if (!messageId) {
      return res.status(400).json({ error: 'messageId là bắt buộc' });
    }

    const message = await markMessageAsRead(messageId, userId);
    res.json({
      success: true,
      message: 'Đã đánh dấu tin nhắn là đã đọc',
      data: message
    });
  } catch (error) {
    res.status(500).json({ error: `Lỗi đánh dấu tin nhắn đã đọc: ${error.message}` });
  }
};

// Đánh dấu tất cả tin nhắn trong room đã đọc
export const markAllAsRead = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.user;

    if (!roomId) {
      return res.status(400).json({ error: 'roomId là bắt buộc' });
    }

    // Kiểm tra user có phải thành viên của phòng không
    const room = await Room.findOne({ _id: roomId });
    if (!room || !room.participants.includes(userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập phòng này' });
    }

    const result = await markAllMessagesAsRead(roomId, userId);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: `Lỗi đánh dấu tất cả tin nhắn đã đọc: ${error.message}` });
  }
};

// Lấy số lượng tin nhắn chưa đọc
export const getUnreadCount = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.user;

    if (!roomId) {
      return res.status(400).json({ error: 'roomId là bắt buộc' });
    }

    // Kiểm tra user có phải thành viên của phòng không
    const room = await Room.findOne({ _id: roomId });
    if (!room || !room.participants.includes(userId)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập phòng này' });
    }

    const unreadCount = await getUnreadMessagesCount(roomId, userId);
    res.json({
      success: true,
      unreadCount,
      roomId
    });
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy số tin nhắn chưa đọc: ${error.message}` });
  }
};

export const updateLiveLocation = async (req, res) => {
  try {
    if (!await requireRoom(req, res)) return;
    const sessionId = String(req.params.sessionId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) return res.status(400).json({error: 'Mã phiên vị trí không hợp lệ'});

    const message = await Message.findOne({roomId: req.query.roomId, userId: req.userId, 'location.liveSessionId': sessionId, type: 'location'}).lean();
    if (!message) return res.status(404).json({error: 'Không tìm thấy phiên vị trí trực tiếp'});
    if (message.deletedAt || !message.location?.isLive || message.location?.status !== 'active') {
      return res.status(410).json({error: 'Phiên chia sẻ vị trí đã dừng'});
    }

    const now = new Date();
    const expiresAt = new Date(message.location.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
      await Message.updateOne({_id: message._id}, {$set: {'location.isLive': false, 'location.status': 'expired'}});
      req.app.get('io')?.to(String(req.query.roomId)).emit('liveLocationStopped', {roomId: String(req.query.roomId), sessionId, userId: req.userId, status: 'expired'});
      return res.status(410).json({error: 'Phiên chia sẻ vị trí đã hết hạn'});
    }

    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = req.body?.accuracy == null ? undefined : Number(req.body.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))) {
      return res.status(400).json({error: 'Tọa độ vị trí không hợp lệ'});
    }

    const location = {
      latitude,
      longitude,
      ...(accuracy === undefined ? {} : {accuracy}),
      liveSessionId: sessionId,
      isLive: true,
      expiresAt,
      status: 'active',
      lastUpdatedAt: now,
    };
    const $set = Object.fromEntries(Object.entries(location).map(([key, value]) => [`location.${key}`, value]));
    const updated = await Message.findOneAndUpdate(
      {_id: message._id, userId: req.userId, 'location.isLive': true, 'location.status': 'active'},
      {$set},
      {new: true},
    ).lean();
    if (!updated) return res.status(409).json({error: 'Phiên vị trí vừa dừng. Hãy bắt đầu chia sẻ lại.'});

    const payload = {roomId: String(req.query.roomId), sessionId, userId: req.userId, location: updated.location};
    req.app.get('io')?.to(String(req.query.roomId)).emit('liveLocationUpdated', payload);
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thể cập nhật vị trí trực tiếp'});
  }
};

export const stopLiveLocation = async (req, res) => {
  try {
    if (!await requireRoom(req, res)) return;
    const sessionId = String(req.params.sessionId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) return res.status(400).json({error: 'Mã phiên vị trí không hợp lệ'});
    const message = await Message.findOne({roomId: req.query.roomId, userId: req.userId, 'location.liveSessionId': sessionId});
    if (!message) return res.status(404).json({error: 'Không tìm thấy phiên vị trí trực tiếp'});

    let status = message.location?.status || 'stopped';
    if (message.location?.isLive && status === 'active') {
      const expiresAt = new Date(message.location.expiresAt);
      status = Number.isFinite(expiresAt.getTime()) && expiresAt > new Date() && !message.deletedAt ? 'stopped' : 'expired';
      message.location.isLive = false;
      message.location.status = status;
      message.location.stoppedAt = new Date();
      await message.save();
    }
    const payload = {roomId: String(req.query.roomId), sessionId, userId: req.userId, status};
    req.app.get('io')?.to(String(req.query.roomId)).emit('liveLocationStopped', payload);
    res.json({success: true, isLive: false, status});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thể dừng chia sẻ vị trí'});
  }
};
