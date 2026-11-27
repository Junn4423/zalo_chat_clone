import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import ChatListScreen from "../screens/ChatScreens/ChatListScreen";
import ChatDetailScreen from "../screens/ChatScreens/ChatDetailScreen";
import { MainTabsParamList } from "../types/navigation";
import Icon from "react-native-vector-icons/FontAwesome";
import { Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import TaoNhom from "../screens/ChatScreens/Modals/TaoNhom";
import SearchMessagesScreen from '../screens/ChatScreens/SearchMessagesScreen';
import ChatInfoScreen from '../screens/ChatScreens/ChatInfoScreen';
import SharedItemsScreen from '../screens/ChatScreens/SharedItemsScreen';
import ChatExportScreen from '../screens/ChatScreens/ChatExportScreen';
import HiddenChatsScreen from '../screens/ChatScreens/HiddenChatsScreen';
import {useStartCall} from '../calls/CallProvider';

const Stack = createStackNavigator<MainTabsParamList>();

export default function ChatStack() {
  const startCall = useStartCall();
  const { width } = useWindowDimensions();
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ChatDetail"
        component={ChatDetailScreen}
        options={({ route, navigation }) => ({
          headerStyle: {backgroundColor: '#1683ed', elevation: 0, shadowOpacity: 0},
          headerTitle: () => (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ maxWidth: Math.max(64, width - 210), color: '#fff', fontSize: 17, fontWeight: '600' }}
            >
              {route.params?.chatName || (route.params?.chatType === "group" ? "Nhóm" : "Bạn bè")}
            </Text>
          ),
          headerTitleContainerStyle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          headerRightContainerStyle: { flexShrink: 0, paddingRight: 4 },
          headerLeft: () => (
            <TouchableOpacity style={{ width: 38, marginLeft: 8, alignItems: 'center' }} onPress={() => navigation.goBack()}>
              <Icon name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {/* Gọi audio */}
              <TouchableOpacity
                style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  startCall(route.params.chatId, route.params.chatName || 'Cuộc trò chuyện', false, route.params.chatType);
                }}
              >
                <Icon name="phone" size={22} color="#fff" />
              </TouchableOpacity>
              {/* Gọi video */}
              <TouchableOpacity
                style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  startCall(route.params.chatId, route.params.chatName || 'Cuộc trò chuyện', true, route.params.chatType);
                }}
              >
                <Icon name="video-camera" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel="Tìm tin nhắn" style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }} onPress={() => navigation.navigate('SearchMessages', {chatId: route.params.chatId, chatName: route.params.chatName})}>
                <Icon name="search" size={21} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel="Tùy chọn cuộc trò chuyện" style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }} onPress={() => navigation.navigate('ChatInfo', {chatId: route.params.chatId, chatName: route.params.chatName, chatType: route.params.chatType})}>
                <Icon name="bars" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          ),
        })}
      />
      <Stack.Screen name="SearchMessages" component={SearchMessagesScreen} options={{title: 'Tìm tin nhắn'}} />
      <Stack.Screen name="ChatInfo" component={ChatInfoScreen} options={{title: 'Tùy chọn'}} />
      <Stack.Screen name="SharedItems" component={SharedItemsScreen} options={{title: 'Ảnh, file, link'}} />
      <Stack.Screen name="ChatExport" component={ChatExportScreen} options={{title: 'Xuất lịch sử'}} />
      <Stack.Screen name="HiddenChats" component={HiddenChatsScreen} options={{title: 'Trò chuyện ẩn'}} />
      <Stack.Screen name="TaoNhom" component={TaoNhom} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
