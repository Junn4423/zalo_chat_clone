import connectMySQL from '../config/mysql.js';
import User from '../models/User.js';
import Room from '../models/Room.js';
import Message from '../models/Message.js';

export const getOnlineUsersService = async ({ username, password }) => {
  let connection;
  try {
    connection = await connectMySQL(false);
    const [rows] = await connection.execute(
      'SELECT lv001, lv004, lv008 FROM lv_lv0007 WHERE lv001 = ? AND lv005 = md5(?)',
      [username, password]
    );
    if (rows.length === 0) {
      throw new Error('Sai tài khoản hoặc mật khẩu');
    }
    connection.release(); // Trả kết nối về pool
    return rows[0];
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`Failed to login user: ${error.message}`);
  }
};

export const LayNhanVienTheoUserID = async (userId) => {
  let connection;
  try {
    connection = await connectMySQL(false);
    const [rows] = await connection.execute(`
      SELECT 
        nv.lv001 AS maNhanVien, 
        nv.lv002 AS tenNhanVien,
        nv.lv029 AS maPhongBan,
        u.lv001 AS userId
      FROM lv_lv0007 u
      JOIN hr_lv0020 nv ON u.lv006 = nv.lv001
      WHERE u.lv001 = ?
    `, [userId]);

    connection.release(); // Trả kết nối về pool

    if (rows.length === 0) {
      throw new Error('Không tìm thấy nhân viên');
    }

    const nhanVien = rows[0];
    const mongoUser = await User.findOne({ maNhanVien: String(nhanVien.maNhanVien) }).select('_id lv001 avatar');

    return {
      maNhanVien: nhanVien.maNhanVien,
      tenNhanVien: nhanVien.tenNhanVien,
      maPhongBan: nhanVien.maPhongBan,
      idObject: mongoUser?._id || null,
      userId: mongoUser?.lv001 || null,
      avatar: mongoUser?.avatar || null
    };
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`Lỗi khi lấy nhân viên theo userID: ${error.message}`);
  }
};

export const layAllNhanVien = async (userId) => {
  let connection;
  try {
    const currentUser = await User.findOne({ maNhanVien: userId });
    if (!currentUser) {
      throw new Error(`Không tìm thấy người dùng MongoDB với maNhanVien = ${userId}`);
    }

    const currentUserId = currentUser.lv001;
    connection = await connectMySQL(false);
    const [rows] = await connection.execute('SELECT * FROM hr_lv0020 WHERE lv001 != ?', [userId]);
    connection.release(); // Trả kết nối về pool

    if (rows.length === 0) {
      return [];
    }

    const mysqlEmployeeIds = rows.map(nv => String(nv.lv001));
    const mongoUsers = await User.find({ maNhanVien: { $in: mysqlEmployeeIds }, allowAccountDiscovery: {$ne: false} })
      .select('_id maNhanVien lv001 avatar lastActive');

    const userMap = new Map(
      mongoUsers.map(user => [user.maNhanVien, {
        idObject: user._id,
        userId: user.lv001,
        avatar: user.avatar,
        lastActive: user.lastActive
      }])
    );

    const userRooms = await Room.find({
      type: 'one-to-one',
      participants: { $in: [currentUserId] }
    }).select('_id participants');

    const partnerMap = new Map();
    const partnerByRoomId = new Map();
    userRooms.forEach(room => {
      const partnerId = room.participants.find(p => p !== currentUserId);
      if (partnerId) {
        partnerMap.set(partnerId, room._id);
        partnerByRoomId.set(room._id.toString(), partnerId);
      }
    });

    const roomIds = Array.from(partnerMap.values());
    const messages = await Message.aggregate([
      { $match: { roomId: { $in: roomIds } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$roomId",
          lastMessageTime: { $first: "$timestamp" }
        }
      }
    ]);

    const interactionMap = new Map();
    for (const msg of messages) {
      const roomId = msg._id.toString();
      const lastTime = msg.lastMessageTime;
      const partnerId = partnerByRoomId.get(roomId);
      if (partnerId) {
        interactionMap.set(partnerId, lastTime);
      }
    }

    const result = rows
      .filter(nv => userMap.has(nv.lv001))
      .map(nv => {
        const userData = userMap.get(nv.lv001);
        const fallbackTime = userData.lastActive || new Date(0);
        const lastMessageTime = interactionMap.get(userData.userId) || fallbackTime;

        return {
          maNhanVien: nv.lv001,
          tenNhanVien: nv.lv002,
          maPhongBan: nv.lv029,
          idObject: userData.idObject,
          userId: userData.userId,
          avatar: userData.avatar,
          lastMessageTime
        };
      })
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

    return result;
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`Lỗi khi lấy danh sách nhân viên: ${error.message}`);
  }
};

// ===== ONLINE STATUS MANAGEMENT =====

export const getOnlineUsersListService = async () => {
  try {
    // Lấy tất cả user đang online từ database
    const onlineUsers = await User.find({ onlineStatus: true, allowAccountDiscovery: {$ne: false} })
      .select('lv001 name maNhanVien avatar lastActive')
      .sort({ lastActive: -1 });

    return onlineUsers;
  } catch (error) {
    console.error('Error getting online users:', error);
    throw new Error('Không thể lấy danh sách user online');
  }
};

export const getAllUsersWithStatusService = async () => {
  try {
    // Lấy tất cả user với trạng thái online
    const allUsers = await User.find({allowAccountDiscovery: {$ne: false}})
      .select('lv001 name maNhanVien avatar onlineStatus lastActive')
      .sort({ onlineStatus: -1, lastActive: -1 });

    return allUsers;
  } catch (error) {
    console.error('Error getting all users with status:', error);
    throw new Error('Không thể lấy danh sách user');
  }
};

export const updateUserOnlineStatusService = async (userId, isOnline) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { lv001: userId },
      {
        onlineStatus: isOnline,
        lastActive: new Date()
      },
      { new: true }
    );

    return updatedUser;
  } catch (error) {
    console.error(`Error updating online status for ${userId}:`, error);
    throw new Error('Không thể cập nhật trạng thái online');
  }
};

export const getUserOnlineStatusService = async (userId) => {
  try {
    const user = await User.findOne({ lv001: userId })
      .select('lv001 name maNhanVien avatar onlineStatus lastActive allowAccountDiscovery');

    if (!user) {
      throw new Error('User không tồn tại');
    }

    return user;
  } catch (error) {
    console.error(`Error getting online status for ${userId}:`, error);
    throw new Error('Không thể lấy trạng thái online của user');
  }
};

// ===== CLEANUP SERVICE =====

export const cleanupOfflineUsersService = async (inactiveThresholdMinutes = 5) => {
  try {
    const threshold = new Date(Date.now() - inactiveThresholdMinutes * 60 * 1000);
    const inactiveUsers = await User.find({
      onlineStatus: true,
      lastActive: { $lt: threshold }
    });

    if (inactiveUsers.length > 0) {
      console.log(`Found ${inactiveUsers.length} inactive users, marking as offline...`);

      const userIds = inactiveUsers.map(user => user.lv001);
      await User.updateMany(
        { lv001: { $in: userIds } },
        {
          onlineStatus: false,
          lastActive: new Date()
        }
      );

      return {
        cleanedUsers: userIds,
        count: inactiveUsers.length
      };
    }

    return { cleanedUsers: [], count: 0 };
  } catch (error) {
    console.error('Error cleaning up offline users:', error);
    throw new Error('Không thể dọn dẹp users offline');
  }
};
