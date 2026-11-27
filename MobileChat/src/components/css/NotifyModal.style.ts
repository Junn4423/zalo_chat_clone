import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    minWidth: 260,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  error: {
    borderLeftWidth: 6,
    borderLeftColor: "#ff4d4f",
  },
  success: {
    borderLeftWidth: 6,
    borderLeftColor: "#52c41a",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#222",
  },
  message: {
    fontSize: 15,
    color: "#444",
    marginBottom: 18,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#2179ee",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
});