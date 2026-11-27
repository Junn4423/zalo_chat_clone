
import express from 'express';
import { getOrCreateOneToOneRoom, createGroup, getMyRooms, getMyGroups, getAllRooms, deleteRoom, getGroupMembers, addGroupMembers, removeGroupMember, renameGroup, setGroupImage, setGroupAdmin, transferGroupOwnership, leaveGroup, getRoomPreference, setRoomMute, setRoomPin, setRoomHidden, getMyHiddenRooms, getMyHiddenRoomIds } from '../controllers/room.controller.js';
import { protect, requireRole, requireHiddenChatAccess } from '../../middleware/auth.middleware.js';
import {requireHiddenRoomAccess} from '../../services/hiddenChatAccess.js';
const router = express.Router();

router.post('/create-one-to-one', protect, getOrCreateOneToOneRoom);
router.post('/create-group', protect, createGroup);
router.get('/my-rooms', protect, getMyRooms);
router.get('/my-groups', protect, getMyGroups);
router.get('/hidden-ids', protect, getMyHiddenRoomIds);
router.get('/hidden', protect, requireHiddenChatAccess, getMyHiddenRooms);
router.patch('/:roomId', protect, requireHiddenRoomAccess, renameGroup);
router.put('/:roomId/image', protect, requireHiddenRoomAccess, setGroupImage);
router.put('/:roomId/admins/:memberId', protect, requireHiddenRoomAccess, setGroupAdmin);
router.get('/:roomId/preference', protect, requireHiddenRoomAccess, getRoomPreference);
router.put('/:roomId/mute', protect, requireHiddenRoomAccess, setRoomMute);
router.put('/:roomId/pin', protect, requireHiddenRoomAccess, setRoomPin);
router.put('/:roomId/hidden', protect, requireHiddenRoomAccess, setRoomHidden);
router.get('/:roomId/members', protect, requireHiddenRoomAccess, getGroupMembers);
router.post('/:roomId/members', protect, requireHiddenRoomAccess, addGroupMembers);
router.delete('/:roomId/members/:memberId', protect, requireHiddenRoomAccess, removeGroupMember);
router.post('/:roomId/transfer-ownership', protect, requireHiddenRoomAccess, transferGroupOwnership);
router.delete('/:roomId/leave', protect, requireHiddenRoomAccess, leaveGroup);
router.get('/all-rooms', protect, requireRole('admin'), getAllRooms);
router.delete('/delete-room/:roomId', protect, requireHiddenRoomAccess, deleteRoom);

export default router;
