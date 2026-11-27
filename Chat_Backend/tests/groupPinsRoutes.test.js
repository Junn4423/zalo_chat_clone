import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import chatRoutes from '../src/api/chat.routes.js';

test('group pin board routes are mounted behind authentication', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const roomId = '507f1f77bcf86cd799439011';
  const messageId = '507f1f77bcf86cd799439012';
  const requests = [
    ['GET', `/api/chat/group/${roomId}/pins`],
    ['POST', `/api/chat/group/${roomId}/pins/${messageId}`],
    ['DELETE', `/api/chat/group/${roomId}/pins/${messageId}`],
  ];
  try {
    for (const [method, path] of requests) {
      const response = await fetch(`${base}${path}`, {method});
      assert.equal(response.status, 401, `${method} ${path} should be mounted behind auth`);
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
