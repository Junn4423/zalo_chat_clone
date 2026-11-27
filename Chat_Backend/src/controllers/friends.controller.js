import mongoose from 'mongoose';
import Friendship from '../../models/Friendship.js';
import User from '../../models/User.js';

const pairKey = (a, b) => JSON.stringify([a, b].sort());
const changed = (req, relationship) => {
  const io = req.app.get('io');
  if (io) for (const id of [relationship.requester, relationship.recipient]) io.to(id).emit('friendship:changed');
};
const validId = value => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
const userView = user => user ? {username: user.lv001, name: user.name, avatar: user.avatar, online: !!user.onlineStatus} : null;

export const listFriends = async (req, res) => {
  try {
    const relationships = await Friendship.find({$or: [{requester: req.userId}, {recipient: req.userId}]}).sort({updatedAt: -1}).lean();
    const otherIds = relationships.map(item => item.requester === req.userId ? item.recipient : item.requester);
    const users = await User.find({lv001: {$in: otherIds}}).select('lv001 name avatar onlineStatus').lean();
    const byId = new Map(users.map(user => [user.lv001, userView(user)]));
    const result = {friends: [], incoming: [], outgoing: []};
    for (const item of relationships) {
      const other = byId.get(item.requester === req.userId ? item.recipient : item.requester);
      if (!other) continue;
      const entry = {id: item._id, user: other, updatedAt: item.updatedAt};
      result[item.status === 'accepted' ? 'friends' : item.recipient === req.userId ? 'incoming' : 'outgoing'].push(entry);
    }
    res.json(result);
  } catch (error) { res.status(500).json({error: 'Không thể tải danh bạ'}); }
};

export const discoverUsers = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100) return res.status(400).json({error: 'Từ khóa quá dài'});
    const filter = {lv001: {$ne: req.userId}, allowAccountDiscovery: {$ne: false}};
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{lv001: {$regex: escaped, $options: 'i'}}, {name: {$regex: escaped, $options: 'i'}}];
    } else {
      const currentUser = await User.findOne({lv001: req.userId}).select('couchDbDatabase').lean();
      if (!currentUser?.couchDbDatabase) return res.json({users: []});
      filter.couchDbDatabase = currentUser.couchDbDatabase;
    }
    const users = await User.find(filter).select('lv001 name avatar onlineStatus').sort({name: 1, lv001: 1}).limit(50).lean();
    const ids = users.map(user => user.lv001);
    const relationships = await Friendship.find({$or: [{requester: req.userId, recipient: {$in: ids}}, {recipient: req.userId, requester: {$in: ids}}]}).lean();
    const lookup = new Map(relationships.map(item => [item.requester === req.userId ? item.recipient : item.requester, item]));
    res.json({users: users.map(user => { const relation = lookup.get(user.lv001); return {...userView(user), relationship: !relation ? 'none' : relation.status === 'accepted' ? 'friends' : relation.requester === req.userId ? 'outgoing' : 'incoming', relationshipId: relation?._id || null}; })});
  } catch (error) { res.status(500).json({error: 'Không thể tìm người dùng'}); }
};

export const requestFriend = async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!username || username === req.userId) return res.status(400).json({error: 'Tài khoản không hợp lệ'});
    const recipient = await User.findOne({lv001: username}).select('lv001 allowFriendRequests blockedUsers').lean();
    if (!recipient) return res.status(404).json({error: 'Không tìm thấy người dùng'});
    const requester = await User.findOne({lv001: req.userId}).select('blockedUsers').lean();
    if ((recipient.blockedUsers || []).includes(req.userId) || (requester?.blockedUsers || []).includes(username)) {
      return res.status(403).json({error: 'Không thể gửi lời mời khi một người đang chặn người còn lại'});
    }
    // Treat a reciprocal request as acceptance of the request already waiting
    // for this user, rather than reporting that a duplicate request failed.
    const existing = await Friendship.findOne({pairKey: pairKey(req.userId, username)});
    if (existing) {
      if (existing.status === 'pending' && existing.requester === username && existing.recipient === req.userId) {
        existing.status = 'accepted';
        await existing.save();
        changed(req, existing);
        return res.json({id: existing._id, accepted: true});
      }
      return res.status(409).json({error: 'Đã có lời mời hoặc hai người đã kết bạn'});
    }
    if (recipient.allowFriendRequests === false) return res.status(403).json({error: 'Người dùng hiện không nhận lời mời kết bạn'});
    const relationship = await Friendship.create({pairKey: pairKey(req.userId, username), requester: req.userId, recipient: username, status: 'pending'});
    changed(req, relationship);
    res.status(201).json({id: relationship._id});
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({error: 'Đã có lời mời hoặc hai người đã kết bạn'});
    res.status(500).json({error: 'Không thể gửi lời mời'});
  }
};

export const acceptFriend = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({error: 'Lời mời không hợp lệ'});
    const relationship = await Friendship.findOneAndUpdate({_id: req.params.id, recipient: req.userId, status: 'pending'}, {$set: {status: 'accepted'}}, {new: true});
    if (!relationship) return res.status(404).json({error: 'Không tìm thấy lời mời'});
    changed(req, relationship); res.json({success: true});
  } catch (error) { res.status(500).json({error: 'Không thể chấp nhận lời mời'}); }
};

export const deleteRequest = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({error: 'Lời mời không hợp lệ'});
    const relationship = await Friendship.findOneAndDelete({_id: req.params.id, status: 'pending', $or: [{requester: req.userId}, {recipient: req.userId}]});
    if (!relationship) return res.status(404).json({error: 'Không tìm thấy lời mời'});
    changed(req, relationship); res.json({success: true});
  } catch (error) { res.status(500).json({error: 'Không thể xử lý lời mời'}); }
};

export const removeFriend = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({error: 'Bạn bè không hợp lệ'});
    const relationship = await Friendship.findOneAndDelete({_id: req.params.id, status: 'accepted', $or: [{requester: req.userId}, {recipient: req.userId}]});
    if (!relationship) return res.status(404).json({error: 'Không tìm thấy bạn bè'});
    changed(req, relationship); res.json({success: true});
  } catch (error) { res.status(500).json({error: 'Không thể hủy kết bạn'}); }
};
