import { verifyToken } from "../utils/context.js";
import { verifyHiddenChatAccessToken } from "../src/token.js";
import User from "../models/User.js";

/**
 * Middleware bảo vệ các route yêu cầu người dùng đã đăng nhập.
 *
 * @function protect
 * @middleware
 *
 * @param {Object} req - Đối tượng request từ Express.
 * @param {Object} req.cookies - Cookie của client, chứa token đăng nhập.
 * @param {Object} res - Đối tượng response từ Express.
 * @param {Function} next - Hàm tiếp theo trong chuỗi middleware.
 *
 * @description
 * - Kiểm tra sự tồn tại và hợp lệ của token trong cookie.
 * - Xác thực token và lấy `lv001` từ payload.
 * - Kiểm tra user có tồn tại trong MongoDB dựa trên `lv001`.
 * - Gán `req.userId` bằng `lv001` nếu hợp lệ.
 * - Trả về lỗi 401 nếu token không hợp lệ hoặc user không tồn tại.
 *
 * @returns {void}
 *
 * @example
 * // Sử dụng middleware để bảo vệ route
 * app.get('/api/profile', protect, getProfile);
 */
export const protect = async (req, res, next) => {
  try {
    // Debug: Log cookies và headers
    // console.log('🍪 Cookies:', req.cookies);
    // console.log('📝 Authorization header:', req.headers.authorization);
    
    // Kiểm tra token từ Authorization header hoặc cookies
    let token = req.cookies?.token;
    
    // Nếu không có token trong cookies, kiểm tra Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Bỏ "Bearer " prefix
      }
    }
    
    // Kiểm tra token tồn tại và là chuỗi
    if (!token || typeof token !== "string") {
      return res.status(401).json({
        error: "Không tìm thấy token hoặc token không hợp lệ",
      });
    }

    // Xác thực token
    const decoded = verifyToken(token);
    if (!decoded?.id) {
      return res.status(401).json({
        error: "Token không chứa thông tin người dùng hợp lệ",
      });
    }

    // Kiểm tra user tồn tại trong MongoDB
    const user = await User.findOne({ lv001: decoded.id }).lean();
    if (!user) {
      return res.status(401).json({
        error: "Người dùng không tồn tại trong hệ thống",
      });
    }

    // Gán thông tin user vào req, bao gồm role
    req.userId = decoded.id;
    req.user = { userId: decoded.id, role: user.role }; // Thêm role vào req.user
    next();
  } catch (err) {
    console.error("Auth Middleware: Lỗi xác thực token", { error: err.message });
    return res.status(401).json({
      error:
        err.name === "TokenExpiredError"
          ? "Token đã hết hạn"
          : "Token không hợp lệ",
    });
  }
};

/*
  * Middleware kiểm tra vai trò người dùng.
  * @param {string} role - Vai trò cần kiểm tra (ví dụ: 'admin').
  * @returns {Function} Middleware function.
  * @description
*/
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này' });
    }
    next();
  };
}

export function requireHiddenChatAccess(req, res, next) {
  try {
    const token = req.headers['x-hidden-chat-token'];
    if (typeof token !== 'string' || !token) {
      return res.status(423).json({error: 'Hãy mở khóa trò chuyện ẩn trước'});
    }
    const decoded = verifyHiddenChatAccessToken(token);
    if (String(decoded.id) !== String(req.userId)) {
      return res.status(403).json({error: 'Mã mở khóa không thuộc tài khoản này'});
    }
    next();
  } catch {
    return res.status(423).json({error: 'Mã mở khóa đã hết hạn hoặc không hợp lệ'});
  }
}
