import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Tạo pool cho database chính
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectionLimit: 10, // Số lượng kết nối tối đa trong pool
  queueLimit: 0, // Không giới hạn số lượng yêu cầu xếp hàng
});

// Tạo pool riêng cho database documents (nếu cần)
const poolDocuments = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE_DOCUMENTS,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

poolDocuments.on('error', (err) => {
  console.error('MySQL documents pool error:', err);
});

// Hàm trả về pool phù hợp dựa trên isDoc
const connectMySQL = async (isDoc) => {
  try {
    const selectedPool = isDoc ? poolDocuments : pool;
    // Lấy một kết nối từ pool
    const connection = await selectedPool.getConnection();
    // console.log('MySQL connection obtained from pool');
    return connection;
  } catch (error) {
    console.error('MySQL connection error:', error.message);
    throw error; // Ném lỗi để xử lý ở nơi gọi
  }
};

export default connectMySQL;

// Xuất pool để sử dụng ở nơi khác nếu cần
export { pool, poolDocuments };