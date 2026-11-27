import MediaSession from '../../models/MediaSession.js';
import mongoose from 'mongoose';

// Lấy thông tin phiên MediaSoup đang hoạt động
export const getActiveSession = async (req, res) => {
  try {
    const { roomId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ error: 'roomId không hợp lệ' });
    }
    
    const session = await MediaSession.findOne({
      roomId,
      active: true
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Không tìm thấy phiên media đang hoạt động' });
    }
    
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: `Lỗi lấy thông tin phiên: ${error.message}` });
  }
};

// Tạo phiên MediaSoup mới
export const createSession = async (req, res) => {
  try {
    const { roomId, config = {}, metadata = {} } = req.body;
    const userId = req.userId;
    
    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ error: 'roomId không hợp lệ' });
    }
    
    // Kiểm tra phiên đang hoạt động
    const existingSession = await MediaSession.findOne({
      roomId,
      active: true
    });
    
    if (existingSession) {
      // Nếu đã có phiên, thêm người dùng vào phiên
      const alreadyParticipant = existingSession.participants.some(
        p => p.userId === userId
      );
      
      if (!alreadyParticipant) {
        existingSession.participants.push({
          userId,
          joinedAt: new Date(),
          metadata: req.body.participantMetadata || {}
        });
        await existingSession.save();
      }
      
      return res.json(existingSession);
    }
    
    // Tạo phiên mới
    const newSession = await MediaSession.create({
      roomId,
      startedAt: new Date(),
      active: true,
      participants: [{
        userId,
        joinedAt: new Date(),
        metadata: req.body.participantMetadata || {}
      }],
      metadata,
      config
    });
    
    res.status(201).json(newSession);
  } catch (error) {
    res.status(500).json({ error: `Lỗi tạo phiên: ${error.message}` });
  }
};

// Cập nhật trạng thái phiên
export const updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { metadata, config, active } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'sessionId không hợp lệ' });
    }
    
    const session = await MediaSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Không tìm thấy phiên' });
    }
    
    // Cập nhật các trường nếu có
    if (metadata) {
      session.metadata = {
        ...session.metadata,
        ...metadata
      };
    }
    
    if (config) {
      session.config = {
        ...session.config,
        ...config
      };
    }
    
    if (typeof active === 'boolean') {
      session.active = active;
      if (active === false) {
        session.endedAt = new Date();
      }
    }
    
    await session.save();
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: `Lỗi cập nhật phiên: ${error.message}` });
  }
};

// Cập nhật thông tin người tham gia
export const updateParticipant = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId, metadata, leftAt } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: 'sessionId không hợp lệ' });
    }
    
    const session = await MediaSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Không tìm thấy phiên' });
    }
    
    const participantIndex = session.participants.findIndex(p => p.userId === userId);
    if (participantIndex === -1) {
      return res.status(404).json({ error: 'Không tìm thấy người tham gia' });
    }
    
    // Cập nhật thông tin người tham gia
    if (metadata) {
      session.participants[participantIndex].metadata = {
        ...session.participants[participantIndex].metadata,
        ...metadata
      };
    }
    
    if (leftAt) {
      session.participants[participantIndex].leftAt = new Date(leftAt);
    }
    
    await session.save();
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: `Lỗi cập nhật người tham gia: ${error.message}` });
  }
};