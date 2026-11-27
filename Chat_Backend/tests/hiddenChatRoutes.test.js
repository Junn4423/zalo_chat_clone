import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import userRoutes from '../src/api/user.routes.js';
import roomRoutes from '../src/api/room.routes.js';
import chatRoutes from '../src/api/chat.routes.js';

test('hidden-chat routes are mounted and reach authentication instead of returning 404', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/user', userRoutes);
  app.use('/api/room', roomRoutes);
  app.use('/api/chat', chatRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const requests = [
    ['GET', '/api/user/hidden-chat/pin'],
    ['PUT', '/api/user/hidden-chat/pin'],
    ['POST', '/api/user/hidden-chat/unlock'],
    ['POST', '/api/user/hidden-chat/cancel'],
    ['GET', '/api/room/hidden-ids'],
    ['GET', '/api/room/hidden'],
    ['PUT', '/api/room/507f1f77bcf86cd799439011/hidden'],
    ['PUT', '/api/chat/live-location/live_abc12345?roomId=507f1f77bcf86cd799439011'],
    ['POST', '/api/chat/live-location/live_abc12345/stop?roomId=507f1f77bcf86cd799439011'],
  ];
  try {
    for (const [method, path] of requests) {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(method === 'PUT' || method === 'POST' ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pin: '0427', hidden: true})} : {}),
      });
      assert.equal(response.status, 401, `${method} ${path} should be mounted behind auth`);
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
