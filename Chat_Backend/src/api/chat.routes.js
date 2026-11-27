import express from 'express';
import {updateLiveLocation, stopLiveLocation} from '../controllers/chat.controller.js';
import { getLatestMessage, getMessages, searchMessages, getMessageContext, getSharedItems, sendMessages, uploadFile, markAsRead, markAllAsRead, getUnreadCount, editMessage, deleteMessage, toggleMessageReaction, forwardMessage, getGroupPins, pinGroupMessage, unpinGroupMessage, getGroupPoll, voteGroupPoll, addGroupPollOption, closeGroupPoll } from '../controllers/chat.controller.js';
import multer from "multer";
import path from "path";
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { protect } from '../../middleware/auth.middleware.js';
import {requireHiddenRoomAccess} from '../../services/hiddenChatAccess.js';

// 📌 Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.CHAT_UPLOAD_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16);
    const fileName = randomUUID() + ext;
    cb(null, fileName);
  }
});
const upload = multer({ storage });
const router = express.Router();

router.get('/get', protect, requireHiddenRoomAccess, getMessages);
router.get('/get-latest', protect, requireHiddenRoomAccess, getLatestMessage);
router.get('/search', protect, requireHiddenRoomAccess, searchMessages);
router.get('/context', protect, requireHiddenRoomAccess, getMessageContext);
router.get('/shared', protect, requireHiddenRoomAccess, getSharedItems);
router.post('/send', protect, requireHiddenRoomAccess, sendMessages);
router.post('/upload', protect, requireHiddenRoomAccess, upload.array('file', 5), uploadFile);
router.put('/message/:messageId', protect, requireHiddenRoomAccess, editMessage);
router.delete('/message/:messageId', protect, requireHiddenRoomAccess, deleteMessage);
router.post('/message/:messageId/reactions', protect, requireHiddenRoomAccess, toggleMessageReaction);
router.post('/message/:messageId/forward', protect, requireHiddenRoomAccess, forwardMessage);
router.get('/group/:roomId/pins', protect, requireHiddenRoomAccess, getGroupPins);
router.post('/group/:roomId/pins/:messageId', protect, requireHiddenRoomAccess, pinGroupMessage);
router.delete('/group/:roomId/pins/:messageId', protect, requireHiddenRoomAccess, unpinGroupMessage);
router.get('/group/:roomId/polls/:messageId', protect, requireHiddenRoomAccess, getGroupPoll);
router.post('/group/:roomId/polls/:messageId/votes', protect, requireHiddenRoomAccess, voteGroupPoll);
router.post('/group/:roomId/polls/:messageId/options', protect, requireHiddenRoomAccess, addGroupPollOption);
router.post('/group/:roomId/polls/:messageId/close', protect, requireHiddenRoomAccess, closeGroupPoll);
router.put('/live-location/:sessionId', protect, requireHiddenRoomAccess, updateLiveLocation);
router.post('/live-location/:sessionId/stop', protect, requireHiddenRoomAccess, stopLiveLocation);

// Routes cho read receipt
router.put('/read/:messageId', protect, requireHiddenRoomAccess, markAsRead); // Đánh dấu 1 tin nhắn đã đọc
router.put('/read-all/:roomId', protect, requireHiddenRoomAccess, markAllAsRead); // Đánh dấu tất cả tin nhắn trong room đã đọc
router.get('/unread-count/:roomId', protect, requireHiddenRoomAccess, getUnreadCount); // Lấy số tin nhắn chưa đọc

export default router;
