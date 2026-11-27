import express from 'express';
import { createServer } from 'http';
import {promises as fs} from 'node:fs';
import connectDB from '../config/db.js';
import Message from '../models/Message.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import apiRoutes from './api/index.js';
import initSocket from '../sockets/init.socket.js';
import cookieParser from "cookie-parser";
import cors from 'cors';
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function expiredUpload(value) {
  if (!value) return null;
  try {
    const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : String(value);
    const match = pathname.match(/(?:^|\/)uploads\/([^/]+)$/i);
    if (!match) return null;
    const filename = decodeURIComponent(match[1]);
    if (!filename || filename === '.' || filename === '..' || path.basename(filename) !== filename) return null;
    return {filename, paths: [pathname, match[1], `Uploads/${match[1]}`, `uploads/${match[1]}`]};
  } catch {
    return null;
  }
}

async function cleanExpiredRelayMessages() {
  const expired = await Message.find({relayExpiresAt: {$lte: new Date()}})
    .select('_id fileMeta relayExpiresAt')
    .limit(500)
    .lean();
  if (!expired.length) return 0;

  const expiredIds = expired.map(message => message._id);
  const files = new Map();
  for (const message of expired) {
    const metas = [message.fileMeta, ...(Array.isArray(message.fileMeta?.images) ? message.fileMeta.images : [])];
    for (const meta of metas) {
      const file = expiredUpload(meta?.fileUrl);
      if (file) files.set(file.filename, file);
    }
  }

  await Message.deleteMany({_id: {$in: expiredIds}});
  await Room.updateMany(
    {pinnedMessageIds: {$in: expiredIds}},
    {$pull: {pinnedMessageIds: {$in: expiredIds}}},
  );

  const uploadDirectory = path.resolve(process.env.CHAT_UPLOAD_DIR || path.join(__dirname, '../Uploads'));
  for (const file of files.values()) {
    const variants = [...new Set(file.paths)];
    const [messageReference, roomReference, userReference] = await Promise.all([
      Message.exists({$or: [
        {'fileMeta.fileUrl': {$in: variants}},
        {'fileMeta.images.fileUrl': {$in: variants}},
      ]}),
      Room.exists({groupImage: {$in: variants}}),
      User.exists({avatar: {$in: variants}}),
    ]);
    if (messageReference || roomReference || userReference) continue;

    const filePath = path.resolve(uploadDirectory, file.filename);
    if (filePath.startsWith(`${uploadDirectory}${path.sep}`)) {
      await fs.unlink(filePath).catch(() => undefined);
    }
  }
  return expired.length;
}

const app = express();
const server = createServer(app);
const port = process.env.PORT || 5070;
const IP = process.env.SERVER_IP || 'localhost';
const corsOptions = {
  origin: ['https://login.sof.com.vn', 'http://localhost', 'http://127.0.0.1'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true, // Cho phép cookie từ frontend
};

// Middleware
app.use(express.json({limit: '8mb'}));

const chatUploadDirectory = process.env.CHAT_UPLOAD_DIR || path.join(__dirname, "../Uploads");
app.use("/Uploads", express.static(chatUploadDirectory));
app.use("/uploads", express.static(chatUploadDirectory));
app.use(cookieParser());
app.use(cors(corsOptions));

app.get('/invite/:username', (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
  if (!username || username.length > 120 || /[\u0000-\u001f]/.test(username)) {
    return res.status(400).type('text/plain').send('Invalid MobileChat invite');
  }

  const safeUsername = username.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const deepLink = `mobilechat://friend/${encodeURIComponent(username)}`;
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  return res.type('html').send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lời mời MobileChat</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f2f6fb;color:#1b2a3a;font:16px system-ui,sans-serif}
main{width:min(100%,420px);padding:30px 24px;border-radius:22px;background:#fff;text-align:center;box-shadow:0 12px 36px #20344a20}
.mark{margin:0 auto 18px;width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:#e8f3ff;color:#087bfa;font-size:28px;font-weight:800}
h1{margin:0;font-size:22px}p{color:#6e7d8c;line-height:1.5}.account{color:#1b2a3a;font-weight:700;overflow-wrap:anywhere}
a{display:block;margin-top:22px;padding:14px;border-radius:13px;background:#087bfa;color:white;text-decoration:none;font-weight:700}
</style></head><body><main><div class="mark">M</div><h1>Lời mời kết bạn</h1><p>Tìm tài khoản MobileChat</p><p class="account">${safeUsername}</p><a href="${deepLink}">Mở trong MobileChat</a><p>Bạn vẫn cần xác nhận lời mời trong ứng dụng.</p></main></body></html>`);
});

// Routes
app.use('/api', apiRoutes);

(async () => {
  try {
    // Kết nối MongoDB
    await connectDB();
    // console.log('Connected to MongoDB successfully');

    // Khởi động Socket.IO
    const io = initSocket(server);
    app.set("io", io); // Gắn io vào app để dùng trong controller

    // Khởi động Online Status Manager
    const { onlineStatusManager } = await import('../services/onlineStatusManager.js');
    // onlineStatusManager.startScheduledCleanup(5); // Cleanup mỗi 5 phút
    // console.log('Online Status Manager started with 5-minute cleanup interval');

    // Khởi động server
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
    const relayCleanupTimer = setInterval(() => {
      cleanExpiredRelayMessages().catch(error => {
        console.error('Relay retention cleanup failed:', error.message);
      });
    }, 60 * 60 * 1000);
    relayCleanupTimer.unref?.();
  } catch (error) {
    console.error('Lỗi khởi động server:', error.message);
    process.exit(1);
  }
})();

// Xử lý lỗi toàn cục trong Express
app.use((err, req, res, next) => {
  console.error('Lỗi toàn cục trong Express:', err.message);
  res.status(500).json({ error: 'Lỗi server nội bộ' });
});

// Xử lý lỗi không bắt được
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason.message);
  process.exit(1);
});
