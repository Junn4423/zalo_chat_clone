import { saveMessage, createReplyPreview, markMessageAsRead, markAllMessagesAsRead, getUnreadMessagesCount } from "../../services/chat.service.js";
import Room from "../../models/Room.js";
import { runWithContext } from "../../utils/context.js";
import Message from "../../models/Message.js";
import {normalizeLocationPayload} from "../../services/liveLocation.service.js";
import {assertHiddenChatRoomAccess} from "../../services/hiddenChatAccess.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gửi tin nhắn đến phòng
async function handleSendMessageTo(socket, io, { roomId, message, type = "text", fileMeta, location, poll, replyToId, clientMessageId, hiddenChatAccessToken }, callback) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }

    const room = await Room.findById(roomId);
    if (!room || room.deletedAt || !room.participants.includes(context.userId)) throw new Error('Không có quyền gửi tin nhắn vào phòng này');
    await assertHiddenChatRoomAccess({userId: context.userId, roomId, token: hiddenChatAccessToken});
    const idempotencyKey = typeof clientMessageId === 'string' ? clientMessageId.trim() : '';
    if (clientMessageId !== undefined && (!idempotencyKey || idempotencyKey.length > 100)) {
      throw new Error('Invalid clientMessageId');
    }
    if (idempotencyKey) {
      const existing = await Message.findOne({roomId, userId: context.userId, clientMessageId: idempotencyKey}).lean();
      if (existing) {
        socket.emit("receiveMessage", {
          _id: existing._id,
          roomId: room._id,
          from: context.userId,
          to: room.participants.filter(p => String(p) !== String(context.userId)),
          content: existing.content,
          type: existing.type,
          createdAt: existing.timestamp,
          fileMeta: existing.fileMeta || null,
          location: existing.location || null,
          replyTo: existing.replyTo || null,
          clientMessageId: idempotencyKey,
          lastMessage: {content: existing.content, type: existing.type, createdAt: existing.timestamp},
        });
        if (typeof callback === 'function') callback({success: true, messageId: String(existing._id), deduplicated: true});
        return;
      }
    }
    let messageData = {
      roomId,
      userId: context.userId,
      content: sanitizeMessageContent(message),
      type,
      ...(type === 'poll' ? {poll} : {}),
      replyTo: await createReplyPreview(roomId, replyToId),
      ...(idempotencyKey ? {clientMessageId: idempotencyKey} : {}),
    };
    if (type === 'location') {
      messageData.location = normalizeLocationPayload(location);
    }

    await runWithContext(context, async () => {
      // Xử lý file nếu có
      if (fileMeta && fileMeta.fileData) {
        const uploadDir = path.join(__dirname, "../../Uploads");
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const fileExtension = path.extname(fileMeta.fileName) || `.${fileMeta.fileType.split("/")[1] || "bin"}`;
        const fileName = `${Date.now()}_${fileMeta.fileName}`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFileSync(filePath, Buffer.from(fileMeta.fileData));

        messageData = {
          ...messageData,
          type: fileMeta.fileType.startsWith("image") ? "image" :
            fileMeta.fileType.startsWith("video") ? "video" :
              fileMeta.fileType.startsWith("audio") ? "audio" : "file",
          fileMeta: {
            fileName: fileMeta.fileName,
            fileType: fileMeta.fileType,
            fileSize: fileMeta.fileSize,
            fileUrl: `/Uploads/${fileName}`
          }
        };
      } else if (!message && type === "text") {
        throw new Error("Nội dung tin nhắn văn bản không được để trống");
      }

      const savedMessage = await saveMessage(messageData);

      // Gửi tin nhắn đến các thành viên khác trong phòng
      const otherParticipants = room.participants.filter(p => p.toString() !== context.userId.toString());
      const payload = {
        _id: savedMessage._id,
        roomId: room._id,
        from: context.userId,
        to: otherParticipants,
        content: savedMessage.content,
        type: savedMessage.type,
        createdAt: savedMessage.timestamp,
        fileMeta: savedMessage.fileMeta || null,
        location: savedMessage.location || null,
        poll: savedMessage.poll || null,
        replyTo: savedMessage.replyTo || null,
        clientMessageId: savedMessage.clientMessageId || undefined,
        lastMessage: {
          content: savedMessage.content,
          type: savedMessage.type,
          createdAt: savedMessage.timestamp
        }
      };
      if (savedMessage.deduplicated) socket.emit("receiveMessage", payload);
      else io.to(room._id.toString()).emit("receiveMessage", payload);

      socket.emit("messageSent", { messageId: savedMessage._id, clientMessageId: savedMessage.clientMessageId || undefined });
      if (typeof callback === 'function') callback({success: true, messageId: String(savedMessage._id), deduplicated: Boolean(savedMessage.deduplicated)});
    });
  } catch (error) {
    if (typeof callback === 'function') callback({success: false, error: error.message, status: error.status});
    socket.emit("error", { message: error.message, status: error.status });
  }
}

// Đánh dấu tin nhắn đã đọc
async function handleMarkAsRead(socket, io, { messageId, roomId, hiddenChatAccessToken }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }

    if (!roomId) {
      throw new Error("Thiếu roomId");
    }

    const room = await Room.findOne({ _id: roomId, deletedAt: null });
    if (!room || !room.participants.includes(context.userId)) {
      throw new Error("Không có quyền truy cập phòng này");
    }

    await assertHiddenChatRoomAccess({userId: context.userId, roomId, token: hiddenChatAccessToken});
    if (messageId) {
      const targetMessage = await Message.findOne({ _id: messageId, roomId }).select("_id").lean();
      if (!targetMessage) throw new Error("Tin nhắn không tồn tại trong phòng này");

      // Đánh dấu một tin nhắn cụ thể
      const message = await markMessageAsRead(messageId, context.userId);
      io.to(roomId).emit("messageRead", {
        messageId,
        readBy: context.userId,
        timestamp: new Date()
      });
      socket.emit("markAsReadSuccess", { messageId, readBy: message.readBy });
    } else if (roomId) {
      // Đánh dấu tất cả tin nhắn trong phòng
      const result = await markAllMessagesAsRead(roomId, context.userId);
      io.to(roomId).emit("allMessagesRead", {
        roomId,
        readBy: context.userId,
        modifiedCount: result.modifiedCount,
        timestamp: new Date()
      });
      socket.emit("markAllAsReadSuccess", { roomId, ...result });
    } else {
      throw new Error("Cần messageId hoặc roomId");
    }
  } catch (error) {
    socket.emit("error", { message: error.message });
  }
}

// Lấy trạng thái đọc cho một tin nhắn, chỉ khi người yêu cầu là thành viên phòng.
async function handleGetMessageReadStatus(socket, { messageId, roomId, hiddenChatAccessToken }) {
  try {
    const userId = socket.context?.userId;
    if (!userId) throw new Error("Thiếu thông tin: userId");
    if (!messageId || !roomId) throw new Error("Cần messageId và roomId");

    const room = await Room.findOne({ _id: roomId, deletedAt: null, participants: userId }).select("_id participants").lean();
    if (!room) throw new Error("Không có quyền truy cập phòng này");

    await assertHiddenChatRoomAccess({userId, roomId, token: hiddenChatAccessToken});
    const message = await Message.findOne({ _id: messageId, roomId }).select("userId readBy").lean();
    if (!message) throw new Error("Tin nhắn không tồn tại trong phòng này");

    const senderId = String(message.userId);
    const participantIds = new Set(room.participants.map(String));
    const readBy = [...new Set((message.readBy || []).map(String))]
      .filter((readerId) => readerId !== senderId && participantIds.has(readerId));

    socket.emit("messageReadStatus", {
      messageId: String(messageId),
      roomId: String(roomId),
      readBy,
      isRead: readBy.length > 0,
    });
  } catch (error) {
    socket.emit("error", { message: error.message });
  }
}

// Cập nhật trạng thái tin nhắn
async function handleUpdateMessageStatus(socket, io, { messageId, roomId, status, hiddenChatAccessToken }) {
  try {
    const userId = socket.context?.userId;
    if (!userId || !roomId || !messageId) throw new Error("Missing message information");
    const room = await Room.findOne({_id: roomId, deletedAt: null, participants: userId}).select('_id').lean();
    if (!room) throw new Error('Room access denied');
    await assertHiddenChatRoomAccess({userId, roomId, token: hiddenChatAccessToken});
    const updated = await Message.findOneAndUpdate({ _id: messageId, roomId }, { status }, {new: true}).select('_id').lean();
    if (!updated) throw new Error('Message not found in room');
    io.to(roomId).emit("messageStatusUpdated", { messageId, status });
  } catch (error) {
    socket.emit("error", { message: error.message, status: error.status });
  }
}

// Lấy số lượng tin nhắn chưa đọc
async function handleGetUnreadCount(socket, io, { roomId, hiddenChatAccessToken }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }

    if (!roomId) {
      throw new Error("Thiếu roomId");
    }

    const room = await Room.findOne({_id: roomId, deletedAt: null, participants: context.userId}).select('_id').lean();
    if (!room) throw new Error('Room access denied');
    await assertHiddenChatRoomAccess({userId: context.userId, roomId, token: hiddenChatAccessToken});
    const unreadCount = await getUnreadMessagesCount(roomId, context.userId);
    socket.emit("unreadCountResponse", {
      roomId,
      unreadCount,
      userId: context.userId
    });
  } catch (error) {
    socket.emit("error", { message: error.message });
  }
}

async function handleTypingState(socket, data, active) {
  try {
    const userId = socket.context?.userId;
    const roomId = String(data?.roomId || '');
    if (!userId || !roomId) return;
    const room = await Room.findOne({_id: roomId, participants: userId, deletedAt: null}).select('_id').lean();
    if (!room) return;
    await assertHiddenChatRoomAccess({userId, roomId, token: data?.hiddenChatAccessToken});
    socket.to(String(room._id)).emit(active ? 'userTyping' : 'userStoppedTyping', {
      roomId: String(room._id),
      userId: String(userId),
    });
  } catch (error) {
    // Typing is a transient hint; malformed/stale room IDs should not interrupt chat.
  }
}

// Hàm làm sạch nội dung tin nhắn
function sanitizeMessageContent(content) {
  // Loại bỏ các thẻ HTML và script để tránh XSS
  if (typeof content !== 'string') return '';

  // Loại bỏ script
  content = content.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, "");
  // Loại bỏ style
  content = content.replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, "");
  // Loại bỏ các thẻ HTML khác
  content = content.replace(/<\/?[^>]+(>|$)/g, ""); // Loại bỏ thẻ HTML
  content = content.replace(/&nbsp;/g, ' '); // Thay thế &nbsp; bằng khoảng trắng
  content = content.replace(/\s+/g, ' '); // Thay thế nhiều khoảng trắng bằng một khoảng trắng

  return content.trim();
}

// Đăng ký các sự kiện socket
export const handleMessageEvents = (socket, io) => {
  socket.on("sendMessageTo", (data, callback) => handleSendMessageTo(socket, io, data || {}, callback));
  socket.on('typing', data => { void handleTypingState(socket, data, true); });
  socket.on('stopTyping', data => { void handleTypingState(socket, data, false); });
  socket.on("markAsRead", (data) => handleMarkAsRead(socket, io, data));
  socket.on("getMessageReadStatus", (data) => handleGetMessageReadStatus(socket, data));
  socket.on("updateMessageStatus", (data) => handleUpdateMessageStatus(socket, io, data));
  socket.on("getUnreadCount", (data) => handleGetUnreadCount(socket, io, data));
};
