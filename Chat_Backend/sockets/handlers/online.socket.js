import User from "../../models/User.js";

const userTimeouts = new Map();
const OFFLINE_THRESHOLD = 5 * 60 * 1000; // 5 phút

export const handleOnlineEvents = (socket, io) => {
    const userId = socket.userId;

    function setOfflineTimeout() {
        // Nếu đã có timeout thì clear
        if (userTimeouts.has(userId)) {
            clearTimeout(userTimeouts.get(userId));
        }
        // Đặt timeout mới
        const timeout = setTimeout(async () => {
            const updatedUser = await User.findOneAndUpdate(
                { lv001: userId },
                { onlineStatus: false },
                {new: true}
            ).select('allowAccountDiscovery');
            console.log(`[Ping] User ${userId} đã bị set offline do không ping`);
            // Emit sự kiện userOffline cho tất cả client
            if (io && updatedUser?.allowAccountDiscovery !== false) {
                io.emit("userOffline", {
                    userId: userId,
                    lastActive: new Date(),
                    reason: 'no_ping_timeout'
                });
            }
            userTimeouts.delete(userId);
        }, OFFLINE_THRESHOLD);
        userTimeouts.set(userId, timeout);
    }

    socket.on("user:ping", async () => {
        try {
            const updatedUser = await User.findOneAndUpdate(
                { lv001: userId },
                {
                    onlineStatus: true,
                    lastActive: new Date()
                },
                {new: true}
            ).select('allowAccountDiscovery');
            setOfflineTimeout();
            
            if (updatedUser?.allowAccountDiscovery !== false) {
                io.emit("userOnline", {
                    userId: userId,
                    lastActive: new Date()
                });
            }
            // console.log(`[Ping] Cập nhật onlineStatus cho ${userId}`);
        } catch (err) {
            console.error(`Error updating online status for ${userId} (ping):`, err);
        }
    });

    // Khi disconnect thì clear timeout
    socket.on("disconnect", () => {
        if (userTimeouts.has(userId)) {
            clearTimeout(userTimeouts.get(userId));
            userTimeouts.delete(userId);
        }
    });
};
