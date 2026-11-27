import User from '../../models/User.js';
import Room from '../../models/Room.js';
import Message from '../../models/Message.js';
import ChatPreference from '../../models/ChatPreference.js';
import {syncCouchAccountDirectory} from '../../services/couchAuth.service.js';
import {generateHiddenChatAccessToken} from '../token.js';
import {hashHiddenChatPin, isValidHiddenChatPin, verifyHiddenChatPin} from '../../services/hiddenChatSecurity.js';
import {
  getOnlineUsersListService,
  getAllUsersWithStatusService,
  updateUserOnlineStatusService,
  getUserOnlineStatusService,
  cleanupOfflineUsersService
} from '../../services/user.service.js';

const verifyStoredHiddenChatPin = async (userId, user, pin) => {
  const lockedUntil = user.hiddenChatPinLockedUntil ? new Date(user.hiddenChatPinLockedUntil) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    throw Object.assign(new Error('Mã khóa tạm bị khóa. Hãy thử lại sau ít phút.'), {status: 429});
  }
  if (!isValidHiddenChatPin(pin) || !await verifyHiddenChatPin(pin, user.hiddenChatPinHash)) {
    const failed = await User.findOneAndUpdate(
      {lv001: userId},
      {$inc: {hiddenChatPinFailures: 1}},
      {new: true},
    ).select('hiddenChatPinFailures').lean();
    if ((failed?.hiddenChatPinFailures || 0) >= 5) {
      await User.updateOne({lv001: userId}, {$set: {hiddenChatPinFailures: 0, hiddenChatPinLockedUntil: new Date(Date.now() + 5 * 60 * 1000)}});
      throw Object.assign(new Error('Sai mã quá nhiều lần. Hãy thử lại sau 5 phút.'), {status: 429});
    }
    // Reserve HTTP 401 for expired account sessions; the client clears auth state on 401.
    throw Object.assign(new Error('Mã mở khóa không đúng'), {status: 422});
  }
  await User.updateOne({lv001: userId}, {$set: {hiddenChatPinFailures: 0, hiddenChatPinLockedUntil: null}});
};

export const getHiddenChatPinStatus = async (req, res) => {
  try {
    const user = await User.findOne({lv001: req.userId}).select('+hiddenChatPinHash').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({hasPin: Boolean(user.hiddenChatPinHash)});
  } catch {
    res.status(500).json({error: 'Không thể tải trạng thái mã khóa'});
  }
};

export const setHiddenChatPin = async (req, res) => {
  try {
    const newPin = req.body?.pin;
    if (!isValidHiddenChatPin(newPin)) return res.status(400).json({error: 'Mã khóa phải gồm 4 chữ số'});
    const user = await User.findOne({lv001: req.userId}).select('+hiddenChatPinHash hiddenChatPinFailures hiddenChatPinLockedUntil').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    if (user.hiddenChatPinHash) await verifyStoredHiddenChatPin(req.userId, user, req.body?.currentPin);
    const hash = await hashHiddenChatPin(newPin);
    await User.updateOne({lv001: req.userId}, {$set: {hiddenChatPinHash: hash, hiddenChatPinFailures: 0, hiddenChatPinLockedUntil: null}});
    res.json({success: true, hasPin: true});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thể lưu mã khóa'});
  }
};

export const unlockHiddenChats = async (req, res) => {
  try {
    const user = await User.findOne({lv001: req.userId}).select('+hiddenChatPinHash hiddenChatPinFailures hiddenChatPinLockedUntil').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    if (!user.hiddenChatPinHash) return res.status(409).json({error: 'Bạn chưa tạo mã khóa trò chuyện ẩn'});
    await verifyStoredHiddenChatPin(req.userId, user, req.body?.pin);
    res.json({accessToken: generateHiddenChatAccessToken(req.userId), expiresIn: 600});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thể mở khóa trò chuyện ẩn'});
  }
};

export const cancelHiddenChats = async (req, res) => {
  try {
    const user = await User.findOne({lv001: req.userId}).select('+hiddenChatPinHash hiddenChatPinFailures hiddenChatPinLockedUntil').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    if (!user.hiddenChatPinHash) return res.status(409).json({error: 'Bạn chưa tạo mã khóa trò chuyện ẩn'});
    await verifyStoredHiddenChatPin(req.userId, user, req.body?.pin);

    const hiddenPreferences = await ChatPreference.find({userId: req.userId, hidden: true})
      .select('roomId muted mutedUntil pinned')
      .lean();
    await ChatPreference.updateMany({userId: req.userId, hidden: true}, {$set: {hidden: false}});

    const cleared = await User.updateOne(
      {lv001: req.userId, hiddenChatPinHash: user.hiddenChatPinHash},
      {$set: {hiddenChatPinHash: null, hiddenChatPinFailures: 0, hiddenChatPinLockedUntil: null}},
    );
    if (!cleared.matchedCount) return res.status(409).json({error: 'Mã khóa vừa thay đổi. Hãy tải lại rồi thử lại.'});

    const io = req.app.get('io');
    for (const preference of hiddenPreferences) {
      const isMuted = Boolean(preference.muted && (!preference.mutedUntil || preference.mutedUntil > new Date()));
      io?.to(String(req.userId)).emit('chatPreferenceChanged', {
        roomId: String(preference.roomId),
        isHidden: false,
        isPinned: Boolean(preference.pinned),
        isMuted,
        mutedUntil: isMuted ? preference.mutedUntil ?? null : null,
      });
    }
    res.json({success: true, hasPin: false, restoredCount: hiddenPreferences.length});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message || 'Không thể tắt trò chuyện ẩn'});
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findOne({ lv001: req.userId }).lean();
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy thông tin người dùng: ${error.message}` });
  }
};

export const getPrivacySettings = async (req, res) => {
  try {
    const user = await User.findOne({lv001: req.userId}).select('allowAccountDiscovery allowFriendRequests allowMessagesFromNonFriends allowCallsFromNonFriends onlineStatus lastActive').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({
      allowAccountDiscovery: user.allowAccountDiscovery ?? true,
      allowFriendRequests: user.allowFriendRequests ?? true,
      allowMessagesFromNonFriends: user.allowMessagesFromNonFriends ?? true,
      allowCallsFromNonFriends: user.allowCallsFromNonFriends ?? true,
    });
  } catch (error) {
    res.status(500).json({error: 'Không thể tải cài đặt quyền riêng tư'});
  }
};

export const updatePrivacySettings = async (req, res) => {
  try {
    const updates = {};
    for (const key of ['allowAccountDiscovery', 'allowFriendRequests', 'allowMessagesFromNonFriends', 'allowCallsFromNonFriends']) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        if (typeof req.body[key] !== 'boolean') return res.status(400).json({error: 'Cài đặt quyền riêng tư phải là true hoặc false'});
        updates[key] = req.body[key];
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({error: 'Không có cài đặt nào để cập nhật'});
    const user = await User.findOneAndUpdate({lv001: req.userId}, {$set: updates}, {new: true, runValidators: true}).select('allowAccountDiscovery allowFriendRequests allowMessagesFromNonFriends allowCallsFromNonFriends onlineStatus lastActive').lean();
    if (user && Object.prototype.hasOwnProperty.call(updates, 'allowAccountDiscovery')) {
      const io = req.app.get('io');
      if (io) {
        if (user.allowAccountDiscovery === false) io.emit('userOffline', {userId: req.userId, lastActive: user.lastActive, reason: 'privacy'});
        else if (user.onlineStatus) io.emit('userOnline', {userId: req.userId, lastActive: user.lastActive});
      }
    }
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({
      allowAccountDiscovery: user.allowAccountDiscovery ?? true,
      allowFriendRequests: user.allowFriendRequests ?? true,
      allowMessagesFromNonFriends: user.allowMessagesFromNonFriends ?? true,
      allowCallsFromNonFriends: user.allowCallsFromNonFriends ?? true,
    });
  } catch (error) {
    res.status(500).json({error: 'Không thể lưu cài đặt quyền riêng tư'});
  }
};

const toBlockedUserList = async ids => {
  const usernames = Array.isArray(ids) ? ids : [];
  const users = await User.find({lv001: {$in: usernames}}).select('lv001 name avatar').lean();
  const byId = new Map(users.map(user => [user.lv001, user]));
  return usernames.map(username => {
    const user = byId.get(username);
    return {username, name: user?.name || username, avatar: user?.avatar || ''};
  });
};

export const getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findOne({lv001: req.userId}).select('blockedUsers').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({users: await toBlockedUserList(user.blockedUsers)});
  } catch (error) {
    res.status(500).json({error: 'Không thể tải danh sách chặn'});
  }
};

export const blockUser = async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username || username === req.userId) return res.status(400).json({error: 'Tài khoản không hợp lệ'});
    const target = await User.findOne({lv001: username}).select('lv001').lean();
    if (!target) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    const user = await User.findOneAndUpdate({lv001: req.userId}, {$addToSet: {blockedUsers: username}}, {new: true}).select('blockedUsers').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({users: await toBlockedUserList(user.blockedUsers)});
  } catch (error) {
    res.status(500).json({error: 'Không thể chặn người dùng'});
  }
};

export const unblockUser = async (req, res) => {
  try {
    const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
    if (!username) return res.status(400).json({error: 'Tài khoản không hợp lệ'});
    const user = await User.findOneAndUpdate({lv001: req.userId}, {$pull: {blockedUsers: username}}, {new: true}).select('blockedUsers').lean();
    if (!user) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    res.json({users: await toBlockedUserList(user.blockedUsers)});
  } catch (error) {
    res.status(500).json({error: 'Không thể bỏ chặn người dùng'});
  }
};

export const getOnlineUsers = async (req, res) => {
  try {
    const user = await User.findOne({ lv001: req.userId }).lean();
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy danh sách người dùng hoạt động: ${error.message}` });
  }
};

export const getNhanVien = async (req, res) => {
  try {
    await syncCouchAccountDirectory();
    const users = await User.find({
      lv001: {$ne: req.userId},
      allowAccountDiscovery: {$ne: false},
    }).select('_id lv001 maNhanVien name avatar lastActive').lean();
    const rooms = await Room.find({type: 'one-to-one', participants: req.userId})
      .select('_id participants').lean();
    const roomIds = rooms.map(room => room._id);
    const latestMessages = roomIds.length
      ? await Message.aggregate([
        {$match: {roomId: {$in: roomIds}}},
        {$sort: {timestamp: -1}},
        {$group: {_id: '$roomId', lastMessageTime: {$first: '$timestamp'}}},
      ])
      : [];
    const roomByPartner = new Map();
    for (const room of rooms) {
      const partnerId = room.participants.find(participant => participant !== req.userId);
      if (partnerId) roomByPartner.set(String(room._id), partnerId);
    }
    const lastMessageByPartner = new Map(latestMessages.map(message => [
      roomByPartner.get(String(message._id)), message.lastMessageTime,
    ]));
    const directory = users.map(user => ({
      maNhanVien: user.maNhanVien || `couch:${user.lv001}`,
      tenNhanVien: user.name || user.lv001,
      maPhongBan: '',
      idObject: String(user._id),
      userId: user.lv001,
      avatar: user.avatar || '',
      lastMessageTime: lastMessageByPartner.get(user.lv001) || user.lastActive || new Date(0),
    })).sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    res.json(directory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getNhanVienId = async (req, res) => {
  try {
    const targetId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!targetId) return res.status(400).json({error: 'Tài khoản không hợp lệ'});
    await syncCouchAccountDirectory();
    const target = await User.findOne({lv001: targetId})
      .select('_id lv001 maNhanVien name avatar allowAccountDiscovery').lean();
    if (targetId !== req.userId && target?.allowAccountDiscovery === false) {
      return res.status(404).json({error: 'Không tìm thấy nhân viên'});
    }
    if (!target) return res.status(404).json({error: 'Không tìm thấy tài khoản'});
    res.json({
      maNhanVien: target.maNhanVien || `couch:${target.lv001}`,
      tenNhanVien: target.name || target.lv001,
      maPhongBan: '',
      idObject: String(target._id),
      userId: target.lv001,
      avatar: target.avatar || '',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ===== ONLINE STATUS MANAGEMENT =====

export const getOnlineUsersList = async (req, res) => {
  try {
    const onlineUsers = await getOnlineUsersListService();
    res.json({
      success: true,
      count: onlineUsers.length,
      users: onlineUsers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Lỗi lấy danh sách user online: ${error.message}`
    });
  }
};

export const getAllUsersWithStatus = async (req, res) => {
  try {
    const allUsers = await getAllUsersWithStatusService();
    const onlineCount = allUsers.filter(user => user.onlineStatus).length;
    const offlineCount = allUsers.length - onlineCount;

    res.json({
      success: true,
      total: allUsers.length,
      online: onlineCount,
      offline: offlineCount,
      users: allUsers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Lỗi lấy danh sách user: ${error.message}`
    });
  }
};

export const getUserOnlineStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await getUserOnlineStatusService(userId);
    if (userId !== req.userId && user.allowAccountDiscovery === false) {
      return res.status(404).json({success: false, error: 'Không tìm thấy người dùng'});
    }

    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Lỗi lấy trạng thái online: ${error.message}`
    });
  }
};

export const updateUserOnlineStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isOnline } = req.body;

    if (userId !== req.userId) {
      return res.status(403).json({success: false, error: 'Chỉ được cập nhật trạng thái của tài khoản của bạn'});
    }

    console.log(`Cập nhật trạng thái online cho user ${userId} thành ${isOnline}`);
    

    if (typeof isOnline !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isOnline phải là boolean'
      });
    }

    const updatedUser = await updateUserOnlineStatusService(userId, isOnline);

    // Emit socket event để thông báo cho các clients khác
    const io = req.app.get('io');
    if (io && updatedUser.allowAccountDiscovery !== false) {
      if (isOnline) io.emit('userOnline', {
        userId: userId,
        userInfo: {
          lv001: updatedUser.lv001,
          name: updatedUser.name,
          maNhanVien: updatedUser.maNhanVien,
          avatar: updatedUser.avatar,
          lastActive: updatedUser.lastActive
        }
      });
      else io.emit('userOffline', {
        userId: userId,
        lastActive: updatedUser.lastActive,
        reason: 'manual_update'
      });
    }

    res.json({
      success: true,
      message: `User ${userId} đã ${isOnline ? 'online' : 'offline'}`,
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Lỗi cập nhật trạng thái online: ${error.message}`
    });
  }
};

// ===== CLEANUP MANAGEMENT =====

export const cleanupOfflineUsers = async (req, res) => {
  try {
    const thresholdMinutes = parseInt(req.query.threshold) || 5; // Default 5 minutes

    const result = await cleanupOfflineUsersService(thresholdMinutes);

    // Emit socket events cho các users đã được cleanup
    const io = req.app.get('io');
    if (result.cleanedUsers.length > 0) {
      result.cleanedUsers.forEach(userId => {
        io.emit('userOffline', {
          userId: userId,
          lastActive: new Date(),
          reason: 'cleanup'
        });
      });
    }

    res.json({
      success: true,
      message: `Đã dọn dẹp ${result.count} users offline`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Lỗi dọn dẹp users offline: ${error.message}`
    });
  }
};
