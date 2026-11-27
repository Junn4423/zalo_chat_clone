import axios from 'axios';
import {useAuthStore} from '../auth/store/login.store';
import {removeToken} from '../auth/utils/storage';
import {invalidateSocketSession} from './sessionLifecycle';
import {getHiddenChatAccessToken} from './hiddenChatAccess';

// Keep credentials on the API client rather than on global Axios defaults.
const client = axios.create({timeout: 12000});
client.interceptors.request.use(config => {
  const token = useAuthStore.getState().auth?.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const hiddenChatToken = getHiddenChatAccessToken();
  if (hiddenChatToken) config.headers['X-Hidden-Chat-Token'] = hiddenChatToken;
  return config;
});

client.interceptors.response.use(
  response => response,
  error => {
    if (error?.response?.status === 401) {
      const requestAuthorization = String(
        error.config?.headers?.Authorization || error.config?.headers?.authorization || '',
      );
      const currentToken = useAuthStore.getState().auth?.token;
      if (!currentToken || requestAuthorization === `Bearer ${currentToken}`) {
        // Stop the authenticated socket before clearing the session. Otherwise
        // a later login can reuse a socket handshaken as the expired account.
        invalidateSocketSession();
        void removeToken()
          .catch(() => undefined)
          .finally(() => useAuthStore.getState().logout());
      }
    }
    return Promise.reject(error);
  },
);

export default client;
