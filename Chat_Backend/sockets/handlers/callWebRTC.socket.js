import { acceptCallService, declineCallService, endCallService, startCallService, handleCallTimeout } from "../../services/call.service.js";
import Room from '../../models/Room.js';
import User from '../../models/User.js';
import mongoose from 'mongoose';
import { assertCanContactInRoom } from '../../services/contact-policy.service.js';
import {assertHiddenChatRoomAccess} from '../../services/hiddenChatAccess.js';

// Active WebRTC calls are intentionally process-local. A backend restart drops
// signaling state, while chat history and the room membership remain durable.
const activeCalls = new Map();

const callParticipants = call => Array.from(call.members, ([id, name]) => ({id, name}));
const emitCallEvent = (io, roomId, from, signal) => {
  io.to(String(roomId)).emit('webrtc-signal', {roomId: String(roomId), from: String(from), signal});
};
const removeCall = call => {
  if (activeCalls.get(String(call.roomId))?.callId === call.callId) activeCalls.delete(String(call.roomId));
};
const ensureHiddenRoomAccess = async (socket, roomId, token) => {
  try {
    await assertHiddenChatRoomAccess({userId: socket.userId, roomId, token});
    return null;
  } catch (error) {
    socket.emit('call:error', {roomId: String(roomId), error: error.message, status: error.status});
    return error;
  }
};

export const handleCallEvents = (socket, io) => {
  // Quản lý cuộc gọi
  socket.on("call:invite", async ({ roomId, type, hiddenChatAccessToken } = {}) => {
    try {
      const senderId = String(socket.userId);
      const room = await Room.findOne({_id: roomId, participants: senderId, deletedAt: null}).lean();
      if (!room) return;
      if (await ensureHiddenRoomAccess(socket, roomId, hiddenChatAccessToken)) return;
      await assertCanContactInRoom(room, senderId, 'calls');
      socket.to(roomId).emit("call:incoming", { from: senderId, roomId, type });
      startCallService({ roomId, userId: senderId, io });
    } catch (error) {
      socket.emit('call:error', {roomId, error: error.message});
    }
    // console.log(`[Call] ${from} mời gọi room ${roomId}`);
  });

  socket.on("call:accept", async ({ roomId, type, hiddenChatAccessToken } = {}) => {
    const senderId = String(socket.userId);
    const room = await Room.findOne({_id: roomId, participants: senderId, deletedAt: null}).select('_id').lean();
    if (!room) return;
    if (await ensureHiddenRoomAccess(socket, roomId, hiddenChatAccessToken)) return;
    socket.to(roomId).emit("call:accepted", { from: senderId, roomId, type });
    acceptCallService({ roomId, userId: senderId });
    // console.log(`[Call] ${from} accepted call in room ${roomId}`);
  });

  socket.on("call:decline", async ({ roomId, reason = "declined", hiddenChatAccessToken } = {}) => {
    const senderId = String(socket.userId);
    const room = await Room.findOne({_id: roomId, participants: senderId, deletedAt: null}).select('_id').lean();
    if (!room) return;
    if (await ensureHiddenRoomAccess(socket, roomId, hiddenChatAccessToken)) return;
    socket.to(roomId).emit("call:declined", { from: senderId, roomId });
    declineCallService({ roomId, userId: senderId, io, reason });
    // console.log(`[Call] ${from} từ chối cuộc gọi room ${roomId}`);
  });

  socket.on("call:end", async ({ roomId, reason, hiddenChatAccessToken } = {}) => {
    const senderId = String(socket.userId);
    if (roomId) {
      // console.log(roomId);
      
      const room = await Room.findOne({_id: roomId, participants: senderId, deletedAt: null}).select('_id').lean();
      if (!room) return;
      if (await ensureHiddenRoomAccess(socket, roomId, hiddenChatAccessToken)) return;
      const call = await endCallService({ roomId, userId: senderId, reason, io });

      // Gửi cho tất cả mọi người trong phòng, bao gồm cả người gửi
      io.to(roomId).emit("call:end", {
        roomId: roomId,
        from: senderId,
        reason: reason || 'ended',
        lastMessage: call ? call.lastMessage : null
      });
      // console.log(`[Call] ${socket.userId} kết thúc cuộc gọi room ${roomId}, reason: ${reason}`);
    } else {
      console.error("[Call] Missing roomId in call-ended data:", data);
    }
  });

  // WebRTC signaling (forward tín hiệu offer/answer/candidate với đầy đủ thông tin)
  socket.on("webrtc-signal", async (data, ack) => {
    try {
      const signal = data?.signal;
      const allowedKinds = new Set(['invite', 'accept', 'decline', 'busy', 'end', 'member-left', 'offer', 'answer', 'candidate']);
      if (!mongoose.Types.ObjectId.isValid(data?.roomId) || !signal || typeof signal !== 'object' ||
          typeof signal.callId !== 'string' || signal.callId.length < 8 || signal.callId.length > 100 ||
          !allowedKinds.has(signal.kind)) {
        if (typeof ack === 'function') ack({success: false, error: 'Tín hiệu không hợp lệ'});
        return;
      }
      const room = await Room.findOne({_id: data.roomId, participants: socket.userId, deletedAt: null}).lean();
      if (!room) {
        if (typeof ack === 'function') ack({success: false, error: 'Không thể gọi trong phòng này'});
        return;
      }
      const hiddenAccessError = await ensureHiddenRoomAccess(socket, data.roomId, data.hiddenChatAccessToken);
      if (hiddenAccessError) {
        if (typeof ack === 'function') ack({success: false, error: hiddenAccessError.message, status: hiddenAccessError.status});
        return;
      }

      const roomId = String(data.roomId);
      const senderId = String(socket.userId);
      let call = activeCalls.get(roomId);
      const acknowledge = result => { if (typeof ack === 'function') ack(result); };

      if (signal.kind === 'invite') {
        await assertCanContactInRoom(room, senderId, 'calls');
        if (call && call.callId !== signal.callId) {
          acknowledge({success: false, error: 'Phòng này đang có cuộc gọi'});
          return;
        }
        if (!call) {
          const caller = await User.findOne({lv001: senderId}).select('name lv001').lean();
          const persistedCall = await startCallService({roomId, userId: senderId, io, callType: signal.video ? 'video' : 'audio'});
          call = {
            callId: signal.callId,
            recordId: String(persistedCall?._id || ''),
            roomId,
            owner: senderId,
            group: room.type === 'group',
            members: new Map([[senderId, caller?.name || caller?.lv001 || 'Người gọi']]),
            invited: new Set(room.participants.map(String).filter(id => id !== senderId)),
            createdAt: Date.now(),
          };
          activeCalls.set(roomId, call);
          setTimeout(() => {
            const pending = activeCalls.get(roomId);
            if (pending?.callId === signal.callId && pending.members.size === 1) removeCall(pending);
          }, 32000).unref?.();
          setTimeout(() => {
            if (activeCalls.get(roomId)?.callId === call.callId && Date.now() - call.createdAt >= 60 * 60 * 1000) removeCall(call);
          }, 60 * 60 * 1000).unref?.();
        }
        if (call.owner !== senderId) {
          acknowledge({success: false, error: 'Chỉ người tạo cuộc gọi mới có thể mời thành viên'});
          return;
        }
        emitCallEvent(io, roomId, senderId, {...signal, group: call.group, participants: callParticipants(call)});
        const peerOnline = Array.from(io.sockets.sockets.values()).some(peer =>
          String(peer.userId) !== senderId && room.participants.map(String).includes(String(peer.userId)) && peer.rooms.has(roomId));
        acknowledge({success: true, peerOnline, participants: callParticipants(call)});
        return;
      }

      if (!call || call.callId !== signal.callId) {
        acknowledge({success: false, error: 'Cuộc gọi không còn hoạt động'});
        return;
      }

      const isMember = call.members.has(senderId);
      const isInvited = call.invited.has(senderId);

      if (signal.kind === 'accept') {
        if (!isInvited && !isMember) {
          acknowledge({success: false, error: 'Bạn không được mời vào cuộc gọi này'});
          return;
        }
        if (isInvited) {
          const user = await User.findOne({lv001: senderId}).select('name lv001').lean();
          call.members.set(senderId, user?.name || user?.lv001 || 'Thành viên');
          call.invited.delete(senderId);
        }
        if (isInvited) await acceptCallService({roomId, userId: senderId, callId: call.recordId});
        const accepted = {...signal, participants: callParticipants(call)};
        socket.to(roomId).emit('webrtc-signal', {roomId, from: senderId, signal: accepted});
        acknowledge({success: true, participants: callParticipants(call)});
        return;
      }

      if (signal.kind === 'decline' || signal.kind === 'busy') {
        if (!isInvited) {
          acknowledge({success: false, error: 'Bạn không còn là người được mời'});
          return;
        }
        call.invited.delete(senderId);
        const event = {...signal, to: call.owner};
        io.to(call.owner).emit('webrtc-signal', {roomId, from: senderId, signal: event});
        if (!call.group || (call.invited.size === 0 && call.members.size === 1)) {
          await declineCallService({roomId, userId: senderId, io, reason: 'declined', callId: call.recordId});
          if (call.group) emitCallEvent(io, roomId, senderId, {kind: 'end', callId: call.callId, endedBy: senderId});
          removeCall(call);
        }
        acknowledge({success: true});
        return;
      }

      if (signal.kind === 'end') {
        if (!isMember && !isInvited) {
          acknowledge({success: false, error: 'Bạn không thuộc cuộc gọi này'});
          return;
        }
        call.invited.delete(senderId);
        if (senderId === call.owner) {
          await endCallService({roomId, userId: senderId, reason: signal.reason || 'ended', io, callId: call.recordId});
          emitCallEvent(io, roomId, senderId, {...signal, endedBy: senderId});
          removeCall(call);
        } else if (isMember) {
          call.members.delete(senderId);
          // Either participant can end a one-to-one call. In a group call,
          // keep it active while another member remains; close it when only
          // the owner is left.
          if (!call.group || call.members.size <= 1) {
            await endCallService({roomId, userId: senderId, reason: signal.reason || 'ended', io, callId: call.recordId});
            emitCallEvent(io, roomId, senderId, {...signal, kind: 'end', endedBy: senderId});
            removeCall(call);
          } else {
            emitCallEvent(io, roomId, senderId, {...signal, kind: 'member-left', participants: callParticipants(call)});
          }
        }
        acknowledge({success: true});
        return;
      }

      if (signal.kind === 'offer' || signal.kind === 'answer' || signal.kind === 'candidate') {
        const targetId = typeof signal.to === 'string' ? signal.to : '';
        if (!isMember || !call.members.has(targetId) || targetId === senderId) {
          acknowledge({success: false, error: 'Đích nhận tín hiệu không thuộc cuộc gọi'});
          return;
        }
        io.to(targetId).emit('webrtc-signal', {roomId, from: senderId, signal});
        acknowledge({success: true});
        return;
      }

      acknowledge({success: false, error: 'Loại tín hiệu chưa được hỗ trợ'});

      // console.log(`[WebRTC] Signal từ ${socket.userId} gửi tới room ${data.roomId}`, {
      //   signalType: data.signal?.sdp?.type || (data.signal?.candidate ? 'candidate' : 'unknown'),
      //   hasCallerInfo: !!(data.signal?.callerId)
      // });
    } catch (error) {
      if (typeof ack === 'function') ack({success: false, error: 'Không thể gửi tín hiệu cuộc gọi'});
    }
  });

  // Cleanup khi user disconnect
  socket.on("disconnect", async () => {
    const userId = String(socket.userId);
    const anotherSession = Array.from(io.sockets.sockets.values()).some(peer => String(peer.userId) === userId);
    if (anotherSession) return;

    for (const call of Array.from(activeCalls.values())) {
      call.invited.delete(userId);
      if (call.owner === userId) {
        try { await endCallService({roomId: call.roomId, userId, reason: 'disconnect', io, callId: call.recordId}); }
        catch (error) { console.error('[Call] Could not persist disconnected call', error?.message); }
        emitCallEvent(io, call.roomId, userId, {kind: 'end', callId: call.callId, endedBy: userId});
        removeCall(call);
      } else if (call.members.delete(userId)) {
        emitCallEvent(io, call.roomId, userId, {kind: 'member-left', callId: call.callId, participants: callParticipants(call)});
      }
    }
  });
};
