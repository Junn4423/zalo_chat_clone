import express from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { getActiveSession, createSession, updateSession, updateParticipant } from '../controllers/mediasoup.controller.js';

const router = express.Router();

// Lấy thông tin phiên MediaSoup đang hoạt động
router.get('/session/:roomId', protect, getActiveSession);

// Tạo phiên MediaSoup mới
router.post('/session', protect, createSession);

// Cập nhật trạng thái phiên
router.put('/session/:sessionId', protect, updateSession);

// Cập nhật thông tin người tham gia
router.put('/session/:sessionId/participant', protect, updateParticipant);

export default router;