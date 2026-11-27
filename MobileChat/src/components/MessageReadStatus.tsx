import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { getMessageReadStatus, onAllMessagesRead, onMessageRead, onMessageReadStatus, offAllMessagesRead, offMessageRead, offMessageReadStatus } from '../utils/socket';

interface MessageReadStatusProps {
  messageId: string;
  roomId: string;
  isGroup: boolean;
  isMine: boolean;
  currentUserId: string;
}

export default function MessageReadStatus({ messageId, roomId, isGroup, isMine, currentUserId }: MessageReadStatusProps) {
  const [readBy, setReadBy] = useState<string[]>([]);
  const [isRead, setIsRead] = useState(false);

  useEffect(() => {
    if (!isMine || !/^[a-f0-9]{24}$/i.test(messageId)) return; // Chỉ truy vấn tin nhắn đã lưu của mình

    const handleReadStatus = (data: { messageId: string; readBy: string[]; isRead: boolean }) => {
      if (data.messageId === messageId) {
        setReadBy(data.readBy || []);
        setIsRead(data.isRead || false);
      }
    };

    const handleMessageRead = (data: { messageId: string; readBy?: string }) => {
      if (data.messageId !== messageId || !data.readBy || String(data.readBy) === currentUserId) return;
      const readerId = String(data.readBy);
      setReadBy((current) => current.includes(readerId) ? current : [...current, readerId]);
      setIsRead(true);
    };

    const handleAllMessagesRead = (data: { roomId: string; readBy?: string }) => {
      if (String(data.roomId) !== String(roomId) || !data.readBy || String(data.readBy) === currentUserId) return;
      const readerId = String(data.readBy);
      setReadBy((current) => current.includes(readerId) ? current : [...current, readerId]);
      setIsRead(true);
    };

    onMessageReadStatus(handleReadStatus);
    onMessageRead(handleMessageRead);
    onAllMessagesRead(handleAllMessagesRead);
    // Register listeners before requesting to avoid missing a fast response.
    getMessageReadStatus(messageId, roomId);

    return () => {
      offMessageRead(handleMessageRead);
      offAllMessagesRead(handleAllMessagesRead);
      offMessageReadStatus(handleReadStatus);
    };
  }, [messageId, roomId, isMine, currentUserId]);

  if (!isMine) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
      {isGroup ? (
        // Trong group: hiển thị số người đã đọc
        readBy.length > 0 ? (
          <Text style={{ fontSize: 11, color: '#007AFF' }}>
            ✓✓ {readBy.length} người đã đọc
          </Text>
        ) : (
          <Text style={{ fontSize: 11, color: '#999' }}>✓ Đã gửi</Text>
        )
      ) : (
        // Chat 1-1: hiển thị đã đọc hoặc chưa đọc
        isRead ? (
          <Text style={{ fontSize: 11, color: '#007AFF' }}>✓✓ Đã đọc</Text>
        ) : (
          <Text style={{ fontSize: 11, color: '#999' }}>✓ Đã gửi</Text>
        )
      )}
    </View>
  );
}
