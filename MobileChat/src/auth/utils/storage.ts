import AsyncStorage from "@react-native-async-storage/async-storage";

export async function setToken(token: string) {
  if (typeof token === 'string') {
    await AsyncStorage.setItem("token", token);
  } else {
    await AsyncStorage.setItem("token", JSON.stringify(token));
  }
}

export async function getToken() {
  return await AsyncStorage.getItem("token");
}

export async function removeToken() {
  await AsyncStorage.removeItem("token");
}

export async function setRememberedUsername(username: string) {
  await AsyncStorage.setItem("remembered-username", username);
}

export async function getRememberedUsername() {
  return await AsyncStorage.getItem("remembered-username");
}

export async function removeRememberedUsername() {
  await AsyncStorage.removeItem("remembered-username");
}
