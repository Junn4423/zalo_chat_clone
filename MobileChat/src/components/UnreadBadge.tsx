import React from 'react';
import { View, Text } from 'react-native';
import { useUnreadStore } from '../store/unreadStore';

interface UnreadBadgeProps {
  style?: any;
  textStyle?: any;
}

export default function UnreadBadge({ style, textStyle }: UnreadBadgeProps) {
  const totalUnread = useUnreadStore(state => state.getTotalUnreadCount());

  if (totalUnread === 0) return null;

  return (
    <View style={[
      {
        backgroundColor: '#ff4444',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'absolute',
        top: -5,
        right: -5,
      },
      style
    ]}>
      <Text style={[
        {
          color: '#fff',
          fontSize: 12,
          fontWeight: 'bold',
          paddingHorizontal: 4,
        },
        textStyle
      ]}>
        {totalUnread > 99 ? '99+' : totalUnread}
      </Text>
    </View>
  );
}
