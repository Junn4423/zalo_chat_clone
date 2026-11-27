let accessToken: string | null = null;
let expiresAt = 0;

export const setHiddenChatAccessToken = (token: string, expiresInSeconds = 600) => {
  accessToken = token;
  const lifetime = Number.isFinite(expiresInSeconds) ? Math.max(1, expiresInSeconds) : 600;
  expiresAt = Date.now() + lifetime * 1000;
};

export const getHiddenChatAccessToken = () => {
  if (!accessToken || Date.now() >= expiresAt) {
    clearHiddenChatAccessToken();
    return null;
  }
  return accessToken;
};

export const clearHiddenChatAccessToken = () => {
  accessToken = null;
  expiresAt = 0;
};
