import constants from '../../contents/Api_URL';

const API_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

export async function loginAPI(username: string, password: string) {
  try {
    const res = await fetchWithTimeout(constants.API_URLS.AUTH_LOGIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  const data = await res.json();
  if (res.ok && data.token) return data;
  return { error: data.error || data.message || "Sai tài khoản/mật khẩu" };
  } catch (err) {
    return { error: "Không thể kết nối server" };
  }
}

export async function logoutAPI(username: string, token?: string) {
  try {
    const res = await fetchWithTimeout(constants.API_URLS.AUTH_LOGOUT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
      },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (res.ok) return { message: data.message };
    return { error: data.message || "Không thể đăng xuất" };
  } catch (err) {
    return { error: "Không thể kết nối server" };
  }
}
