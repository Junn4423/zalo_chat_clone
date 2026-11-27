import {authenticateCouchAccount, syncCouchAccountDirectory} from '../../services/couchAuth.service.js';
import {generateToken} from '../token.js';
import User from '../../models/User.js';
import cookieOptions from '../../config/cookieOptions.js';
import { getOrCreateOneToOneRoomService } from '../../services/room.service.js';
import ChatPreference from '../../models/ChatPreference.js';

export const login = async (req, res) => {
  try {
    const {username, password} = req.body || {};
    if (!username || typeof password !== 'string' || !password) {
      return res.status(400).json({error: 'username and password are required'});
    }

    const couchAccount = await authenticateCouchAccount({username, password});
    if (!couchAccount) {
      return res.status(401).json({error: 'Invalid username or password'});
    }

    // Copy safe profile fields only; account hashes and tenant DB credentials
    // remain inside CouchDB and are never returned to the app.
    const syncResult = await syncCouchAccountDirectory();
    const mongoUser = await User.findOneAndUpdate(
      {lv001: couchAccount.username},
      {
        $set: {
          name: couchAccount.name,
          onlineStatus: true,
          lastActive: new Date(),
        },
        $setOnInsert: {
          maNhanVien: `couch:${couchAccount.username}`,
          role: 'user',
          avatar: '',
        },
      },
      {new: true, upsert: true, setDefaultsOnInsert: true},
    );
    const token = generateToken(couchAccount.username);
    const io = req.app.get('io');

    if (io) {
      io.emit('usersSynced', {
        triggeredBy: couchAccount.username,
        syncResult: {totalUsers: syncResult.totalAccounts},
      });
      const otherUserIds = [...new Set(
        Array.from(io.sockets.sockets.values())
          .map(socket => String(socket.userId || ''))
          .filter(userId => userId && userId !== couchAccount.username),
      )];
      for (const otherUserId of otherUserIds) {
        const room = await getOrCreateOneToOneRoomService(couchAccount.username, otherUserId);
        const userSockets = Array.from(io.sockets.sockets.values())
          .filter(socket => String(socket.userId) === otherUserId);
        const hiddenForRecipient = await ChatPreference.exists({
          userId: otherUserId,
          roomId: room._id,
          hidden: true,
        });
        if (!hiddenForRecipient) userSockets.forEach(socket => socket.join(room._id.toString()));
      }
    }

    res.cookie('token', token, cookieOptions);
    res.cookie('role', mongoUser.role, cookieOptions);
    return res.json({
      message: 'Login successful',
      user: {
        id: mongoUser._id,
        username: mongoUser.lv001,
        maNhanVien: mongoUser.maNhanVien,
        role: mongoUser.role,
        name: mongoUser.name,
        avatar: mongoUser.avatar || '',
      },
      token,
      role: mongoUser.role,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: status === 503 ? error.message : `Login failed: ${error.message}`,
    });
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

export const logout = async (req, res) => {
  try {
    const username = req.userId;
    if (!username) return res.status(401).json({error: 'Invalid session'});

    const io = req.app.get('io');
    const activeSockets = io
      ? Array.from(io.sockets.sockets.values())
        .filter(socket => String(socket.userId) === String(username)).length
      : 0;
    if (activeSockets <= 1) {
      await User.updateOne(
        {lv001: username},
        {$set: {onlineStatus: false, lastActive: new Date()}},
      );
    }

    res.clearCookie('token', cookieOptions);
    return res.status(200).json({message: 'Logout successful'});
  } catch (error) {
    return res.status(500).json({error: `Logout failed: ${error.message}`});
  }
};

export const syncAllUsers = async (req, res) => {
  try {
    const result = await syncCouchAccountDirectory();
    return res.status(200).json({message: 'Account sync successful', data: result});
  } catch (error) {
    return res.status(error.statusCode || 500).json({error: error.message});
  }
};
