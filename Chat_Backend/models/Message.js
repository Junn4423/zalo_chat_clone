import mongoose from 'mongoose';

const pollBallotSchema = new mongoose.Schema({
  userId: {type: String, required: true},
  optionIds: {type: [String], default: []},
}, {_id: false});

const pollOptionSchema = new mongoose.Schema({
  id: {type: String, required: true},
  text: {type: String, required: true, maxlength: 100},
  voteCount: {type: Number, default: 0, min: 0},
}, {_id: false});

const groupPollSchema = new mongoose.Schema({
  question: {type: String, required: true, maxlength: 160},
  options: {type: [pollOptionSchema], required: true},
  // Ballots are selected explicitly by the poll APIs and never serialized to a chat client.
  ballots: {type: [pollBallotSchema], default: [], select: false},
  allowMultiple: {type: Boolean, default: false},
  allowAddOptions: {type: Boolean, default: false},
  anonymous: {type: Boolean, default: false},
  hideResultsUntilVote: {type: Boolean, default: false},
  endAt: {type: Date, default: null},
  closedAt: {type: Date, default: null},
  createdBy: {type: String, required: true},
}, {_id: false});

const messageSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  userId: { type: String, ref: 'User', required: true },
  content: { type: String, default: "", maxlength: 2000 },
  type: {
    type: String,
    enum: ['text', 'file', 'image', 'video', 'audio', 'call', 'sticker', 'location', 'gif', 'poll'],
    default: 'text'
  },
  fileMeta: {
    fileName: String,
    fileType: String,
    fileSize: Number,
    fileUrl: String,
    duration: Number,
    images: [{fileName: String, fileType: String, fileSize: Number, fileUrl: String}],
  },
  location: {
    latitude: {type: Number, min: -90, max: 90},
    longitude: {type: Number, min: -180, max: 180},
    accuracy: {type: Number, min: 0},
    liveSessionId: {type: String, maxlength: 100},
    isLive: {type: Boolean, default: false},
    expiresAt: Date,
    status: {type: String, enum: ['active', 'stopped', 'expired']},
    lastUpdatedAt: Date,
    stoppedAt: Date,
  },
  poll: {type: groupPollSchema, default: undefined},
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    userId: String,
    content: { type: String, maxlength: 300 },
    type: { type: String, enum: ['text', 'file', 'image', 'video', 'audio', 'call', 'sticker', 'location', 'gif', 'poll'] },
    fileName: String,
  },
  call: {
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call' }, // tham chiếu sang Calls
    status: {
      type: String,
      enum: ['pending', 'missed', 'answered', 'declined', 'ended', 'no_answer'],
    },
    duration: { type: Number }, // giây
    callType: { type: String, enum: ['audio', 'video'], default: 'audio' },
  },
  relayExpiresAt: {
    type: Date,
    select: false,
    default: () => {
      const configuredDays = Number.parseInt(process.env.CHAT_RELAY_RETENTION_DAYS || '90', 10);
      const retentionDays = Number.isFinite(configuredDays) ? Math.max(1, configuredDays) : 90;
      return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
    },
  },
  timestamp: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read'],
    default: 'pending'
  },
  readBy: [{ type: String, ref: 'User' }], // Mảng userId của những người đã đọc tin nhắn
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  deletedFor: [{ type: String, ref: 'User' }],
  reactions: [{
    _id: false,
    userId: { type: String, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 32 },
    updatedAt: { type: Date, default: Date.now },
  }],
  forwardedFrom: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    userId: String,
  },
  clientMessageId: { type: String, trim: true, maxlength: 100 },
});

// validate file messages
messageSchema.pre('validate', function (next) {
  if (['file', 'image', 'video', 'audio'].includes(this.type)
    && !this.fileMeta?.fileUrl) {
    return next(new Error('fileMeta.fileUrl bắt buộc cho tin nhắn loại file, image, video, hoặc audio'));
  }
  next();
});

messageSchema.index({ timestamp: -1 });
messageSchema.index({ roomId: 1, timestamp: -1 });
messageSchema.index({'location.liveSessionId': 1}, {sparse: true});
messageSchema.index(
  { roomId: 1, userId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);

export default mongoose.model('Message', messageSchema);
