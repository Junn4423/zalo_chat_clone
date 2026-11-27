// src/api/index.js
import express from 'express';
import chatRoutes from './chat.routes.js';
import authRoutes from './auth.routes.js';
import roomRoutes from './room.routes.js';
import userRoutes from './user.routes.js';
import mediaRoutes from './mediasoup.routes.js'; 
import friendsRoutes from './friends.routes.js';
import callsRoutes from './calls.routes.js';
import User from '../../models/User.js';
import Room from '../../models/Room.js';
import Message from '../../models/Message.js';
import {protect, requireRole} from '../../middleware/auth.middleware.js';

const router = express.Router();

router.use('/chat', chatRoutes);
router.use('/room', roomRoutes);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/media', mediaRoutes); 
router.use('/friends', friendsRoutes);
router.use('/calls', callsRoutes);
router.get('/meta/storage', (req, res) => {
  const retentionDays = Number.parseInt(process.env.CHAT_RELAY_RETENTION_DAYS || '90', 10);
  const apiBase = String(process.env.CHAT_PUBLIC_API_BASE_URL || 'https://login.sof.com.vn/mobilechat-api').replace(/\/+$/, '');
  res.json({
    serviceUrl: apiBase,
    storageInfoUrl: `${apiBase}/api/meta/storage`,
    storage: {
      mode: 'device-first',
      messageDatabase: 'private server relay',
      attachmentDatabase: 'device private storage with temporary server relay',
      relayRetentionDays: Number.isFinite(retentionDays) ? retentionDays : 90,
      databaseConsolePublic: false,
    },
  });
});
// 1 api để clear dữ liệu mongodb (tạm)
router.delete('/clear-data', protect, requireRole('admin'), async (req, res) => {
  try {
    await User.deleteMany({});
    await Room.deleteMany({});
    await Message.deleteMany({});
    res.json({ message: 'Dữ liệu đã được xóa' });
  } catch (error) {
    res.status(500).json({ error: `Lỗi xóa dữ liệu: ${error.message}` });
  }
});

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to ERP Chat Realtime API' });
});

export default router;
