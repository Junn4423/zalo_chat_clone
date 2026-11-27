import { AsyncLocalStorage } from 'async_hooks';
import jwt from 'jsonwebtoken';

const asyncLocalStorage = new AsyncLocalStorage();

export const setContext = (context) => {
  if (!context || !context.token || !context.userId) {
    console.error('Context Utility: Attempt to set invalid context', { context });
    throw new Error('Invalid context: Token và userId là bắt buộc');
  }
  asyncLocalStorage.run(context, () => {
    console.debug(`Context Utility: Context set for user ${context.userId}`);
  });
};

export const getContext = () => {
  const context = asyncLocalStorage.getStore() || {};
  if (!context.token || !context.userId) {
    console.warn('Context Utility: Missing token or userId in context', { context });
  }
  return context;
};

export const runWithContext = (context, callback) => {
  return asyncLocalStorage.run(context, callback);
};

export const verifyToken = (token) => {
  try {
    const secret = process.env.JWT_SECRET || "keyOfsof.vn";
    const decoded = jwt.verify(token, secret);

    if (!decoded.id) {
      throw new Error('Token không chứa id');
    }
    return decoded;
  } catch (error) {
    throw new Error(`Lỗi xác thực token: ${error.message}`);
  }
};