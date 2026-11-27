import client from '../client';
import constants from '../../contents/Api_URL';

export type FriendUser = {username: string; name: string; avatar?: string; online: boolean};
export type FriendEntry = {id: string; user: FriendUser; updatedAt: string};
export type DiscoverUser = FriendUser & {relationship: 'none' | 'incoming' | 'outgoing' | 'friends'; relationshipId: string | null};
export type FriendsResponse = {friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[]};

const base = `${constants.API_BASE_URL}/friends`;
export const listFriends = async () => (await client.get<FriendsResponse>(base)).data;
export const discoverUsers = async (q: string) => (await client.get<{users: DiscoverUser[]}>(`${base}/discover`, {params: {q}})).data.users;
export const requestFriend = async (username: string) => client.post(`${base}/requests`, {username});
export const acceptFriend = async (id: string) => client.post(`${base}/requests/${id}/accept`);
export const deleteRequest = async (id: string) => client.delete(`${base}/requests/${id}`);
export const removeFriend = async (id: string) => client.delete(`${base}/${id}`);
