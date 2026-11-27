import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLocationPayload} from '../services/liveLocation.service.js';

test('one-time locations keep only validated coordinates', () => {
  assert.deepEqual(normalizeLocationPayload({latitude: 10.5, longitude: 106.7, accuracy: 12}), {
    latitude: 10.5,
    longitude: 106.7,
    accuracy: 12,
  });
});

test('live locations require a bounded expiry and receive active metadata', () => {
  const now = Date.now();
  const value = normalizeLocationPayload({
    latitude: 10.5,
    longitude: 106.7,
    liveSessionId: 'live_abc12345',
    isLive: true,
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  }, now);
  assert.equal(value.liveSessionId, 'live_abc12345');
  assert.equal(value.isLive, true);
  assert.equal(value.status, 'active');
  assert.equal(value.lastUpdatedAt.getTime(), now);
});

test('live locations reject bad IDs, coordinates, and unbounded durations', () => {
  const now = Date.now();
  const invalid = [
    {latitude: 10, longitude: 20, liveSessionId: 'short', isLive: true, expiresAt: new Date(now + 60000)},
    {latitude: 91, longitude: 20},
    {latitude: 10, longitude: 20, liveSessionId: 'live_abc12345', isLive: true, expiresAt: new Date(now + 61 * 60 * 1000)},
  ];
  invalid.forEach(payload => assert.throws(() => normalizeLocationPayload(payload, now), {status: 400}));
});
