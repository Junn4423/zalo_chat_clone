import { AxiosResponse } from "axios";
import client from '../client';
import constants from "../../contents/Api_URL";
import { socket } from "../../utils/socket"; 

// Create a room
export const LayTaoPhongChat = async (userId: string): Promise<AxiosResponse> => {
  try {
    console.log("Creating room for userId:", userId);
    console.log("API URL:", constants.API_URLS.CREATEROOM);
    const response = await client.post(constants.API_URLS.CREATEROOM, { "userId2": userId });
    return response;
  } catch (error) {
    throw error;
  }
};
// Lấy lịch sử tin nhắn theo trang cũ hoặc mốc đồng bộ mới.
export const LayLichSuTinNhan = async (
  chatId: string,
  limit = 25,
  page = 1,
  cursor?: { before?: string; after?: string },
) => {
  try {
    const res = await client.get(`${constants.API_BASE_URL}/chat/get`, {
      params: {roomId: chatId, limit, page, ...cursor},
    });
    return res.data;
  } catch (error) {
    throw error;
  }
};

export type ExportableChatMessage = {
  _id: string;
  userId: string;
  content?: string;
  timestamp: string;
  type?: string;
  fileMeta?: {fileName?: string; fileUrl?: string; fileType?: string; images?: Array<{fileName?: string; fileType?: string; fileUrl?: string}>};
  location?: {latitude?: number; longitude?: number; accuracy?: number};
  call?: {status?: string; duration?: number; callType?: string};
  poll?: {question?: string; options?: Array<{id: string; text: string; voteCount: number | null}>; allowMultiple?: boolean; anonymous?: boolean; endAt?: string | null; closedAt?: string | null};
  replyTo?: {userId?: string; content?: string; type?: string; fileName?: string};
  forwardedFrom?: {userId?: string};
  reactions?: Array<{emoji: string; userId?: string}>;
  deletedAt?: string | null;
  editedAt?: string | null;
};

export const getChatHistoryPage = async (roomId: string, page: number, limit = 100) => {
  const response = await LayLichSuTinNhan(roomId, limit, page);
  return response as {messages: ExportableChatMessage[]; page?: number; hasMore?: boolean; total?: number};
};

export const searchRoomMessages = async (roomId: string, query: string, page = 1) => {
  const response = await client.get(`${constants.API_BASE_URL}/chat/search`, {
    params: {roomId, q: query, page},
  });
  return response.data as {messages: Array<{_id: string; userId: string; content: string; timestamp: string; fileMeta?: {fileName?: string; fileUrl?: string}}>; total: number; page: number; hasMore: boolean};
};

export const getMessageContext = async (roomId: string, messageId: string) => {
  const response = await client.get(`${constants.API_BASE_URL}/chat/context`, {params: {roomId, messageId}});
  return response.data as Pick<Awaited<ReturnType<typeof searchRoomMessages>>, 'messages'>;
};

export type SharedMessage = {
  _id: string;
  userId: string;
  content?: string;
  timestamp: string;
  fileMeta?: {fileName?: string; fileType?: string; fileUrl?: string; localUri?: string; fileSize?: number};
};

export const getSharedItems = async (roomId: string, kind: 'media' | 'file' | 'link', page = 1) => {
  const response = await client.get(`${constants.API_BASE_URL}/chat/shared`, {params: {roomId, kind, page}});
  return response.data as {messages: SharedMessage[]; page: number; hasMore: boolean};
};

// Lấy tin nhắn cuối cùng của 1 phòng
export const getLastMessageOfRoom = async (roomId: string) => {
    const res = await client.get(`${constants.API_BASE_URL}/chat/get`, {
    params: {
      roomId,
      limit: 1,
      page: 1
    }
  });
  // Trả về tin nhắn đầu tiên nếu có, hoặc null
  return res.data?.messages?.[0] ?? null;
};
export const getLastMessagesOfRooms = async (roomIds: string[]) => {
  const results = await Promise.all(
    roomIds.map(async roomId => {
      const msg = await getLastMessageOfRoom(roomId);
      return { roomId, lastMessage: msg };
    })
  );
  return results; 
};

export const TaoNhomChat = async (groupName: string, userIds: string[], groupImage?: string) => {
  return new Promise((resolve, reject) => {
    if (socket?.connected) {
      const payload: { tenNhom: string; thanhVien: string[]; groupImage?: string } = { tenNhom: groupName, thanhVien: userIds };
      if (groupImage) {
        payload.groupImage = groupImage; // Thêm groupImage nếu có
      }
      socket.timeout(15000).emit("createGroup", payload, (error: Error | null, response: any) => {
        if (error) {
          reject('Không nhận được phản hồi. Kiểm tra kết nối và danh sách nhóm trước khi thử lại.');
          return;
        }
        if (response && response.success) {
          resolve(response.room);
        } else {
          reject(response?.error || "Failed to create group");
        }
      });
    } else {
      reject("Mất kết nối. Vui lòng kết nối lại rồi thử lại.");
    }
  });
};

export const LayNhomChat = async () => {
  try {
    const res = await client.get(`${constants.API_URLS.GETMYROOMS}`);
    return res.data;
  } catch (error) {
    throw error;
  }
};

export const LayTatCaPhongChat = async () => {
  const res = await client.get(constants.API_URLS.GETALLROOMS);
  return res.data;
};

const messageEndpoint = `${constants.API_BASE_URL}/chat/message`;
const chatEndpoint = `${constants.API_BASE_URL}/chat`;

export const editChatMessage = async (messageId: string, content: string) => {
  const response = await client.put(`${messageEndpoint}/${encodeURIComponent(messageId)}`, {content});
  return response.data?.message;
};

export const deleteChatMessage = async (messageId: string, scope: 'me' | 'everyone') => {
  const response = await client.delete(`${messageEndpoint}/${encodeURIComponent(messageId)}`, {data: {scope}});
  return response.data;
};

export const toggleChatMessageReaction = async (messageId: string, emoji: string) => {
  const response = await client.post(`${messageEndpoint}/${encodeURIComponent(messageId)}/reactions`, {emoji});
  return response.data;
};

export const forwardChatMessage = async (messageId: string, targetRoomId: string) => {
  const response = await client.post(`${messageEndpoint}/${encodeURIComponent(messageId)}/forward`, {targetRoomId});
  return response.data?.message;
};

export type GroupPinnedMessage = {
  _id: string;
  userId: string;
  content?: string;
  type?: string;
  timestamp?: string;
  fileMeta?: {fileName?: string; fileUrl?: string; fileType?: string};
  location?: {latitude?: number; longitude?: number; status?: string};
};

export const getGroupPins = async (roomId: string) => {
  const response = await client.get(`${chatEndpoint}/group/${encodeURIComponent(roomId)}/pins`);
  return response.data as {roomId: string; messages: GroupPinnedMessage[]};
};

export const pinGroupMessage = async (roomId: string, messageId: string) => {
  const response = await client.post(`${chatEndpoint}/group/${encodeURIComponent(roomId)}/pins/${encodeURIComponent(messageId)}`);
  return response.data as {success: boolean; messages: GroupPinnedMessage[]};
};

export const unpinGroupMessage = async (roomId: string, messageId: string) => {
  const response = await client.delete(`${chatEndpoint}/group/${encodeURIComponent(roomId)}/pins/${encodeURIComponent(messageId)}`);
  return response.data as {success: boolean; messages: GroupPinnedMessage[]};
};

export type GroupPollOption = {id: string; text: string; voteCount: number | null; voters?: Array<{username: string; name: string; avatar?: string | null}>};
export type GroupPoll = {
  question: string;
  options: GroupPollOption[];
  allowMultiple: boolean;
  allowAddOptions: boolean;
  anonymous: boolean;
  hideResultsUntilVote: boolean;
  resultsHidden: boolean;
  selectedOptionIds: string[];
  endAt?: string | null;
  closedAt?: string | null;
  createdBy: string;
  isOpen: boolean;
};

const getPollRoute = (roomId: string, messageId: string) => `${chatEndpoint}/group/${encodeURIComponent(roomId)}/polls/${encodeURIComponent(messageId)}`;
export const getGroupPoll = async (roomId: string, messageId: string) => {
  const response = await client.get<{poll: GroupPoll}>(getPollRoute(roomId, messageId));
  return response.data.poll;
};
export const voteGroupPoll = async (roomId: string, messageId: string, optionIds: string[]) => {
  const response = await client.post<{poll: GroupPoll}>(`${getPollRoute(roomId, messageId)}/votes`, {optionIds});
  return response.data.poll;
};
export const addGroupPollOption = async (roomId: string, messageId: string, text: string) => {
  const response = await client.post<{poll: GroupPoll}>(`${getPollRoute(roomId, messageId)}/options`, {text});
  return response.data.poll;
};
export const closeGroupPoll = async (roomId: string, messageId: string) => {
  const response = await client.post<{poll: GroupPoll}>(`${getPollRoute(roomId, messageId)}/close`);
  return response.data.poll;
};

export type GroupMember = {username: string; name: string; avatar?: string | null; online: boolean; isOwner: boolean; isAdmin: boolean};
export type GroupMembersResponse = {roomId: string; name: string; groupImage?: string | null; createdBy: string; canManage: boolean; members: GroupMember[]};

const roomEndpoint = `${constants.API_BASE_URL}/room`;
export const getGroupMembers = async (roomId: string) => {
  const response = await client.get<GroupMembersResponse>(`${roomEndpoint}/${encodeURIComponent(roomId)}/members`);
  return response.data;
};

export const addGroupMembers = async (roomId: string, userIds: string[]) => {
  const response = await client.post(`${roomEndpoint}/${encodeURIComponent(roomId)}/members`, {userIds});
  return response.data;
};

export const removeGroupMember = async (roomId: string, memberId: string) => {
  const response = await client.delete(`${roomEndpoint}/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}`);
  return response.data;
};

export const transferGroupOwnership = async (roomId: string, newOwnerId: string) => {
  const response = await client.post(`${roomEndpoint}/${encodeURIComponent(roomId)}/transfer-ownership`, {newOwnerId});
  return response.data as {roomId: string; createdBy: string; previousOwner: string};
};

export const leaveGroup = async (roomId: string, newOwnerId?: string) => {
  const response = await client.delete(`${roomEndpoint}/${encodeURIComponent(roomId)}/leave`, {
    ...(newOwnerId ? {data: {newOwnerId}} : {}),
  });
  return response.data as {roomId: string; name: string; createdBy?: string};
};

export const deleteRoom = async (roomId: string) => {
  const response = await client.delete(`${roomEndpoint}/delete-room/${encodeURIComponent(roomId)}`);
  return response.data;
};

export type ChatPreference = {roomId: string; isMuted: boolean; mutedUntil: string | null; isPinned: boolean; isHidden: boolean};
const hiddenChatEndpoint = `${constants.API_BASE_URL}/user/hidden-chat`;

export const getHiddenChatPinStatus = async () => {
  const response = await client.get<{hasPin: boolean}>(`${hiddenChatEndpoint}/pin`);
  return response.data;
};

export const setHiddenChatPin = async (pin: string, currentPin?: string) => {
  const response = await client.put<{success: boolean; hasPin: boolean}>(`${hiddenChatEndpoint}/pin`, {pin, currentPin});
  return response.data;
};

export const unlockHiddenChats = async (pin: string) => {
  const response = await client.post<{accessToken: string; expiresIn: number}>(`${hiddenChatEndpoint}/unlock`, {pin});
  return response.data;
};

export const cancelHiddenChats = async (pin: string) => {
  const response = await client.post<{success: boolean; hasPin: boolean; restoredCount: number}>(`${hiddenChatEndpoint}/cancel`, {pin});
  return response.data;
};

export const getHiddenRoomIds = async () => {
  const response = await client.get<{roomIds: string[]}>(`${roomEndpoint}/hidden-ids`);
  return response.data.roomIds || [];
};

export const getHiddenRooms = async (accessToken: string) => {
  const response = await client.get<any[]>(`${roomEndpoint}/hidden`, {headers: {'X-Hidden-Chat-Token': accessToken}});
  return response.data;
};

export const updateLiveLocation = async (roomId: string, sessionId: string, location: {latitude: number; longitude: number; accuracy?: number}) => {
  const response = await client.put(`${constants.API_BASE_URL}/chat/live-location/${encodeURIComponent(sessionId)}`, location, {params: {roomId}});
  return response.data;
};

export const stopLiveLocation = async (roomId: string, sessionId: string) => {
  const response = await client.post(`${constants.API_BASE_URL}/chat/live-location/${encodeURIComponent(sessionId)}/stop`, undefined, {params: {roomId}});
  return response.data as {success: boolean; isLive: boolean; status: 'stopped' | 'expired'};
};

export const setRoomHidden = async (roomId: string, hidden: boolean) => {
  const response = await client.put<ChatPreference>(`${roomEndpoint}/${encodeURIComponent(roomId)}/hidden`, {hidden});
  return response.data;
};

export const getRoomPreference = async (roomId: string) => {
  const response = await client.get<ChatPreference>(`${roomEndpoint}/${encodeURIComponent(roomId)}/preference`);
  return response.data;
};

export const setRoomMute = async (roomId: string, muted: boolean, mutedUntil: string | null = null) => {
  const response = await client.put(`${roomEndpoint}/${encodeURIComponent(roomId)}/mute`, {muted, mutedUntil});
  return response.data as ChatPreference;
};

export const setRoomPin = async (roomId: string, pinned: boolean) => {
  const response = await client.put<ChatPreference>(`${roomEndpoint}/${encodeURIComponent(roomId)}/pin`, {pinned});
  return response.data;
};

export const renameGroup = async (roomId: string, name: string) => {
  const response = await client.patch(`${roomEndpoint}/${encodeURIComponent(roomId)}`, {name});
  return response.data as {roomId: string; name: string};
};

export const setGroupImage = async (roomId: string, image: string | null) => {
  const response = await client.put(`${roomEndpoint}/${encodeURIComponent(roomId)}/image`, {image});
  return response.data as {roomId: string; groupImage: string | null};
};

export const setGroupAdmin = async (roomId: string, memberId: string, isAdmin: boolean) => {
  const response = await client.put(`${roomEndpoint}/${encodeURIComponent(roomId)}/admins/${encodeURIComponent(memberId)}`, {isAdmin});
  return response.data as {roomId: string; memberId: string; isAdmin: boolean; admins: string[]};
};

export type CallHistoryEntry = {
  id: string;
  roomId: string;
  roomType: 'one-to-one' | 'group';
  title: string;
  peerId: string | null;
  avatar?: string;
  participantNames: string[];
  caller: string;
  status: string;
  callType: 'audio' | 'video';
  startedAt: string;
  duration: number;
};

export const getCallHistory = async () => {
  const response = await client.get<{calls: CallHistoryEntry[]}>(`${constants.API_BASE_URL}/calls/history`, {params: {limit: 100}});
  return response.data.calls || [];
};

