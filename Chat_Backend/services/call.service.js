import mongoose from "mongoose";
import Call from "../models/Call.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import Room from "../models/Room.js";

/**
 * Bắt đầu cuộc gọi
 */
export const startCallService = async ({ roomId, userId, io, callType = 'audio' }) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            throw new Error("roomId không hợp lệ");
        }

        const room = await Room.findById(roomId);
        if (!room) throw new Error("Phòng không tồn tại");

        // Lấy danh sách thành viên trong phòng
        if (!room.participants.includes(userId)) {
            throw new Error("Người gọi không phải thành viên của phòng");
        }
        const otherParticipants = room.participants.filter(id => id !== userId);
        if (otherParticipants.length === 0) {
            throw new Error("Không có thành viên nào khác trong phòng để gọi");
        }

        // Tạo bản ghi Call
        const call = await Call.create({
            roomId,
            caller: userId,
            callee: otherParticipants[0],
            status: "pending",
            callType: callType === 'video' ? 'video' : 'audio',
            participants: room.participants.length > 2 ? room.participants : [],
            startedAt: new Date(),
        });

        // Thiết lập timeout 30 giây
        if (io) {
            setTimeout(async () => {
                await handleCallTimeout({ roomId, callId: call._id, io });
            }, 30000); // 30 giây
        }

        return call.toObject();
    } catch (err) {
        console.error(`[CallService] Error startCall: ${err.message}`);
        throw new Error(`Lỗi bắt đầu cuộc gọi: ${err.message}`);
    }
};

/**
 * Chấp nhận cuộc gọi
 */
export const acceptCallService = async ({ roomId, userId, callId }) => {
    try {
        const call = await Call.findOneAndUpdate(
            { ...(callId ? {_id: callId} : {}), roomId, status: "pending" },
            { 
                status: "answered",
                answeredAt: new Date() // Lưu thời điểm chấp nhận cuộc gọi
            },
            { new: true }
        );

        if (!call) return;

        return call.toObject();
    } catch (err) {
        console.error(`[CallService] Error acceptCall: ${err.message}`);
        throw new Error(`Lỗi accept cuộc gọi: ${err.message}`);
    }
};

/**
 * Từ chối cuộc gọi (manual decline hoặc no answer)
 */
export const declineCallService = async ({ roomId, userId, io, reason = "declined", callId }) => {
    try {
        const call = await Call.findOneAndUpdate(
            { ...(callId ? {_id: callId} : {}), roomId, status: "pending" },
            { status: reason, endedAt: new Date() },
            { new: true }
        );

        if (!call) return;

        // Tạo message khác nhau tùy theo lý do
        const callLabel = call.callType === 'video' ? 'video' : 'thoại';
        let declineMessage;
        if (reason === "declined") {
            declineMessage = `[Gọi ${callLabel}] Cuộc gọi đã bị từ chối`;
        } else if (reason === "no_answer") {
            declineMessage = `[Gọi ${callLabel}] Không có phản hồi`;
        } else {
            declineMessage = `[Gọi ${callLabel}] Cuộc gọi đã kết thúc`;
        }

        const message = await Message.create({
            roomId,
            userId: call.caller, // Người bắt đầu cuộc gọi là người gửi tin nhắn
            type: "call",
            content: declineMessage,
            call: {
                callId: call._id,
                callType: call.callType || 'audio',
                status: reason,
            },
            timestamp: new Date(),
        });

        // Gửi tin nhắn thông qua socket như một tin nhắn chat bình thường
        if (io) {
            io.to(roomId).emit("receiveMessage", {
                _id: message._id,
                roomId: roomId,
                userId: call.caller, // Người bắt đầu cuộc gọi là người gửi
                content: declineMessage,
                type: "call",
                call: {
                    callId: call._id,
                    callType: call.callType || 'audio',
                    status: reason,
                },
                timestamp: message.timestamp,
                status: "sent"
            });
        }
        
        const callObj = call.toObject();
        callObj.lastMessage = message;
        return callObj;

    } catch (err) {
        console.error(`[CallService] Error declineCall: ${err.message}`);
        throw new Error(`Lỗi từ chối cuộc gọi: ${err.message}`);
    }
};

/**
 * Xử lý timeout cuộc gọi (30 giây không có phản hồi)
 */
export const handleCallTimeout = async ({ roomId, callId, io }) => {
    try {
        const call = await Call.findOne({ ...(callId ? {_id: callId} : {}), roomId, status: "pending" });
        
        if (!call) return; // Cuộc gọi đã được xử lý

        // Kiểm tra xem cuộc gọi đã quá 30 giây chưa
        const now = new Date();
        const timeDiff = (now - call.startedAt) / 1000; // tính bằng giây
        
        if (timeDiff >= 30) {
            // Cập nhật status thành no_answer
            await Call.findByIdAndUpdate(call._id, {
                status: "no_answer",
                endedAt: new Date()
            });

            const callLabel = call.callType === 'video' ? 'video' : 'thoại';
            const timeoutMessage = `[Gọi ${callLabel}] Không có phản hồi`;

            const message = await Message.create({
                roomId,
                userId: call.caller,
                type: "call",
                content: timeoutMessage,
                call: {
                    callId: call._id,
                    callType: call.callType || 'audio',
                    status: "no_answer",
                },
                timestamp: new Date(),
            });

            // Gửi tin nhắn timeout
            if (io) {
                io.to(roomId).emit("receiveMessage", {
                    _id: message._id,
                    roomId: roomId,
                    userId: call.caller,
                    content: timeoutMessage,
                    type: "call",
                    call: {
                        callId: call._id,
                        callType: call.callType || 'audio',
                        status: "no_answer",
                    },
                    timestamp: message.timestamp,
                    status: "sent"
                });

                // Gửi event kết thúc cuộc gọi do timeout
                io.to(roomId).emit("call:timeout", {
                    roomId: roomId,
                    callId: call._id,
                    callType: call.callType || 'audio',
                    reason: "no_answer"
                });
            }

            return { ...call.toObject(), lastMessage: message };
        }

        return null;
    } catch (err) {
        console.error(`[CallService] Error handleCallTimeout: ${err.message}`);
        throw new Error(`Lỗi xử lý timeout cuộc gọi: ${err.message}`);
    }
};

/**
 * Kết thúc cuộc gọi
 */
export const endCallService = async ({ roomId, userId, reason, io, callId }) => {
    try {
        const call = await Call.findOneAndUpdate(
            { ...(callId ? {_id: callId} : {}), roomId, status: { $in: ["pending", "answered"] } },
            { status: "ended", reason: reason, endedAt: new Date() },
            { new: true }
        );

        if (!call) return;

        // Tính thời gian cuộc gọi từ lúc answered (chấp nhận) đến lúc ended
        let duration = 0;
        if (call.answeredAt && call.endedAt) {
            duration = Math.floor((call.endedAt - call.answeredAt) / 1000);
        }

        call.duration = duration;
        await call.save();

        // Làm tròn thời gian gọi theo giờ hoặc phút hoặc giây
        let durationText = "";
        if (duration > 0) {
            if (duration >= 3600) {
                const hours = Math.floor(duration / 3600);
                durationText = `${hours} giờ`;
            } else if (duration >= 60) {
                const minutes = Math.floor(duration / 60);
                durationText = `${minutes} phút`;
            } else {
                durationText = `${duration} giây`;
            }
        }

        const callLabel = call.callType === 'video' ? 'video' : 'thoại';
        const callMessage = `[Gọi ${callLabel}` + (duration > 0 ? ` - ${durationText}` : "") + "] Cuộc gọi đã kết thúc ";

        // Tạo message và gửi như tin nhắn chat bình thường (người gọi là người gửi tin nhắn)
        const message = await Message.create({
            roomId,
            userId: call.caller, // Người bắt đầu cuộc gọi sẽ là người gửi tin nhắn
            content: callMessage,
            type: "call",
            call: {
                callId: call._id,
                callType: call.callType || 'audio',
                status: "ended",
                duration,
            },
            timestamp: new Date(),
        });

        // Gửi tin nhắn thông qua socket như một tin nhắn chat bình thường
        if (io) {
            io.to(roomId).emit("receiveMessage", {
                _id: message._id,
                roomId: roomId,
                userId: call.caller, // Người bắt đầu cuộc gọi là người gửi
                content: callMessage,
                type: "call",
                call: {
                    callId: call._id,
                    callType: call.callType || 'audio',
                    status: "ended",
                    duration,
                },
                timestamp: message.timestamp,
                status: "sent"
            });
        }

        // Thêm message vào call để trả về giao diện
        const callObj = call.toObject();
        callObj.lastMessage = message;
        
        return callObj;
    } catch (err) {
        console.error(`[CallService] Error endCall: ${err.message}`);
        throw new Error(`Lỗi kết thúc cuộc gọi: ${err.message}`);
    }
};

/**
 * Lấy lịch sử call trong room
 */
export const getCallHistoryService = async (roomId, { limit = 20, page = 1 } = {}) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            throw new Error("roomId không hợp lệ");
        }

        const parsedLimit = parseInt(limit);
        const parsedPage = parseInt(page);
        if (parsedLimit < 1 || parsedPage < 1) {
            throw new Error("limit và page phải là số dương");
        }

        const skip = (parsedPage - 1) * parsedLimit;

        const calls = await Call.find({ roomId })
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(parsedLimit)
            .lean();

        const totalCalls = await Call.countDocuments({ roomId });

        return {
            calls,
            totalCalls,
            totalPages: Math.ceil(totalCalls / parsedLimit),
            currentPage: parsedPage,
        };
    } catch (err) {
        console.error(`[CallService] Error getCallHistory: ${err.message}`);
        throw new Error(`Lỗi lấy lịch sử cuộc gọi: ${err.message}`);
    }
};
