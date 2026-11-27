import axios, { AxiosResponse } from "axios";
import client from '../client';
import constants from "../../contents/Api_URL";
import { User } from "../../types/User";

export type PrivacySettings = {
  allowAccountDiscovery: boolean;
  allowFriendRequests: boolean;
  allowMessagesFromNonFriends: boolean;
  allowCallsFromNonFriends: boolean;
};

export type BlockedUser = {username: string; name: string; avatar: string};

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface ApiPayload {
  table: string;
  func: string;
  [key: string]: any;
}
export const handleApiResponse = <T = any>(response: AxiosResponse): T => {
  try {
    const data = response.data;

    // Nếu API trả về success: false, throw exception với message
    if (typeof data === 'object' && data.success === false) {
      const errorMessage = data.message || 'Unknown error from API';
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Thử lấy error message từ response body
      try {
        const errorData = error.response?.data;
        const errorMessage =
          errorData?.message || `HTTP Error: ${error.response?.status}`;
        throw new Error(errorMessage);
      } catch {
        const errorMessage = `HTTP Error: ${error.response?.status}`;
        throw new Error(errorMessage);
      }
    }
    // Re-throw exception với message gốc
    throw error;
  }
};

export const layTatCaNhanVien = async (): Promise<User[]> => {
  try {
    console.log('Fetching all employees...');
    console.log('API URL:', constants.API_URLS.GETUSER);
    const response = await client.get(constants.API_URLS.GETUSER);
    return handleApiResponse(response);
  } catch (error) {
    console.error('Lỗi:', error);
    throw error;
  }
};
// Lấy nhân viên dựa theo userID phương thức post
export const layNhanVienTheoId = async (userId: string): Promise<User | null> => {
  try {
    console.log('Fetching employee by ID...');
    console.log('API URL:', constants.API_URLS.GETUSERBYID);
    const response = await client.post(constants.API_URLS.GETUSERBYID, { userId });
    return handleApiResponse(response);
  } catch (error) {
    console.error('Lỗi:', error);
    return null;
  }
};

export const getPrivacySettings = async (): Promise<PrivacySettings> => {
  const response = await client.get<PrivacySettings>(constants.API_URLS.GETPRIVACY);
  return response.data;
};

export const updatePrivacySettings = async (updates: Partial<PrivacySettings>): Promise<PrivacySettings> => {
  const response = await client.put<PrivacySettings>(constants.API_URLS.UPDATEPRIVACY, updates);
  return response.data;
};

export const getBlockedUsers = async (): Promise<BlockedUser[]> => {
  const response = await client.get<{users: BlockedUser[]}>(constants.API_URLS.GETBLOCKEDUSERS);
  return response.data.users || [];
};

export const blockUser = async (username: string): Promise<BlockedUser[]> => {
  const response = await client.post<{users: BlockedUser[]}>(constants.API_URLS.BLOCKUSER, {username});
  return response.data.users || [];
};

export const unblockUser = async (username: string): Promise<BlockedUser[]> => {
  const response = await client.delete<{users: BlockedUser[]}>(`${constants.API_URLS.BLOCKUSER}/${encodeURIComponent(username)}`);
  return response.data.users || [];
};
