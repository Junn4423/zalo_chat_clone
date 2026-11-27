import test from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Room from '../models/Room.js';
import Message from '../models/Message.js';

dotenv.config({path: process.env.MOBILECHAT_QA_ENV || '/var/www/erp.sof.vn.v1/chat-erp-backend/.env', quiet: true, override: true});

test('live-location API updates, protects, stops, and expires an isolated QA session', async () => {
  assert.ok(process.env.MONGODB_URI, 'MONGODB_URI is required');
  const mongoUrl = new URL(process.env.MONGODB_URI);
  mongoUrl.pathname = '/mobilechat_test';
  const mongoUri = mongoUrl.toString();
  const databaseName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
  assert.equal(databaseName, 'mobilechat_test', 'Refusing to write outside the isolated mobilechat_test database');

  await mongoose.connect(mongoUri);
  const id = `MC_LIVE_QA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const senderId = `${id}_S`;
  const recipientId = `${id}_R`;
  const sessionId = `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  let roomId;
  let messageId;

  try {
    await User.create([
      {lv001: senderId, maNhanVien: `${id}_SM`, name: 'Live location QA sender'},
      {lv001: recipientId, maNhanVien: `${id}_RM`, name: 'Live location QA recipient'},
    ]);
    const room = await Room.create({participants: [senderId, recipientId], createdBy: senderId, type: 'one-to-one'});
    roomId = String(room._id);
    const message = await Message.create({
      roomId,
      userId: senderId,
      content: 'Live location QA',
      type: 'location',
      location: {
        latitude: 10,
        longitude: 20,
        liveSessionId: sessionId,
        isLive: true,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'active',
      },
    });
    messageId = message._id;

    const secret = process.env.JWT_SECRET || 'keyOfsof.vn';
    const tokenFor = userId => jwt.sign({id: userId}, secret, {expiresIn: '5m'});
    const endpoint = `http://127.0.0.1:${process.env.PORT || 5070}/api/chat/live-location/${encodeURIComponent(sessionId)}`;
    const roomQuery = `?roomId=${roomId}`;
    const update = async (userId, latitude, longitude) => fetch(`${endpoint}${roomQuery}`, {
      method: 'PUT',
      headers: {Authorization: `Bearer ${tokenFor(userId)}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({latitude, longitude, accuracy: 4}),
    });

    const updateResponse = await update(senderId, 10.1234, 20.5678);
    assert.equal(updateResponse.status, 200, 'owner update should succeed');
    const updatedMessage = await Message.findById(messageId).lean();
    assert.equal(updatedMessage.location.latitude, 10.1234);
    assert.equal(updatedMessage.location.longitude, 20.5678);
    assert.equal(updatedMessage.location.status, 'active');

    const recipientResponse = await update(recipientId, 11, 21);
    assert.equal(recipientResponse.status, 404, 'another room member must not be able to update the sender session');

    const stopResponse = await fetch(`${endpoint}/stop${roomQuery}`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${tokenFor(senderId)}`},
    });
    assert.equal(stopResponse.status, 200, 'owner stop should succeed');
    const stoppedMessage = await Message.findById(messageId).lean();
    assert.equal(stoppedMessage.location.isLive, false);
    assert.equal(stoppedMessage.location.status, 'stopped');

    const stoppedUpdate = await update(senderId, 12, 22);
    assert.equal(stoppedUpdate.status, 410, 'stopped session must reject later updates');

    await Message.updateOne({_id: messageId}, {$set: {
      'location.isLive': true,
      'location.status': 'active',
      'location.expiresAt': new Date(Date.now() - 1000),
    }});
    const expiredUpdate = await update(senderId, 12, 22);
    assert.equal(expiredUpdate.status, 410, 'expired session must reject later updates');
    const expiredMessage = await Message.findById(messageId).lean();
    assert.equal(expiredMessage.location.isLive, false);
    assert.equal(expiredMessage.location.status, 'expired');
  } finally {
    if (messageId) await Message.deleteOne({_id: messageId});
    if (roomId) await Room.deleteOne({_id: roomId});
    await User.deleteMany({lv001: {$in: [senderId, recipientId]}});
    await mongoose.disconnect();
  }
});
