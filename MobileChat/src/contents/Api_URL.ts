export const API_ORIGIN = 'https://login.sof.com.vn/mobilechat-api';
export const API_BASE_URL = `${API_ORIGIN}/api`;
export const API_SOCKET_PATH = '/mobilechat-api/socket.io';

const HTTP = API_BASE_URL;

const constants = {
  API_ORIGIN,
  API_BASE_URL,
  API_SOCKET_PATH,
  API_URLS: {
    AUTH_LOGIN: `${HTTP}/auth/login`,
    AUTH_LOGOUT: `${HTTP}/auth/logout`,
    STORAGE_INFO: `${HTTP}/meta/storage`,
    UPLOAD: `${HTTP}/chat/upload`,
    LOGIN: 'login.sof.vn/index.php',
    GETUSER: `${HTTP}/user/nhan-vien`,
    GETPRIVACY: `${HTTP}/user/privacy`,
    UPDATEPRIVACY: `${HTTP}/user/privacy`,
    GETBLOCKEDUSERS: `${HTTP}/user/privacy/blocked`,
    BLOCKUSER: `${HTTP}/user/privacy/blocked`,
    CREATEROOM: `${HTTP}/room/create-one-to-one`,
    GETUSERBYID: `${HTTP}/user/nhan-vien-id`,
    CREATEROOMS: `${HTTP}/room/create-group`,
    GETMYROOMS: `${HTTP}/room/my-groups`,
    GETALLROOMS: `${HTTP}/room/my-rooms`,
    LAY_ANH: `${API_ORIGIN}/Uploads/`,
  },
};

export default constants;
