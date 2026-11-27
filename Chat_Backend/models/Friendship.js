import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema({
  pairKey: {type: String, required: true, unique: true},
  requester: {type: String, required: true, index: true},
  recipient: {type: String, required: true, index: true},
  status: {type: String, enum: ['pending', 'accepted'], default: 'pending', required: true},
}, {timestamps: true});

export default mongoose.model('Friendship', friendshipSchema);
