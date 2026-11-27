import jwt from "jsonwebtoken";

import dotenv from "dotenv";
dotenv.config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET || "keyOfsof.vn";

export const generateToken = (userId) => {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "7d" });
};

export const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
};

export const generateHiddenChatAccessToken = (userId) => {
    return jwt.sign({ id: userId, scope: "hidden_chat" }, JWT_SECRET, { expiresIn: "10m" });
};

export const verifyHiddenChatAccessToken = (token) => {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.scope !== "hidden_chat" || !decoded.id) {
        throw new Error("Token mở trò chuyện ẩn không hợp lệ");
    }
    return decoded;
};
