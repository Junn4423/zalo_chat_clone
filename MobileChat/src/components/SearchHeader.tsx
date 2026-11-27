import React, { useState } from "react";
import { View, TextInput, TouchableOpacity,Modal, Text  } from "react-native";
import Icon from "react-native-vector-icons/FontAwesome";
import { styles } from "./css/SearchHeader.style";

import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  rightType: "chat" | "contacts" | "user";
  onRightPress?: (key?: string) => void;
  searchValue?: string;
  setSearchValue?: (text: string) => void;
};

export default function SearchHeader({
  rightType,
  onRightPress,
  searchValue = "",
  setSearchValue,
}: Props) {
  const insets = useSafeAreaInsets();
  let RightButtons = null;
  const [menuVisible, setMenuVisible] = useState(false);
  if (rightType === "chat") {
    RightButtons = (
      <View style={styles.rightGroup}>
        <TouchableOpacity accessibilityLabel="Thêm" style={styles.rightBtn} onPress={() => setMenuVisible(true)}>
          <Icon name="plus" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }
  if (rightType === "user") {
    RightButtons = (
      <TouchableOpacity style={styles.rightBtn} onPress={() => onRightPress?.("settings")}> 
        <Icon name="cog" size={24} color="#fff" />
      </TouchableOpacity>
    );
  }

  return (
    <>
      <View style={[styles.headerBase, { paddingTop: insets.top }]}> 
        <Icon name="search" size={20} color="#fff" style={{marginRight: 10}} />
        <TextInput
          style={styles.search}
          value={searchValue}
          onChangeText={(text) => {
            setSearchValue?.(text);
          }}
          placeholder="Tìm bạn bè, tin nhắn..."
          placeholderTextColor="rgba(255,255,255,0.8)"
        />
        {RightButtons}
      </View>
      {/* Popup menu khi nhấn dấu cộng */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={{ position: 'absolute', top: 60, right: 20, backgroundColor: '#fff', borderRadius: 12, padding: 12, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 8, minWidth: 180 }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }} onPress={() => { setMenuVisible(false); onRightPress && onRightPress('addFriend'); }}>
              <Icon name="user-plus" size={20} color="#2179ee" style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 16 }}>Thêm bạn</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }} onPress={() => { setMenuVisible(false); onRightPress && onRightPress('createGroup'); }}>
              <Icon name="users" size={20} color="#2179ee" style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 16 }}>Tạo nhóm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }} onPress={() => { setMenuVisible(false); onRightPress && onRightPress('hiddenChats'); }}>
              <Icon name="lock" size={18} color="#2179ee" style={{ marginRight: 14, marginLeft: 2 }} />
              <Text style={{ fontSize: 16 }}>Trò chuyện ẩn</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
