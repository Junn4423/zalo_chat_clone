import express from 'express';
import {
  getNhanVien,
  getNhanVienId,
  getOnlineUsersList,
  getAllUsersWithStatus,
  getUserOnlineStatus,
  updateUserOnlineStatus,
  cleanupOfflineUsers,
  getPrivacySettings,
  updatePrivacySettings,
  getBlockedUsers,
  blockUser,
  unblockUser,
  getHiddenChatPinStatus,
  setHiddenChatPin,
  unlockHiddenChats,
  cancelHiddenChats
} from '../controllers/user.controller.js';
import { protect } from '../../middleware/auth.middleware.js';

const router = express.Router();

// Existing routes
router.get('/privacy', protect, getPrivacySettings);
router.put('/privacy', protect, updatePrivacySettings);
router.get('/privacy/blocked', protect, getBlockedUsers);
router.post('/privacy/blocked', protect, blockUser);
router.delete('/privacy/blocked/:username', protect, unblockUser);
router.get('/hidden-chat/pin', protect, getHiddenChatPinStatus);
router.put('/hidden-chat/pin', protect, setHiddenChatPin);
router.post('/hidden-chat/unlock', protect, unlockHiddenChats);
router.post('/hidden-chat/cancel', protect, cancelHiddenChats);
router.get('/nhan-vien', protect, getNhanVien);
router.post('/nhan-vien-id', protect, getNhanVienId);

// Online status management routes
router.get('/online', protect, getOnlineUsersList);
router.get('/all-with-status', protect, getAllUsersWithStatus);
router.get('/status/:userId', protect, getUserOnlineStatus);
router.put('/status/:userId', protect, updateUserOnlineStatus);

// Cleanup management (Admin only)
router.post('/cleanup-offline', protect, cleanupOfflineUsers);

export default router;
