import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#f7f7f7',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#222',
    marginLeft: 16,
  },
  headerCount: {
    fontSize: 16,
    color: '#888',
  },
  groupInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  groupAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eee',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    overflow: 'hidden', // Thêm để ảnh không tràn
  },
  groupNameInput: {
    flex: 1,
    fontSize: 18,
    borderBottomWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    backgroundColor: '#f7f7f7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#f7f7f7',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderColor: '#2179ee',
  },
  tabText: {
    fontSize: 16,
    color: '#888',
  },
  tabTextActive: {
    color: '#2179ee',
    fontWeight: 'bold',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
  },
  userCheckWrap: {
    marginRight: 12,
  },
  userCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  userCheckSelected: {
    borderColor: '#2179ee',
    backgroundColor: '#2179ee',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eee',
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    color: '#222',
    fontWeight: '500',
  },
  userLastActive: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  createBtn: {
    margin: 16,
    backgroundColor: '#2179ee',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    opacity: 1,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
