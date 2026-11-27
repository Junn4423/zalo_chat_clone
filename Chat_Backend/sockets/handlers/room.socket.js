import { createGroupService, getOrCreateOneToOneRoomService } from "../../services/room.service.js";
import Room from '../../models/Room.js';
import mongoose from 'mongoose';
import {assertHiddenChatRoomAccess} from '../../services/hiddenChatAccess.js';

// Đăng ký các sự kiện liên quan đến phòng chat
export const handleRoomEvents = (socket, io) => {
    // Tham gia phòng
    socket.on("joinRoom", async (data, callback) => {
        const roomId = data?.roomId;
        try {
            if (!mongoose.Types.ObjectId.isValid(roomId) || !await Room.exists({_id: roomId, participants: socket.userId, deletedAt: null})) {
                if (typeof callback === 'function') callback({success: false, error: 'Không có quyền truy cập phòng'});
                return;
            }
            const hiddenGrant = await assertHiddenChatRoomAccess({
                userId: socket.userId,
                roomId,
                token: data?.hiddenChatAccessToken,
            });
            await socket.join(roomId);
            socket.data.hiddenRoomExpiryTimers ||= new Map();
            const existingTimers = socket.data.hiddenRoomExpiryTimers;
            const previousTimer = existingTimers.get(String(roomId));
            if (previousTimer) clearTimeout(previousTimer);
            existingTimers.delete(String(roomId));
            if (hiddenGrant?.exp) {
                const timers = existingTimers;
                const delay = Math.max(0, hiddenGrant.exp * 1000 - Date.now());
                const timer = setTimeout(() => {
                    void socket.leave(String(roomId));
                    timers.delete(String(roomId));
                    socket.emit('hiddenChatAccessExpired', {roomId: String(roomId)});
                }, delay);
                timer.unref?.();
                timers.set(String(roomId), timer);
            }
            if (typeof callback === 'function') callback({ success: true, message: "Tham gia phòng thành công" });
        } catch (error) {
            if (typeof callback === 'function') callback({success: false, error: error.message, status: error.status});
        }
    });

    // Tạo nhóm chat
    socket.on('leaveRoom', async data => {
        const roomId = String(data?.roomId || '');
        if (!mongoose.Types.ObjectId.isValid(roomId)) return;
        const timers = socket.data.hiddenRoomExpiryTimers;
        const timer = timers?.get(roomId);
        if (timer) clearTimeout(timer);
        timers?.delete(roomId);
        await socket.leave(roomId);
    });

    socket.on("createGroup", async (roomData, callback) => {
        try {
            const room = await createGroupService(roomData, socket.userId);
            socket.join(room._id.toString());

            // Tự động thêm tất cả thành viên vào phòng
            room.participants.forEach(memberId => {
                const sockets = Array.from(io.sockets.sockets.values())
                    .filter(s => s.userId === memberId);
                sockets.forEach(s => s.join(room._id.toString()));
            });

            room.participants.forEach(memberId => io.to(String(memberId)).emit("groupCreated", room));
            if (callback) callback({ success: true, room });
        } catch (error) {
            if (callback) callback({ success: false, error: error.message });
        }
    });
};
