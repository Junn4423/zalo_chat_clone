import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET || "keyOfsof.vn";

export const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication error: No token"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    socket.userId = decoded.id;
    socket.context = {
      userId: decoded.id,
      token,
    };
    // console.log(`✅ Authenticated: ${decoded.id}`);
    next();
  } catch (err) {
    console.error("❌ Invalid token:", err.message);
    next(new Error("Authentication error: Invalid token"));
  }
};


