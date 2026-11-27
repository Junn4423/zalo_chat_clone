import Message from '../models/Message.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import Friendship from '../models/Friendship.js';
import ChatPreference from '../models/ChatPreference.js';
import GroupInvite from '../models/GroupInvite.js';
import mongoose from 'mongoose';
import {createHash, randomBytes} from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const friendshipPairKey = (a, b) => JSON.stringify([String(a), String(b)].sort());
const hashGroupInviteToken = token => createHash('sha256').update(token).digest('hex');

export const validateGroupParticipantIds = ({memberIds, createdBy, acceptedPairKeys}) => {
  const creatorId = typeof createdBy === 'string' ? createdBy.trim() : '';
  if (!creatorId || !Array.isArray(memberIds) || memberIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw Object.assign(new Error('Danh sách thành viên không hợp lệ'), {status: 400});
  }

  const invitees = [...new Set(memberIds.map(id => id.trim()))].filter(id => id !== creatorId);
  if (invitees.length < 2) {
    throw Object.assign(new Error('Hãy chọn ít nhất hai người bạn đã kết bạn để tạo nhóm'), {status: 400});
  }

  const accepted = new Set(acceptedPairKeys || []);
  if (invitees.some(id => !accepted.has(friendshipPairKey(creatorId, id)))) {
    throw Object.assign(new Error('Chỉ có thể tạo nhóm với bạn bè đã kết bạn'), {status: 403});
  }

  return [...invitees, creatorId];
};

// Tạo phòng 1-1
export const getOrCreateOneToOneRoomService = async (userId1, userId2) => {
  try {
    // Kiểm tra user tồn tại
    const [user1, user2] = await Promise.all([
      User.findOne({ lv001: userId1 }),
      User.findOne({ lv001: userId2 }),
    ]);
    if (!user1 || !user2) {
      throw new Error('Một hoặc cả hai người dùng không tồn tại');
    }

    const sortedUserIds = [userId1, userId2].sort();
    const uniquePair = sortedUserIds.join('_');
    const existingRoom = await Room.findOne({
      uniquePair,
      type: 'one-to-one',
    });
    if (existingRoom) {
      return existingRoom.toObject();
    }

    const room = new Room({
      participants: sortedUserIds,
      uniquePair,
      type: 'one-to-one',
      createdAt: new Date(),
    });

    await room.save();
    return room.toObject();
  } catch (error) {
    console.error(`Room Service: Error creating room for users ${userId1}, ${userId2}`, { error: error.message });
    throw new Error(`Lỗi tạo phòng: ${error.message}`);
  }
};

export const createGroupService = async ({ tenNhom, thanhVien, groupImage }, createdBy) => {
  try {
    if (typeof tenNhom !== 'string' || !tenNhom.trim() || !Array.isArray(thanhVien)) {
      throw Object.assign(new Error('Tên nhóm và danh sách thành viên là bắt buộc'), {status: 400});
    }

    const creatorId = typeof createdBy === 'string' ? createdBy.trim() : '';
    const invitees = [...new Set(thanhVien.filter(id => typeof id === 'string').map(id => id.trim()).filter(Boolean))]
      .filter(id => id !== creatorId);
    const candidatePairKeys = invitees.map(id => friendshipPairKey(creatorId, id));
    const [users, friendships] = await Promise.all([
      User.find({lv001: {$in: invitees}}).select('lv001').lean(),
      Friendship.find({pairKey: {$in: candidatePairKeys}, status: 'accepted'}).select('pairKey').lean(),
    ]);
    if (users.length !== invitees.length) {
      throw Object.assign(new Error('Một hoặc nhiều thành viên không tồn tại'), {status: 404});
    }
    const participants = validateGroupParticipantIds({
      memberIds: invitees,
      createdBy: creatorId,
      acceptedPairKeys: friendships.map(friendship => friendship.pairKey),
    });

    let groupImagePath = null;
    if (groupImage) {
      // Xử lý base64 image
      const matches = groupImage.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      if (!matches) {
        throw new Error('Hình ảnh không hợp lệ');
      }
      const extension = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `${Date.now()}_group.${extension}`;
      const uploadDirectory = process.env.CHAT_UPLOAD_DIR || path.join(__dirname, '../Uploads');
      fs.mkdirSync(uploadDirectory, {recursive: true});
      const uploadPath = path.join(uploadDirectory, filename);
      fs.writeFileSync(uploadPath, buffer);
      groupImagePath = filename;
    }

    const room = new Room({
      name: tenNhom,
      participants,
      type: 'group',
      createdBy: creatorId,
      groupImage: groupImagePath,
      createdAt: new Date(),
    });
    await room.save();

    return room.toObject();
  } catch (error) {
    console.error(`Room Service: Error creating group ${tenNhom}`, { error: error.message });
    throw Object.assign(new Error(`Lỗi tạo nhóm: ${error.message}`), {status: error.status || 500});
  }
}

const requireGroupManager = async (room, userId) => {
  const user = await User.findOne({lv001: userId}).select('role').lean();
  const isGroupAdmin = Array.isArray(room.admins) && room.admins.some(id => String(id) === String(userId));
  if (String(room.createdBy) !== String(userId) && !isGroupAdmin && user?.role !== 'admin') {
    throw Object.assign(new Error('Bạn không có quyền quản lý nhóm'), {status: 403});
  }
};

export const getGroupMembersService = async (roomId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null}).lean();
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  const users = await User.find({lv001: {$in: room.participants}}).select('lv001 name avatar onlineStatus role').lean();
  const byId = new Map(users.map(user => [String(user.lv001), user]));
  return {
    roomId: String(room._id),
    name: room.name,
    groupImage: room.groupImage || null,
    createdBy: room.createdBy,
    canManage: String(room.createdBy) === String(userId)
      || (Array.isArray(room.admins) && room.admins.some(id => String(id) === String(userId)))
      || users.some(user => String(user.lv001) === String(userId) && user.role === 'admin'),
    members: room.participants.map(id => {
      const user = byId.get(String(id));
      return {username: String(id), name: user?.name || String(id), avatar: user?.avatar || null, online: !!user?.onlineStatus, isOwner: String(id) === String(room.createdBy), isAdmin: Array.isArray(room.admins) && room.admins.some(adminId => String(adminId) === String(id))};
    }),
  };
};

export const addGroupMembersService = async ({roomId, userId, userIds, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 50 || userIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw Object.assign(new Error('Danh sách thành viên không hợp lệ'), {status: 400});
  }
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  await requireGroupManager(room, userId);

  const addIds = [...new Set(userIds.map(id => id.trim()))].filter(id => !room.participants.includes(id));
  if (!addIds.length) return {room: room.toObject(), added: []};
  const users = await User.find({lv001: {$in: addIds}}).select('lv001').lean();
  if (users.length !== addIds.length) throw Object.assign(new Error('Một hoặc nhiều tài khoản không tồn tại'), {status: 404});

  const pairKeys = addIds.map(id => JSON.stringify([userId, id].sort()));
  const friendships = await Friendship.find({pairKey: {$in: pairKeys}, status: 'accepted'}).select('pairKey').lean();
  if (friendships.length !== addIds.length) throw Object.assign(new Error('Chỉ có thể thêm bạn bè đã kết bạn'), {status: 403});

  room.participants.push(...addIds);
  await room.save();
  const payload = {roomId: String(room._id), participants: room.participants.map(String), added: addIds};
  io?.to(room._id.toString()).emit('groupMembersUpdated', payload);
  for (const socket of io?.sockets?.sockets?.values?.() || []) {
    const socketUserId = String(socket.userId || '');
    if (!addIds.includes(socketUserId)) continue;
    const hiddenForSocketUser = await ChatPreference.exists({userId: socketUserId, roomId: room._id, hidden: true});
    if (!hiddenForSocketUser) socket.join(room._id.toString());
  }
  for (const id of addIds) io?.to(id).emit('groupCreated', room.toObject());
  return {room: room.toObject(), added: addIds};
};

export const createGroupInviteService = async ({roomId, userId}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null}).select('_id name').lean();
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await GroupInvite.updateMany({roomId: room._id, revokedAt: null}, {$set: {revokedAt: now}});
  await GroupInvite.create({roomId: room._id, tokenHash: hashGroupInviteToken(token), createdBy: String(userId), expiresAt});
  return {roomId: String(room._id), name: room.name, token, expiresAt};
};

export const joinGroupByInviteService = async ({token, userId, io}) => {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(normalizedToken) || !normalizedUserId) {
    throw Object.assign(new Error('Liên kết mời không hợp lệ'), {status: 400});
  }
  const invite = await GroupInvite.findOne({tokenHash: hashGroupInviteToken(normalizedToken), revokedAt: null}).lean();
  if (!invite) throw Object.assign(new Error('Liên kết mời không hợp lệ hoặc đã bị thu hồi'), {status: 404});
  if (new Date(invite.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error('Liên kết mời đã hết hạn'), {status: 410});

  const [room, user] = await Promise.all([
    Room.findOne({_id: invite.roomId, type: 'group', deletedAt: null}),
    User.findOne({lv001: normalizedUserId}).select('lv001').lean(),
  ]);
  if (!room || !user) throw Object.assign(new Error('Không tìm thấy nhóm hoặc tài khoản'), {status: 404});
  const alreadyMember = room.participants.some(id => String(id) === normalizedUserId);
  if (!alreadyMember) {
    room.participants.push(normalizedUserId);
    await room.save();
    const payload = {roomId: String(room._id), participants: room.participants.map(String), added: [normalizedUserId]};
    io?.to(String(room._id)).emit('groupMembersUpdated', payload);
    for (const socket of io?.sockets?.sockets?.values?.() || []) {
      if (String(socket.userId || '') !== normalizedUserId) continue;
      const hidden = await ChatPreference.exists({userId: normalizedUserId, roomId: room._id, hidden: true});
      if (!hidden) socket.join(String(room._id));
    }
    io?.to(normalizedUserId).emit('groupCreated', room.toObject());
  }
  return {roomId: String(room._id), name: room.name, groupImage: room.groupImage || null, type: room.type, joined: !alreadyMember};
};

export const removeGroupMemberService = async ({roomId, userId, memberId, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (typeof memberId !== 'string' || !memberId.trim()) throw Object.assign(new Error('Tài khoản thành viên không hợp lệ'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  await requireGroupManager(room, userId);
  if (String(memberId) === String(room.createdBy)) throw Object.assign(new Error('Không thể xóa trưởng nhóm khỏi nhóm'), {status: 409});
  if (!room.participants.includes(memberId)) throw Object.assign(new Error('Tài khoản này không thuộc nhóm'), {status: 404});
  if (String(room.createdBy) !== String(userId) && (room.admins || []).some(id => String(id) === String(memberId))) {
    throw Object.assign(new Error('Chỉ trưởng nhóm mới có thể xóa quản trị viên khác'), {status: 403});
  }

  room.participants = room.participants.filter(id => String(id) !== String(memberId));
  room.admins = (room.admins || []).filter(id => String(id) !== String(memberId));
  await room.save();
  const payload = {roomId: String(room._id), participants: room.participants.map(String), removed: memberId};
  io?.to(room._id.toString()).emit('groupMembersUpdated', payload);
  for (const socket of io?.sockets?.sockets?.values?.() || []) {
    if (String(socket.userId) === String(memberId)) socket.leave(room._id.toString());
  }
  io?.to(String(memberId)).emit('groupRemoved', {roomId: String(room._id), roomName: room.name});
  return {room: room.toObject(), removed: memberId};
};

export const renameGroupService = async ({roomId, userId, name, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 80) throw Object.assign(new Error('Tên nhóm phải từ 1 đến 80 ký tự'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  await requireGroupManager(room, userId);
  room.name = normalizedName;
  await room.save();
  const payload = {roomId: String(room._id), name: room.name};
  for (const memberId of room.participants) io?.to(String(memberId)).emit('groupRenamed', payload);
  return payload;
};

export const setGroupImageService = async ({roomId, userId, image, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (image !== null && (typeof image !== 'string' || image.length > 7_000_000)) {
    throw Object.assign(new Error('Ảnh nhóm vượt quá giới hạn cho phép'), {status: 413});
  }
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  await requireGroupManager(room, userId);

  let nextImage = null;
  let nextFilePath = null;
  if (image !== null) {
    const match = image.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) throw Object.assign(new Error('Ảnh phải là PNG, JPEG hoặc WebP hợp lệ'), {status: 400});
    const extension = match[1].toLowerCase().replace('jpeg', 'jpg');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Object.assign(new Error('Ảnh nhóm tối đa 5 MB'), {status: 413});
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}_group.${extension}`;
    const uploadDirectory = process.env.CHAT_UPLOAD_DIR || path.join(__dirname, '../Uploads');
    fs.mkdirSync(uploadDirectory, {recursive: true});
    nextFilePath = path.join(uploadDirectory, filename);
    fs.writeFileSync(nextFilePath, bytes);
    nextImage = filename;
  }

  room.groupImage = nextImage;
  try {
    await room.save();
  } catch (error) {
    if (nextFilePath) fs.promises.unlink(nextFilePath).catch(() => {});
    throw error;
  }

  const payload = {roomId: String(room._id), groupImage: nextImage};
  for (const memberId of room.participants) io?.to(String(memberId)).emit('groupImageChanged', payload);
  return payload;
};

export const setGroupAdminService = async ({roomId, userId, memberId, isAdmin, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (typeof memberId !== 'string' || !memberId.trim() || typeof isAdmin !== 'boolean') {
    throw Object.assign(new Error('Thành viên hoặc quyền quản trị không hợp lệ'), {status: 400});
  }
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  if (String(room.createdBy) !== String(userId)) {
    throw Object.assign(new Error('Chỉ trưởng nhóm mới có thể cấp hoặc thu hồi quyền quản trị'), {status: 403});
  }
  if (!room.participants.some(id => String(id) === String(memberId))) {
    throw Object.assign(new Error('Tài khoản này không thuộc nhóm'), {status: 404});
  }
  if (String(memberId) === String(room.createdBy)) {
    throw Object.assign(new Error('Trưởng nhóm không cần cấp quyền quản trị riêng'), {status: 409});
  }

  const admins = new Set((room.admins || []).map(String));
  if (isAdmin) admins.add(String(memberId));
  else admins.delete(String(memberId));
  room.admins = [...admins];
  await room.save();

  const payload = {roomId: String(room._id), memberId: String(memberId), isAdmin, admins: room.admins.map(String)};
  for (const participantId of room.participants) io?.to(String(participantId)).emit('groupAdminChanged', payload);
  return payload;
};

export const transferGroupOwnershipService = async ({roomId, userId, newOwnerId, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (typeof newOwnerId !== 'string' || !newOwnerId.trim()) throw Object.assign(new Error('Tài khoản trưởng nhóm mới không hợp lệ'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});
  if (String(room.createdBy) !== String(userId)) throw Object.assign(new Error('Chỉ trưởng nhóm hiện tại mới có thể chuyển quyền'), {status: 403});
  if (String(room.createdBy) === String(newOwnerId) || !room.participants.some(id => String(id) === String(newOwnerId))) {
    throw Object.assign(new Error('Trưởng nhóm mới phải là thành viên khác trong nhóm'), {status: 400});
  }

  room.createdBy = newOwnerId;
  room.admins = (room.admins || []).filter(id => String(id) !== String(newOwnerId) && String(id) !== String(userId));
  await room.save();
  const payload = {roomId: String(room._id), createdBy: String(room.createdBy), previousOwner: String(userId)};
  for (const memberId of room.participants) io?.to(String(memberId)).emit('groupOwnerChanged', payload);
  for (const memberId of room.participants) io?.to(String(memberId)).emit('groupAdminChanged', {roomId: String(room._id), memberId: String(newOwnerId), isAdmin: false, admins: room.admins.map(String)});
  return payload;
};

export const leaveGroupService = async ({roomId, userId, newOwnerId, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  const room = await Room.findOne({_id: roomId, type: 'group', participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy nhóm hoặc bạn không phải thành viên'), {status: 404});

  const wasOwner = String(room.createdBy) === String(userId);
  if (wasOwner) {
    const successorId = typeof newOwnerId === 'string' ? newOwnerId.trim() : '';
    if (!successorId || successorId === String(userId) || !room.participants.some(id => String(id) === successorId)) {
      throw Object.assign(new Error('Hãy chọn một thành viên khác trong nhóm làm trưởng nhóm mới'), {status: 400});
    }
    room.createdBy = successorId;
    room.admins = (room.admins || []).filter(id => String(id) !== successorId && String(id) !== String(userId));
  }

  room.participants = room.participants.filter(id => String(id) !== String(userId));
  room.admins = (room.admins || []).filter(id => String(id) !== String(userId));
  await room.save();
  for (const socket of io?.sockets?.sockets?.values?.() || []) {
    if (String(socket.userId) === String(userId)) socket.leave(room._id.toString());
  }
  const payload = {
    roomId: String(room._id),
    participants: room.participants.map(String),
    removed: String(userId),
    ...(wasOwner ? {createdBy: String(room.createdBy), previousOwner: String(userId)} : {}),
  };
  if (wasOwner) io?.to(room._id.toString()).emit('groupOwnerChanged', payload);
  io?.to(room._id.toString()).emit('groupMembersUpdated', payload);
  io?.to(String(userId)).emit('groupRemoved', {roomId: String(room._id), roomName: room.name});
  return {roomId: String(room._id), name: room.name, ...(wasOwner ? {createdBy: String(room.createdBy)} : {})};
};

export const getRoomPreferenceService = async (roomId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  const room = await Room.exists({_id: roomId, participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy phòng chat hoặc bạn không phải thành viên'), {status: 404});
  const preference = await ChatPreference.findOne({userId, roomId}).lean();
  const isMuted = Boolean(preference?.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
  return {roomId: String(roomId), isMuted, mutedUntil: isMuted ? preference?.mutedUntil ?? null : null, isPinned: Boolean(preference?.pinned), isHidden: Boolean(preference?.hidden)};
};

export const setRoomHiddenService = async ({roomId, userId, hidden, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId) || typeof hidden !== 'boolean') throw Object.assign(new Error('Dữ liệu ẩn trò chuyện không hợp lệ'), {status: 400});
  if (!await Room.exists({_id: roomId, participants: userId, deletedAt: null})) throw Object.assign(new Error('Không tìm thấy cuộc trò chuyện'), {status: 404});
  if (hidden && !await User.exists({lv001: userId, hiddenChatPinHash: {$exists: true, $ne: null}})) {
    throw Object.assign(new Error('Hãy tạo mã khóa trò chuyện ẩn trước'), {status: 409});
  }
  const preference = await ChatPreference.findOneAndUpdate(
    {userId, roomId},
    {$set: {hidden}},
    {new: true, upsert: true, setDefaultsOnInsert: true},
  ).lean();
  const isMuted = Boolean(preference.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
  const payload = {roomId: String(roomId), isHidden: Boolean(preference.hidden), isPinned: Boolean(preference.pinned), isMuted, mutedUntil: isMuted ? preference.mutedUntil ?? null : null};
  if (hidden && io?.sockets?.sockets) {
    for (const socket of io.sockets.sockets.values()) {
      if (String(socket.userId || socket.context?.userId || '') !== String(userId)) continue;
      await socket.leave(String(roomId));
      const timers = socket.data?.hiddenRoomExpiryTimers;
      const timer = timers?.get(String(roomId));
      if (timer) clearTimeout(timer);
      timers?.delete(String(roomId));
      socket.emit('hiddenChatAccessRevoked', {roomId: String(roomId)});
    }
  }
  io?.to(String(userId)).emit('chatPreferenceChanged', payload);
  return payload;
};

export const getMyHiddenRoomIdsService = async userId => {
  const roomIds = await ChatPreference.find({userId, hidden: true}).distinct('roomId');
  return roomIds.map(String);
};

export const setRoomMuteService = async ({roomId, userId, muted, mutedUntil, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) throw Object.assign(new Error('Phòng chat không hợp lệ'), {status: 400});
  if (typeof muted !== 'boolean') throw Object.assign(new Error('Trạng thái thông báo không hợp lệ'), {status: 400});
  const room = await Room.exists({_id: roomId, participants: userId, deletedAt: null});
  if (!room) throw Object.assign(new Error('Không tìm thấy phòng chat hoặc bạn không phải thành viên'), {status: 404});

  let normalizedUntil = null;
  if (muted && mutedUntil !== undefined && mutedUntil !== null) {
    normalizedUntil = new Date(mutedUntil);
    if (Number.isNaN(normalizedUntil.getTime()) || normalizedUntil <= new Date()) {
      throw Object.assign(new Error('Thời hạn tắt thông báo không hợp lệ'), {status: 400});
    }
  }
  const preference = await ChatPreference.findOneAndUpdate(
    {userId, roomId},
    {$set: {muted, mutedUntil: muted ? normalizedUntil : null}},
    {new: true, upsert: true, setDefaultsOnInsert: true},
  ).lean();
  const isMuted = Boolean(preference.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
  const payload = {roomId: String(roomId), isMuted, mutedUntil: isMuted ? preference.mutedUntil ?? null : null, isPinned: Boolean(preference.pinned), isHidden: Boolean(preference.hidden)};
  io?.to(String(userId)).emit('chatPreferenceChanged', payload);
  return payload;
};

export const setRoomPinService = async ({roomId, userId, pinned, io}) => {
  if (!mongoose.Types.ObjectId.isValid(roomId) || typeof pinned !== 'boolean') throw Object.assign(new Error('Dữ liệu ghim không hợp lệ'), {status: 400});
  if (!await Room.exists({_id: roomId, participants: userId, deletedAt: null})) throw Object.assign(new Error('Không tìm thấy cuộc trò chuyện'), {status: 404});
  const preference = await ChatPreference.findOneAndUpdate({userId, roomId}, {$set: {pinned}}, {new: true, upsert: true, setDefaultsOnInsert: true}).lean();
  const isMuted = Boolean(preference.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
  const payload = {roomId: String(roomId), isPinned: Boolean(preference.pinned), isMuted, mutedUntil: isMuted ? preference.mutedUntil ?? null : null, isHidden: Boolean(preference.hidden)};
  io?.to(String(userId)).emit('chatPreferenceChanged', payload);
  return payload;
};

export const getMyRoomsService = async (userId, {hiddenOnly = false} = {}) => {
  try {
    if (!userId) throw new Error("userId là bắt buộc");
    const hiddenRoomIds = await ChatPreference.find({userId, hidden: true}).distinct('roomId');
    const rooms = await Room.aggregate([
      {
        $match: {
          participants: userId,
          ...(hiddenOnly ? {_id: {$in: hiddenRoomIds}} : {_id: {$nin: hiddenRoomIds}}),
        }
      },
      // Lọc bỏ các phòng có deletedAt chứa giá trị
      {
        $match: { deletedAt: { $eq: null } }
      },
      // Lookup tin nhắn mới nhất cho mỗi room
      {
        $lookup: {
          from: "messages",
          let: { roomId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$roomId", "$$roomId"] },
              { $not: [{ $in: [userId, { $ifNull: ["$deletedFor", []] }] }] },
            ] } } },
            { $sort: { timestamp: -1 } },
            { $limit: 1 }
          ],
          as: "lastMessage"
        }
      },
      // Rã mảng lastMessage và thêm trường hasLastMessage
      {
        $unwind: {
          path: "$lastMessage",
          preserveNullAndEmptyArrays: true // Giữ các phòng không có tin nhắn
        }
      },
      // Lookup user gửi tin nhắn cuối cùng
      {
        $lookup: {
          from: "users",
          localField: "lastMessage.userId",
          foreignField: "lv001",
          pipeline: [
            { $project: { name: 1, _id: 0 } }
          ],
          as: "lastMessageSender"
        }
      },
      {
        $addFields: {
          "lastMessage.name": {
            $arrayElemAt: ["$lastMessageSender.name", 0]
          },
          hasLastMessage: {
            $cond: [{ $ifNull: ["$lastMessage", false] }, 1, 0]
          },
          lastMessageTime: {
            $ifNull: ["$lastMessage.timestamp", "$createdAt"]
          }
        }
      },
      // Sắp xếp: ưu tiên phòng có lastMessage, sau đó theo lastMessageTime
      {
        $sort: { hasLastMessage: -1, lastMessageTime: -1 }
      }
    ]);

    // Fetch preferences, unread counts, and direct-chat profiles in parallel.
    const roomIds = rooms.map(room => room._id);
    const directUserIds = [...new Set(rooms
      .filter(room => room.type === 'one-to-one')
      .flatMap(room => room.participants.filter(id => id !== userId)))];
    const [preferences, unreadRows, directUsers] = await Promise.all([
      ChatPreference.find({userId, roomId: {$in: roomIds}}).lean(),
      Message.aggregate([
        {
          $match: {
            roomId: {$in: roomIds},
            deletedAt: null,
            deletedFor: {$ne: userId},
            readBy: {$ne: userId},
            userId: {$ne: userId},
          },
        },
        {$group: {_id: '$roomId', count: {$sum: 1}}},
      ]),
      directUserIds.length
        ? User.find({lv001: {$in: directUserIds}}).select('avatar name lv001').lean()
        : Promise.resolve([]),
    ]);
    const preferenceByRoom = new Map(preferences.map(item => [String(item.roomId), item]));
    const unreadCountByRoom = new Map(unreadRows.map(item => [String(item._id), item.count]));
    const directUserById = new Map(directUsers.map(user => [user.lv001, user]));

    for (const room of rooms) {
      const preference = preferenceByRoom.get(String(room._id));
      room.isMuted = Boolean(preference?.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
      room.mutedUntil = room.isMuted ? preference?.mutedUntil ?? null : null;
      room.isPinned = Boolean(preference?.pinned);
      room.isHidden = Boolean(preference?.hidden);
      room.unreadCount = unreadCountByRoom.get(String(room._id)) || 0;

      if (room.type === 'one-to-one') {
        const otherUserId = room.participants.find(id => id !== userId);
        if (otherUserId) {
          const otherUser = directUserById.get(otherUserId);
          room.user = otherUser ? {
            lv001: otherUser.lv001,
            name: otherUser.name,
            avatar: otherUser.avatar
          } : null;
        } else {
          room.user = null;
        }
      } else if (room.type === 'group') {
        room.groupImage = room.groupImage || null;
      }
    }

    return rooms;
  } catch (error) {
    console.error(
      `Room Service: Error fetching rooms for user ${userId}`,
      { error: error.message }
    );
    throw new Error(`Lỗi lấy danh sách phòng: ${error.message}`);
  }
};

export const getMyGroupsService = async (userId) => {
  try {
    if (!userId) throw new Error("userId là bắt buộc");
    const hiddenRoomIds = await ChatPreference.find({userId, hidden: true}).distinct('roomId');

    const rooms = await Room.find({
      participants: userId,
      type: "group",
      _id: {$nin: hiddenRoomIds},
      deletedAt: null,
    });

    if (rooms.length === 0) return [];

    const roomIds = rooms.map(r => r._id);

    // Lấy tin nhắn cuối cùng cho mỗi room
    const messages = await Message.aggregate([
      { $match: { roomId: { $in: roomIds } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$roomId",
          lastMessage: { $first: "$$ROOT" }
        }
      }
    ]);

    // Lấy thông tin user gửi tin nhắn
    const userIds = messages.map(m => m.lastMessage.userId);
    const users = await User.find({ lv001: { $in: userIds } }).select("lv001 name avatar");
    const userMap = new Map(users.map(u => [u.lv001, u]));

    // Ghép dữ liệu
    const result = rooms.map(r => {
      const msg = messages.find(m => m._id.toString() === r._id.toString());
      let lastMessage = null;

      if (msg) {
        const sender = userMap.get(msg.lastMessage.userId);
        lastMessage = {
          content: msg.lastMessage.content,
          type: msg.lastMessage.type,
          createdAt: msg.lastMessage.timestamp,
          userId: msg.lastMessage.userId,
          senderName: sender?.name || msg.lastMessage.userId,
        };
      }

      return {
        ...r.toObject(),
        lastMessageTime: msg?.lastMessage?.timestamp || r.createdAt,
        lastMessage
      };
    });

    // Sort mới nhất lên đầu
    result.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

    return result;
  } catch (error) {
    console.error(`Room Service: Error fetching groups for user ${userId}`, { error: error.message });
    throw new Error(`Lỗi lấy danh sách nhóm: ${error.message}`);
  }
};

export const getAllRoomsService = async () => {
  try {
    const rooms = await Room.aggregate([
      // Lọc bỏ các phòng có deletedAt chứa giá trị
      {
        $match: { deletedAt: { $eq: null } }
      },
      // Lookup tin nhắn mới nhất cho mỗi room
      {
        $lookup: {
          from: "messages",
          let: { roomId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$roomId", "$$roomId"] } } },
            { $sort: { timestamp: -1 } },
            { $limit: 1 }
          ],
          as: "lastMessage"
        }
      },
      // Rã mảng lastMessage và thêm trường hasLastMessage
      {
        $unwind: {
          path: "$lastMessage",
          preserveNullAndEmptyArrays: true // Giữ các phòng không có tin nhắn
        }
      },
      // Chỉ lấy phòng có ít nhất 1 tin nhắn hoặc type là group
      {
        $match: {
          $or: [
            { lastMessage: { $ne: null } },
            { type: "group" }
          ]
        }
      },
      // Lookup user gửi tin nhắn cuối cùng
      {
        $lookup: {
          from: "users",
          localField: "lastMessage.userId",
          foreignField: "lv001",
          pipeline: [
            { $project: { name: 1, _id: 0 } }
          ],
          as: "lastMessageSender"
        }
      },
      {
        $addFields: {
          "lastMessage.name": {
            $arrayElemAt: ["$lastMessageSender.name", 0]
          },
          hasLastMessage: {
            $cond: [{ $ifNull: ["$lastMessage", false] }, 1, 0]
          },
          lastMessageTime: {
            $ifNull: ["$lastMessage.timestamp", "$createdAt"]
          }
        }
      },
      // Sắp xếp: ưu tiên phòng có lastMessage, sau đó theo lastMessageTime
      {
        $sort: { hasLastMessage: -1, lastMessageTime: -1 }
      }
    ]);

    // Thêm thông tin user/group cho từng phòng
    for (const room of rooms) {
      if (room.type === 'one-to-one') {
        const users = await User.find({ lv001: { $in: room.participants } }).select('avatar name lv001');
        room.users = users.map(u => ({
          lv001: u.lv001,
          name: u.name,
          avatar: u.avatar
        }));
      } else if (room.type === 'group') {
        room.groupImage = room.groupImage || null;
      }
    }

    return rooms;
  } catch (error) {
    console.error(
      `Room Service: Error fetching all rooms`,
      { error: error.message }
    );
    throw new Error(`Lỗi lấy danh sách phòng: ${error.message}`);
  }
};

export const deleteRoomService = async (roomId, userId) => {
  try {
    if (!roomId) throw new Error("roomId là bắt buộc");
    const room = await Room.findById(roomId);
    if (!room) throw new Error("Phòng không tồn tại");

    const byUser = await User.findOne({ lv001: userId });

    // Nếu người dùng không phải admin và không phải người tạo nhóm thì không được xoá
    if (room.type === 'group' && byUser.lv001 !== room.createdBy && !(byUser.role === 'admin')) {
      throw new Error("Bạn không có quyền xoá phòng này");
    }

    // Update room thêm thuộc tính deletedAt
    room.deletedAt = new Date();
    // Lưu id người xoá
    room.deletedBy = byUser.lv001;
    await room.save();
    return { message: "Xóa phòng thành công", room: room.toObject() };
  } catch (error) {
    console.error(
      `Room Service: Error deleting room ${roomId}`,
      { error: error.message }
    );
    throw new Error(`Lỗi xóa phòng: ${error.message}`);
  }
};
