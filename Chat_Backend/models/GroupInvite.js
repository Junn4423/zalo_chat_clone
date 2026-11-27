import mongoose from 'mongoose';

const groupInviteSchema = new mongoose.Schema({
  roomId: {type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true},
  tokenHash: {type: String, required: true, unique: true, index: true},
  createdBy: {type: String, required: true},
  expiresAt: {type: Date, required: true, index: {expires: 0}},
  revokedAt: {type: Date, default: null},
}, {timestamps: true});

groupInviteSchema.index({roomId: 1, revokedAt: 1});

export default mongoose.model('GroupInvite', groupInviteSchema);
