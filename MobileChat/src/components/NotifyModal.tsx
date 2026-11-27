import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import {styles} from './css/NotifyModal.style';
interface NotifyProps {
  visible: boolean;
  type?: "error" | "success" | "info";
  title?: string;
  message: string;
  onClose: () => void;
}

export default function NotifyModal({ visible, type = "info", title, message, onClose }: NotifyProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.container, type === "error" && styles.error, type === "success" && styles.success]}>
          {title && <Text style={styles.title}>{title}</Text>}
          <Text style={styles.message}>{message}</Text>
          <TouchableOpacity style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Đóng</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}


