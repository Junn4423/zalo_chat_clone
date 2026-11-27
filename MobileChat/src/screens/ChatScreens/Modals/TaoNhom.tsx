import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, Image, ScrollView, Alert } from "react-native";
import Icon from "react-native-vector-icons/FontAwesome";
import { styles } from "../css/TaoNhom.style";
import { listFriends } from "../../../services/FriendsAPI/api";
import { User } from "../../../types/User";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TaoNhomChat } from "../../../services/ChatAPI/api";
import { launchImageLibrary } from 'react-native-image-picker'; // Thêm import cho chọn ảnh
import {useAuthStore} from '../../../auth/store/login.store';

export default function TaoNhom({ navigation }: { navigation: any }) {
	const [groupName, setGroupName] = useState("");
	const [search, setSearch] = useState("");
	const [users, setUsers] = useState<User[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [groupImage, setGroupImage] = useState<string>(''); // Thêm state cho hình ảnh base64
	const username = useAuthStore(state => state.auth?.user?.username);
	const [creating, setCreating] = useState(false);
	const [loadingFriends, setLoadingFriends] = useState(true);

	const insets = useSafeAreaInsets();
	useEffect(() => {
		let mounted = true;
		const fetchUsers = async () => {
			try {
				const data = await listFriends();
				if (!mounted) return;
				const friends = (data.friends || []).map(({user}) => ({
					maNhanVien: user.username,
					tenNhanVien: user.name || user.username,
					maPhongBan: '',
					idObject: user.username,
					userId: user.username,
					avatar: user.avatar,
				})).filter(friend => friend.userId !== username);
				setUsers(friends);
			} catch {
				if (mounted) Alert.alert('Không tải được danh sách bạn bè', 'Kiểm tra kết nối rồi thử mở lại tạo nhóm.');
			} finally {
				if (mounted) setLoadingFriends(false);
			}
		};
		fetchUsers();
		return () => { mounted = false; };
	}, [username]);

	const filteredUsers = users.filter(u => u.userId !== username && (
		(u.tenNhanVien || '').toLowerCase().includes(search.toLowerCase()) ||
		(u.userId && u.userId.toLowerCase().includes(search.toLowerCase())))
	);

	const handleSelect = (id: string) => {
		setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
	};

	// Hàm chọn ảnh từ thư viện
	const selectImage = () => {
		launchImageLibrary({ mediaType: 'photo', includeBase64: true }, (response) => {
			if (response.didCancel) return;
			if (response.errorMessage) {
				Alert.alert('Lỗi', response.errorMessage);
				return;
			}
			if (response.assets && response.assets[0].base64) {
				setGroupImage(`data:${response.assets[0].type || 'image/jpeg'};base64,${response.assets[0].base64}`);
			}
		});
	};

	const handleTaoNhom = () => {
		if (creating) return;
		if (groupName.trim() && selected.length > 1) {
			setCreating(true);
			TaoNhomChat(groupName.trim(), selected, groupImage || undefined)
				.then(() => {
					navigation.navigate('ChatList', { reload: true });
				})
				.catch(error => {
					console.error("Error creating group:", error);
					Alert.alert('Lỗi', typeof error === 'string' ? error : 'Không thể tạo nhóm. Vui lòng thử lại.');
				}).finally(() => setCreating(false));
		} else {
			Alert.alert('Lỗi', 'Vui lòng nhập tên nhóm và chọn ít nhất 2 thành viên.');
		}
	};

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* Header */}
			<View style={styles.header}>
				<TouchableOpacity onPress={() => navigation.goBack()}>
					<Icon name="close" size={28} color="#222" />
				</TouchableOpacity>
				<Text style={styles.headerTitle}>Nhóm mới</Text>
				<Text style={styles.headerCount}>Đã chọn: {selected.length}</Text>
			</View>
			{/* Đặt tên nhóm + ảnh */}
			<View style={styles.groupInfo}>
				<TouchableOpacity style={styles.groupAvatar} onPress={selectImage}>
					{groupImage ? (
						<Image source={{ uri: groupImage }} style={styles.groupAvatar} />
					) : (
						<Icon name="camera" size={28} color="#888" />
					)}
				</TouchableOpacity>
				<TextInput
					style={styles.groupNameInput}
					placeholder="Đặt tên nhóm"
					value={groupName}
					onChangeText={setGroupName}
				/>
			</View>
			{/* Tìm kiếm */}
			<View style={styles.searchWrap}>
				<Icon name="search" size={20} color="#888" style={{ marginRight: 8 }} />
				<TextInput
					style={styles.searchInput}
					placeholder="Tìm tên hoặc số điện thoại"
					value={search}
					onChangeText={setSearch}
				/>
			</View>
			{/* Danh sách người dùng */}
			<FlatList
				data={filteredUsers}
				keyExtractor={item => item.userId}
				ListEmptyComponent={(
					<Text style={{padding: 24, textAlign: 'center', color: '#7B8794'}}>
						{loadingFriends ? 'Đang tải danh sách bạn bè…' : users.length === 0 ? 'Bạn chưa có bạn bè. Hãy kết bạn trước khi tạo nhóm.' : 'Không tìm thấy bạn bè phù hợp.'}
					</Text>
				)}
				renderItem={({ item }) => (
					<TouchableOpacity style={styles.userRow} onPress={() => handleSelect(item.userId)}>
						<View style={styles.userCheckWrap}>
							<View style={[styles.userCheck, selected.includes(item.userId) && styles.userCheckSelected]} />
						</View>
						<Image
							source={{
								uri:
									item.avatar && item.avatar.startsWith('data:image')
										? item.avatar
										: item.avatar
											? `data:image/png;base64,${item.avatar}`
											: 'https://i.pravatar.cc/150?u=' + item.userId
							}}
							style={styles.userAvatar}
						/>
						<View style={styles.userInfo}>
							<Text style={styles.userName}>{item.tenNhanVien}</Text>
						</View>
					</TouchableOpacity>
				)}
				style={{ flex: 1 }}
			/>
			{/* Nút tạo nhóm */}
			<TouchableOpacity style={[styles.createBtn, (loadingFriends || creating || selected.length < 2 || !groupName.trim()) && {opacity: 0.5}]} disabled={loadingFriends || creating || selected.length < 2 || !groupName.trim()} onPress={handleTaoNhom}>
				<Text style={styles.createBtnText}>{creating ? 'Đang tạo nhóm...' : 'Tạo nhóm'}</Text>
			</TouchableOpacity>
		</View>
	);
}

// Hàm chuyển đổi thời gian sang "x giờ trước"
function getTimeAgo(dateStr: string) {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffH = Math.floor(diffMs / (1000 * 60 * 60));
	if (diffH < 24) return `${diffH} giờ trước`;
	const diffD = Math.floor(diffH / 24);
	return `${diffD} ngày trước`;
}
