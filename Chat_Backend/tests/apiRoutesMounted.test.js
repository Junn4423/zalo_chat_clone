import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import apiRoutes from '../src/api/index.js';
import {protectedClientRoutes} from './clientApiRouteContract.js';

test(`API root is live and ${protectedClientRoutes.length} client route/method pairs reach auth instead of 404`, async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/`)).status, 200);
    for (const [method, path] of protectedClientRoutes) {
      const response = await fetch(`${base}${path}`, {method});
      assert.equal(response.status, 401, `${method} ${path} should reach auth rather than 404`);
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
