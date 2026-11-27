import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  item: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
  },
  lastMessage: {
    fontSize: 14,
    color: "#7c8792",
    marginTop: 3,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: "bold",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#f2f2f2",
    color: "#2179ee",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#e9edf1",
    marginLeft: 78,
    marginRight: 14,
  },
  activeNowSection: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8edf2',
    paddingTop: 13,
    paddingBottom: 11,
  },
  activeNowHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 17,
    marginBottom: 10,
  },
  activeNowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeNowPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#21b26b',
    marginRight: 8,
  },
  activeNowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#24313c',
  },
  activeNowCount: {
    color: '#7c8792',
    fontSize: 12,
    marginLeft: 6,
  },
  activeNowSeeAll: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1877e8',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  activeNowScroller: {
    paddingHorizontal: 12,
  },
  activeNowContact: {
    width: 78,
    alignItems: 'center',
  },
  createGroupQuick: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#eef5ff',
    borderWidth: 1,
    borderColor: '#d9e8fc',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  createGroupQuickPlus: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#1877e8',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeNowName: {
    width: 72,
    marginTop: 5,
    textAlign: 'center',
    color: '#586673',
    fontSize: 11,
  },
  lastMsgTime: {
    color: "#888",
    fontSize: 12,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSpaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarBox: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#eee',
    marginRight: 13,
    overflow: 'visible', // Thay đổi từ 'hidden' thành 'visible' để online indicator hiển thị
    position: 'relative', // Thêm position relative
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  avatarCompact: {
    marginRight: 0,
  },
  unreadBadge: {
    backgroundColor: '#ff4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  // Styles cho tin nhắn chưa đọc
  itemUnread: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: '#f6faff',
  },
  nameUnread: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2", // Tên màu xanh đậm
  },
  lastMessageUnread: {
    fontSize: 14,
    color: "#424242", // Text đậm hơn
    marginTop: 4,
    fontWeight: "500",
  },
  // Hiệu ứng shadow cho tin nhắn chưa đọc
  itemUnreadShadow: {
    elevation: 0,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0f3',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    marginHorizontal: 3,
    borderRadius: 18,
    backgroundColor: '#f2f4f6',
  },
  activeTab: {
    backgroundColor: '#e7f1ff',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#1877e8',
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // Thêm zIndex cao
    borderWidth: 2, // Thêm viền trắng để tách biệt với avatar
    borderColor: '#fff',
  },
  onlineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
  },
});
