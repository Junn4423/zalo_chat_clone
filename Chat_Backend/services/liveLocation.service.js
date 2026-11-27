const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 60 * 60 * 1000;

export const normalizeLocationPayload = (location, now = Date.now()) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracy = location?.accuracy == null ? undefined : Number(location.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))) {
    throw Object.assign(new Error('Tọa độ vị trí không hợp lệ'), {status: 400});
  }

  const normalized = {latitude, longitude, ...(accuracy === undefined ? {} : {accuracy})};
  if (location?.isLive !== true) return normalized;

  const liveSessionId = typeof location.liveSessionId === 'string' ? location.liveSessionId : '';
  const expiresAt = new Date(location.expiresAt);
  const duration = expiresAt.getTime() - now;
  if (!SESSION_ID_PATTERN.test(liveSessionId)) {
    throw Object.assign(new Error('Mã phiên vị trí trực tiếp không hợp lệ'), {status: 400});
  }
  if (!Number.isFinite(expiresAt.getTime()) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) {
    throw Object.assign(new Error('Thời gian chia sẻ vị trí phải từ 1 phút đến 1 giờ'), {status: 400});
  }

  return {
    ...normalized,
    liveSessionId,
    isLive: true,
    expiresAt,
    status: 'active',
    lastUpdatedAt: new Date(now),
  };
};
