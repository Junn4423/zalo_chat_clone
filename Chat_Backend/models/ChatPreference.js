import mongoose from 'mongoose';

const chatPreferenceSchema = new mongoose.Schema({
  userId: {type: String, ref: 'User', required: true, index: true},
  roomId: {type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true},
  muted: {type: Boolean, default: false},
  mutedUntil: {type: Date, default: null},
  pinned: {type: Boolean, default: false},
  hidden: {type: Boolean, default: false},
}, {timestamps: true});

chatPreferenceSchema.index({userId: 1, roomId: 1}, {unique: true});

export default mongoose.model('ChatPreference', chatPreferenceSchema);
