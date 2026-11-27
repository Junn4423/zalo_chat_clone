import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabsParamList } from '../types/navigation';
import Icon from 'react-native-vector-icons/FontAwesome';
import UserScreen from '../screens/User/UserScreen';
import ChatStack from './ChatStack';
import {CallProvider} from '../calls/CallProvider';
import DirectoryScreen from '../screens/Directory/DirectoryScreen';
import CallsScreen from '../screens/Calls/CallsScreen';
import {getFocusedRouteNameFromRoute} from '@react-navigation/native';

type MainTabsProps = {
  onLogout: () => void;
};

const Tab = createBottomTabNavigator<MainTabsParamList>();

export default function MainTabs({ onLogout }: MainTabsProps) {
  return (
    <CallProvider><Tab.Navigator screenOptions={{tabBarActiveTintColor: '#1683ed', tabBarInactiveTintColor: '#8a939d', tabBarLabelStyle: {fontSize: 11}, tabBarStyle: {backgroundColor: '#fff', borderTopColor: '#edf0f3'}}}>
      <Tab.Screen
        name="ChatList"
        component={ChatStack}
        options={({ route }) => ({
          title: 'Tin nhắn',
          tabBarIcon: ({ color, size }) => (
            <Icon name="comments" color={color} size={size} />
          ),
          headerShown: false,
          tabBarStyle: getFocusedRouteNameFromRoute(route) && getFocusedRouteNameFromRoute(route) !== 'ChatList' ? {display: 'none'} : {backgroundColor: '#fff', borderTopColor: '#edf0f3'},
        })}
      />
      <Tab.Screen
        name="Directory"
        component={DirectoryScreen}
        options={{
          title: 'Danh bạ',
          tabBarIcon: ({ color, size }) => (
            <Icon name="address-book" color={color} size={size} />
          ),
          headerShown: false
        }}
      />
      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{
          title: 'Cuộc gọi',
          tabBarIcon: ({color, size}) => <Icon name="phone" color={color} size={size} />,
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="User"
        children={() => <UserScreen onLogout={onLogout} />}
        options={{
          title: 'Cá nhân',
          tabBarIcon: ({ color, size }) => (
            <Icon name="user" color={color} size={size} />
          ),
          headerShown: false
        }}
      />
    </Tab.Navigator></CallProvider>
  );
}
