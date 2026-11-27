import mongoose from 'mongoose';

const mediaSessionSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
  active: { type: Boolean, default: true },
  participants: [{
    userId: { type: String, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  config: { type: mongoose.Schema.Types.Mixed, default: {} } // Lưu cấu hình phiên
});

mediaSessionSchema.index({ roomId: 1, active: 1 });
mediaSessionSchema.index({ 'participants.userId': 1 });

export default mongoose.model('MediaSession', mediaSessionSchema);