// src/models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  lv001: {
    type: String,
    required: true,
    unique: true,
  },
  maNhanVien: {
    type: String,
    required: true,
    unique: true,
  },
  couchDbDatabase: {
    type: String,
    default: null,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: 'user'
  },
  avatar: {
    type: String,
    default: "",
  },
  onlineStatus: {
    type: Boolean,
    default: false,
  },
  allowAccountDiscovery: {
    type: Boolean,
    default: true,
  },
  allowFriendRequests: {
    type: Boolean,
    default: true,
  },
  allowMessagesFromNonFriends: {
    type: Boolean,
    default: true,
  },
  allowCallsFromNonFriends: {
    type: Boolean,
    default: true,
  },
  blockedUsers: {
    type: [String],
    default: [],
  },
  hiddenChatPinHash: {
    type: String,
    default: null,
    select: false,
  },
  hiddenChatPinFailures: {
    type: Number,
    default: 0,
  },
  hiddenChatPinLockedUntil: {
    type: Date,
    default: null,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
});

// Tạo index
userSchema.index({ name: 1 });

export default mongoose.model('User', userSchema);
