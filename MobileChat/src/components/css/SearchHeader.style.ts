import { StyleSheet, Platform, StatusBar } from "react-native";

export const styles = StyleSheet.create({
  headerBase: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#1683ed",
    elevation: 0,
  },
  search: {
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 2,
    paddingVertical: 7,
    fontSize: 15,
    color: "#fff",
    marginRight: 10,
  },
  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  rightBtn: {
    marginLeft: 8,
  },
});
