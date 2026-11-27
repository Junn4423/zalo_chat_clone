import Room from "../models/Room.js";
import User from "../models/User.js";
import ChatPreference from "../models/ChatPreference.js";

const getVisibleOnlineUserIds = async io => {
  const connectedIds = [...new Set(Array.from(io.sockets.sockets.values()).map(s => String(s.userId)).filter(Boolean))];
  const users = await User.find({lv001: {$in: connectedIds}, allowAccountDiscovery: {$ne: false}}).select('lv001').lean();
  return users.map(user => user.lv001);
};

export const handleConnection = (socket, io) => {
  const userId = socket.userId;
  socket.join(userId);

  // Cập nhật trạng thái online trong database
  User.findOneAndUpdate(
    { lv001: userId },
    {
      onlineStatus: true,
      lastActive: new Date()
    },
    { new: true }
  ).then(async (updatedUser) => {
    if (updatedUser) {
      console.log(`User ${userId} is now online`);

      // Tự động tạo phòng 1-1 với tất cả user khác nếu chưa có
      // Tự động join các room
      const hiddenRoomIds = await ChatPreference.find({userId, hidden: true}).distinct('roomId');
      const rooms = await Room.find({participants: userId, deletedAt: null, _id: {$nin: hiddenRoomIds}}).select('_id').lean();
      rooms.forEach((room) => {
        socket.join(room._id.toString());
      });

      // 1. Gửi list online users cho user mới
      socket.emit("onlineUsers", await getVisibleOnlineUserIds(io));

      // 2. Thông báo cho tất cả user khác (bao gồm cả user mới) về user online
      if (updatedUser.allowAccountDiscovery !== false) {
        io.sockets.emit("userOnline", {
          userId: userId,
          userInfo: {
            lv001: updatedUser.lv001,
            name: updatedUser.name,
            maNhanVien: updatedUser.maNhanVien,
            avatar: updatedUser.avatar,
            lastActive: updatedUser.lastActive
          }
        });
      }
    }
  }).catch(err => {
    console.error(`Error updating online status for ${userId}:`, err);
  });

  socket.on("getOnlineUsers", async () => {
    try {
      socket.emit("onlineUsers", await getVisibleOnlineUserIds(io));
    } catch (err) {
      console.error(`Error refreshing online users for ${userId}:`, err);
    }
  });

  // Heartbeat mechanism - kiểm tra user còn online không
  const heartbeatInterval = setInterval(() => {
    socket.emit('ping', Date.now());
  }, 30000); // Ping mỗi 30 giây

  // Timeout để detect disconnect nếu không có pong
  let pongTimeout;
  const PONG_TIMEOUT = 10000; // 10 giây không pong thì coi như offline

  socket.on('pong', (timestamp) => {
    // Clear timeout cũ
    if (pongTimeout) clearTimeout(pongTimeout);

    // Cập nhật lastActive
    User.findOneAndUpdate(
      { lv001: userId },
      { lastActive: new Date() }
    ).catch(err => console.error(`Error updating lastActive for ${userId}:`, err));

    // Set timeout mới cho pong tiếp theo
  });

  socket.on("disconnect", async () => {
    clearInterval(heartbeatInterval);
    if (pongTimeout) clearTimeout(pongTimeout);
    if (Array.from(io.sockets.sockets.values()).some(peer => peer.id !== socket.id && peer.userId === userId)) return;

    try {
      // Cập nhật trạng thái offline trong database
      const updatedUser = await User.findOneAndUpdate(
        { lv001: userId },
        {
          onlineStatus: false,
          lastActive: new Date()
        },
        { new: true }
      );

      if (updatedUser) {
        console.log(`User ${userId} is now offline (disconnect)`);

        // Thông báo cho tất cả user khác về user offline
        if (updatedUser.allowAccountDiscovery !== false) {
          io.emit("userOffline", {
            userId: userId,
            lastActive: updatedUser.lastActive,
            reason: 'disconnect'
          });
        }
      }
    } catch (err) {
      console.error(`Error updating offline status for ${userId}:`, err);
    }
  });

  // Xử lý manual disconnect (user chủ động logout)
  socket.on("manualDisconnect", async () => {
    try {
      await User.findOneAndUpdate(
        { lv001: userId },
        {
          onlineStatus: false,
          lastActive: new Date()
        }
      );
      socket.disconnect(true);
    } catch (err) {
      console.error(`Error during manual disconnect for ${userId}:`, err);
    }
  });
};
