import { Server } from "socket.io";
import { socketAuthMiddleware } from "./middleware/auth.socket.js";
import { handleConnection } from "./connection.socket.js";
import { handleRoomEvents } from "./handlers/room.socket.js";
import { handleMessageEvents } from "./handlers/message.socket.js";
import { handleCallEvents } from "./handlers/callWebRTC.socket.js";
import { handleMediasoupEvents } from "./handlers/mediasoup.socket.js";
import 'dotenv/config';
import { handleOnlineEvents } from "./handlers/online.socket.js";

let ioInstance = null; // biến global

const IP = process.env.SERVER_IP || "localhost";

export const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: ["https://login.sof.com.vn", "http://localhost", "http://127.0.0.1"],
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 500 * 1024 * 1024,
  });

  // middleware auth
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    handleConnection(socket, io);
    handleRoomEvents(socket, io);
    handleMessageEvents(socket, io);
    handleCallEvents(socket, io);
    handleMediasoupEvents(socket, io); handleOnlineEvents(socket, io);
  });

  ioInstance = io; // gán instance để dùng toàn cục
  return io;
};

// Hàm lấy io để dùng ngoài controller/service
export const getIO = () => {
  if (!ioInstance) {
    throw new Error("Socket.io chưa được khởi tạo, hãy gọi initSocket(server) trước.");
  }
  return ioInstance;
};

export default initSocket;
