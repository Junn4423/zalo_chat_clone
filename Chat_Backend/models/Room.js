import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
  },
  participants: {
    type: [String],
    required: true,
    index: true,
  },
  admins: {
    type: [String],
    default: [],
  },
  pinnedMessageIds: {
    type: [{type: mongoose.Schema.Types.ObjectId, ref: 'Message'}],
    default: [],
  },
  uniquePair: {
    type: String,
    required: false,
    index: true,
    unique: true,
    sparse: true, // Cho phép null
  },
  groupImage:{
    type: String,
    required: false,
  },
  createdBy: {
    type: String,
    required: true,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedBy: {
    type: String,
    default: null,
  },
  
  type: {
    type: String,
    enum: ['one-to-one', 'group'],
    required: true,
  },
});

roomSchema.pre('validate', function (next) {
  if (this.type === 'group' && !this.name) {
    return next(new Error('Phòng nhóm phải có tên'));
  }
  if (this.type === 'one-to-one' && this.participants.length !== 2) {
    return next(new Error('Phòng 1-1 phải có đúng 2 người tham gia'));
  }
  if (new Set(this.participants).size !== this.participants.length) {
    return next(new Error('Danh sách participants không được chứa trùng lặp'));
  }
  next();
});

// Tạo compound index để tối ưu truy vấn phòng 1-1
roomSchema.index({ participants: 1, type: 1 });

export default mongoose.model('Room', roomSchema);
