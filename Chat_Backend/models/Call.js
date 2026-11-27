import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  caller: { type: String, ref: 'User', required: true },
  callee: { type: String, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'missed', 'answered', 'declined', 'ended', 'no_answer'],
    default: 'pending'
  },
  callType: { type: String, enum: ['audio', 'video'], default: 'audio' },
  reason: { type: String }, // lý do kết thúc cuộc gọi
  startedAt: { type: Date, default: Date.now },
  answeredAt: { type: Date }, // thời điểm chấp nhận cuộc gọi
  endedAt: { type: Date },
  duration: { type: Number }, // giây (tính từ answeredAt đến endedAt)
  participants: [{ type: String, ref: 'User' }], // cho group call
});

// Index để query theo phòng hoặc thời gian
callSchema.index({ roomId: 1, startedAt: -1 });
callSchema.index({ caller: 1, callee: 1, startedAt: -1 });

export default mongoose.model('Call', callSchema);
