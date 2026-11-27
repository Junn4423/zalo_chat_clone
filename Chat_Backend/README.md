# Chat Backend (ERP Chat Realtime) — Hướng dẫn cài đặt

Backend realtime chat chạy trên **Node.js + Express + Socket.IO**, lưu trữ dữ liệu bằng **MongoDB (Mongoose)** và dùng **MySQL** cho một số nghiệp vụ. Dự án có tích hợp **mediasoup** cho tính năng media.

## 1. Yêu cầu hệ thống

- **Node.js**
- **MongoDB**: chạy local hoặc remote (ví dụ `mongodb://127.0.0.1:27017/...`).
- **MySQL**

Lưu ý về `mediasoup`:
- `mediasoup` thường cần môi trường build native (node-gyp) tùy hệ điều hành. Nếu `npm install` báo lỗi khi cài `mediasoup`, xem mục “Troubleshooting”.

## 2. Cài đặt

Tại thư mục dự án:

```bash
npm install
```

## 3. Cấu hình môi trường (.env)

Tạo file `.env` từ mẫu:

```bash
copy .env.example .env
```

Nếu dùng macOS/Linux:

```bash
cp .env.example .env
```

Sau đó chỉnh các biến cho phù hợp:

- `SERVER_IP`: domain/IP backend dùng để cấu hình CORS (mặc định `localhost`)
- `PORT`: cổng chạy server (mặc định `5070`)
- `MONGODB_URI`: chuỗi kết nối MongoDB
- `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRES`: cấu hình JWT
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_DATABASE_DOCUMENTS`: cấu hình MySQL

## 4. Chuẩn bị database

### MongoDB
- Đảm bảo MongoDB đang chạy.

### MySQL
- Đảm bảo MySQL đang chạy và user có quyền truy cập.
- Kết nối đến database erp:
  - `MYSQL_DATABASE` (ví dụ `erp_sofv4_0`)
  - `MYSQL_DATABASE_DOCUMENTS` (ví dụ `erp_sof_documents_v4_0`)

## 5. Chạy dự án

Chế độ dev (nodemon):

```bash
npm run dev
```

Khi chạy thành công, terminal sẽ log:
- `Server is running on port <PORT>`

## 6. Kiểm tra nhanh

Gọi API root:

```bash
curl http://localhost:5070/api
```

Kết quả mong đợi:

```json
{ "message": "Welcome to ERP Chat Realtime API" }
```

## 7. CORS / Frontend không gọi được API

Hiện tại CORS được cấu hình trong `src/index.js` với `origin` là:
- `http://<SERVER_IP>`  (từ env)
- `http://localhost`

Nếu frontend của bạn chạy ở origin khác (ví dụ `http://localhost:3000`), hãy bổ sung origin đó vào `corsOptions.origin` trong `src/index.js`.

## 8. Troubleshooting

### Lỗi cài đặt `mediasoup` (native build)
Tuỳ môi trường, bạn có thể cần:
- Windows: **Visual Studio Build Tools** (C++), Python (3.x) và cấu hình build cho node-gyp.
- Linux: `python3`, `make`, `g++` (hoặc `build-essential`).

Sau khi cài đủ build tools, xoá `node_modules` rồi cài lại:

### Lỗi đường dẫn `uploads` trên Linux
Trong code đang serve static theo đường dẫn `../uploads` (chữ thường). Trên Windows không phân biệt hoa/thường nên thường không lỗi, nhưng trên Linux có thể lỗi nếu thư mục thực tế là `Uploads`.

Cách xử lý:
- Đổi tên thư mục `Uploads` -> `uploads`, hoặc
- Sửa đường dẫn static trong `src/index.js` cho khớp tên thư mục.
