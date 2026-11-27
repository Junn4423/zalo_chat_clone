import mongoose from 'mongoose';
const connectDB = async () => {
  try {
    // Lấy URI từ biến môi trường
    const mongoURI = process.env.MONGODB_URI;

    if (!mongoURI) { // Kiểm tra biến môi trường
      throw new Error('MONGODB_URI is not defined in .env');
    }

    // Kết nối MongoDB
    await mongoose.connect(mongoURI, { 
       maxPoolSize: 100, // Tăng số kết nối
    });

    // console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Xử lý sự kiện ngắt kết nối
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Xử lý sự kiện lỗi
mongoose.connection.on('error', (error) => {
  console.error('MongoDB error:', error.message);
});

export default connectDB;