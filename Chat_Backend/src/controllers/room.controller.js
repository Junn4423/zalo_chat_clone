import { getOrCreateOneToOneRoomService, createGroupService, createGroupInviteService, joinGroupByInviteService, getMyRoomsService, getMyGroupsService, getAllRoomsService, deleteRoomService, getGroupMembersService, addGroupMembersService, removeGroupMemberService, renameGroupService, setGroupImageService, setGroupAdminService, transferGroupOwnershipService, leaveGroupService, getRoomPreferenceService, setRoomMuteService, setRoomPinService, setRoomHiddenService, getMyHiddenRoomIdsService } from '../../services/room.service.js';
import ChatPreference from '../../models/ChatPreference.js';

// Tạo hoặc lấy phòng 1-1
export const getOrCreateOneToOneRoom = async (req, res) => {
    try {
        const { userId2 } = req.body;
        const userId1 = req.userId;

        if (!userId2) {
            return res.status(400).json({ error: 'userId2 là bắt buộc' });
        }
        if (userId1 === userId2) {
            return res.status(400).json({ error: 'Không thể tạo phòng với cùng một người dùng' });
        }

        const room = await getOrCreateOneToOneRoomService(userId1, userId2);
        const io = req.app.get('io');
        for (const socket of io.sockets.sockets.values()) {
            if (!room.participants.includes(socket.userId)) continue;
            const hiddenForSocketUser = await ChatPreference.exists({userId: String(socket.userId), roomId: room._id, hidden: true});
            if (!hiddenForSocketUser) socket.join(room._id.toString());
        }
        res.status(201).json(room);
    } catch (error) {
        res.status(500).json({ error: `Lỗi tạo phòng 1-1: ${error.message}` });
    }
};

// Tạo phòng nhóm
export const createGroup = async (req, res) => {
    try {
        const { tenNhom, thanhVien } = req.body;
        const userId = req.userId;

        if (!tenNhom || !thanhVien || thanhVien.length === 0) {
            return res.status(400).json({ error: 'Tên nhóm và danh sách thành viên là bắt buộc' });
        }

        // Kiểm tra số lượng thành viên
        const groupImage = req.body.groupImage || null;

        const room = await createGroupService({ tenNhom, thanhVien, groupImage }, userId);
        const io = req.app.get("io");
        room.participants.forEach(maThanhVien => {
            io.to(maThanhVien.toString()).emit("groupCreated", room);
        });

        res.status(201).json(room);
    } catch (error) {
        res.status(error.status || 500).json({ error: `Lỗi tạo phòng nhóm: ${error.message}` });
    }
};

export const createGroupInvite = async (req, res) => {
    try {
        res.status(201).json(await createGroupInviteService({roomId: req.params.roomId, userId: req.userId}));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const joinGroupByInvite = async (req, res) => {
    try {
        res.json(await joinGroupByInviteService({token: req.body?.token, userId: req.userId, io: req.app.get('io')}));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

// Lấy danh sách phòng của người dùng
export const renameGroup = async (req, res) => {
    try {
        const result = await renameGroupService({
            roomId: req.params.roomId,
            userId: req.userId,
            name: req.body?.name,
            io: req.app.get('io'),
        });
        res.json({success: true, ...result});
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const setGroupImage = async (req, res) => {
    try {
        res.json({success: true, ...await setGroupImageService({
            roomId: req.params.roomId,
            userId: req.userId,
            image: req.body?.image,
            io: req.app.get('io'),
        })});
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const setGroupAdmin = async (req, res) => {
    try {
        res.json({success: true, ...await setGroupAdminService({
            roomId: req.params.roomId,
            userId: req.userId,
            memberId: req.params.memberId,
            isAdmin: req.body?.isAdmin,
            io: req.app.get('io'),
        })});
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const getRoomPreference = async (req, res) => {
    try {
        res.json(await getRoomPreferenceService(req.params.roomId, req.userId));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const setRoomMute = async (req, res) => {
    try {
        const result = await setRoomMuteService({
            roomId: req.params.roomId,
            userId: req.userId,
            muted: req.body?.muted,
            mutedUntil: req.body?.mutedUntil,
            io: req.app.get('io'),
        });
        res.json({success: true, ...result});
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const setRoomPin = async (req, res) => {
    try {
        res.json(await setRoomPinService({roomId: req.params.roomId, userId: req.userId, pinned: req.body?.pinned, io: req.app.get('io')}));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const setRoomHidden = async (req, res) => {
    try {
        res.json(await setRoomHiddenService({roomId: req.params.roomId, userId: req.userId, hidden: req.body?.hidden, io: req.app.get('io')}));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};

export const getMyHiddenRooms = async (req, res) => {
    try {
        res.json(await getMyRoomsService(req.userId, {hiddenOnly: true}));
    } catch (error) {
        res.status(error.status || 500).json({error: `Lỗi lấy trò chuyện ẩn: ${error.message}`});
    }
};

export const getMyHiddenRoomIds = async (req, res) => {
    try {
        res.json({roomIds: await getMyHiddenRoomIdsService(req.userId)});
    } catch (error) {
        res.status(error.status || 500).json({error: `Lỗi lấy trạng thái trò chuyện ẩn: ${error.message}`});
    }
};

export const getMyRooms = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(400).json({ error: 'userId là bắt buộc' });
        }

        const rooms = await getMyRoomsService(userId);
        res.status(200).json(rooms);
    } catch (error) {
        res.status(500).json({ error: `Lỗi lấy danh sách phòng: ${error.message}` });
    }
};

// Lấy danh sách nhóm của người dùng
export const getMyGroups = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(400).json({ error: 'userId là bắt buộc' });
        }

        const rooms = await getMyGroupsService(userId);
        res.status(200).json(rooms);
    } catch (error) {
        res.status(500).json({ error: `Lỗi lấy danh sách nhóm: ${error.message}` });
    }
};

export const getAllRooms = async (req, res) => {
  try {
    const rooms = await getAllRoomsService();
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy danh sách phòng: ${error.message}` });
  }
};

export const deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.userId;
    const io = req.app.get("io");
    if (!roomId) {
      return res.status(400).json({ error: 'roomId là bắt buộc' });
    }

    const result = await deleteRoomService(roomId, userId);
    // Thông báo cho tất cả thành viên trong phòng về việc phòng bị xóa
    io.to(roomId).emit("roomDeleted", roomId );
    
    res.status(200).json(result.message);
  } catch (error) {
    res.status(500).json({ error: `Lỗi xóa phòng: ${error.message}` });
  }
};

export const getGroupMembers = async (req, res) => {
  try {
    const members = await getGroupMembersService(req.params.roomId, req.userId);
    res.json(members);
  } catch (error) {
    res.status(error.status || 500).json({error: error.message});
  }
};

export const addGroupMembers = async (req, res) => {
  try {
    const result = await addGroupMembersService({
      roomId: req.params.roomId,
      userId: req.userId,
      userIds: req.body?.userIds,
      io: req.app.get('io'),
    });
    res.status(201).json({success: true, ...result});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message});
  }
};

export const removeGroupMember = async (req, res) => {
  try {
    const result = await removeGroupMemberService({
      roomId: req.params.roomId,
      userId: req.userId,
      memberId: req.params.memberId,
      io: req.app.get('io'),
    });
    res.json({success: true, ...result});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message});
  }
};

export const transferGroupOwnership = async (req, res) => {
  try {
    const result = await transferGroupOwnershipService({
      roomId: req.params.roomId,
      userId: req.userId,
      newOwnerId: req.body?.newOwnerId,
      io: req.app.get('io'),
    });
    res.json({success: true, ...result});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message});
  }
};

export const leaveGroup = async (req, res) => {
  try {
    const result = await leaveGroupService({
      roomId: req.params.roomId,
      userId: req.userId,
      newOwnerId: req.body?.newOwnerId,
      io: req.app.get('io'),
    });
    res.json({success: true, ...result});
  } catch (error) {
    res.status(error.status || 500).json({error: error.message});
  }
};
