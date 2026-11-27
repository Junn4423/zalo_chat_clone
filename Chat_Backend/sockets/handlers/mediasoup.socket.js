import mediasoup from 'mediasoup';
import { runWithContext } from "../../utils/context.js";
import Room from "../../models/Room.js";
import User from "../../models/User.js";
import MediaSession from "../../models/MediaSession.js";
import {assertHiddenChatRoomAccess} from '../../services/hiddenChatAccess.js';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.MEDIASOUP_DEBUG = '*';
process.env.DEBUG = 'mediasoup:*';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đối tượng MediaSoup
let worker;
const roomState = new Map(); // Lưu trữ thông tin router và peers theo phòng
const peerState = new Map(); // Lưu trữ thông tin peers theo socket id

// Cấu hình MediaSoup
const mediasoupConfig = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'debug',
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1
        }
      }
    ]
  },
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null } // Thay bằng IP public trong môi trường production
    ],
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144
  }
};

// Khởi tạo worker MediaSoup
async function initializeMediasoupWorker() {
  try {
    worker = await mediasoup.createWorker(mediasoupConfig.worker);
    
    worker.on('died', () => {
      console.error('MediaSoup worker đã dừng hoạt động, khởi động lại...');
      setTimeout(() => initializeMediasoupWorker(), 2000);
    });
    
    console.log('MediaSoup worker đã khởi tạo thành công');
    return worker;
  } catch (error) {
    console.error('Không thể khởi tạo MediaSoup worker:', error);
    throw error;
  }
}

// Tạo router cho phòng
async function createRoomRouter(roomId, options = {}) {
  if (roomState.has(roomId)) {
    return roomState.get(roomId).router;
  }
  
  // Kết hợp cấu hình mặc định với tùy chọn
  const routerOptions = {
    ...mediasoupConfig.router,
    ...(options.routerOptions || {})
  };
  
  const router = await worker.createRouter(routerOptions);
  
  // Lưu thông tin phòng
  roomState.set(roomId, {
    router,
    peers: new Map(),
    createdAt: new Date(),
    options: options, // Lưu các tùy chọn bổ sung
    sessionId: null
  });

  // Tạo hoặc lấy MediaSession tương ứng trong MongoDB
  try {
    let session = await MediaSession.findOne({ roomId, active: true });
    if (!session) {
      session = await MediaSession.create({
        roomId,
        startedAt: new Date(),
        active: true,
        participants: [],
        metadata: options.metadata || {},
        config: options.config || {}
      });
      console.log(`[MediaSoup] Tạo MediaSession mới cho phòng ${roomId} (id=${session._id})`);
    } else {
      console.log(`[MediaSoup] Tìm thấy MediaSession đang hoạt động cho phòng ${roomId} (id=${session._id})`);
    }
    // Lưu sessionId vào trạng thái phòng
    const roomRec = roomState.get(roomId);
    if (roomRec) roomRec.sessionId = session._id.toString();
  } catch (err) {
    console.error(`[MediaSoup] Không thể tạo/cập nhật MediaSession: ${err?.message || err}`);
  }

  console.log(`Đã tạo router cho phòng ${roomId}`);
  return router;
}

// Xử lý khi người dùng tham gia phòng
async function handleJoinRoom(socket, io, { roomId, rtpCapabilities, options = {}, hiddenChatAccessToken }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }

    // Kiểm tra phòng có tồn tại không
    const roomDoc = await Room.findById(roomId);
    if (!roomDoc) {
      throw new Error(`Phòng ${roomId} không tồn tại`);
    }
    
    // Kiểm tra user có là thành viên của phòng không
    if (!roomDoc.participants.includes(context.userId)) {
      throw new Error("Bạn không phải là thành viên của phòng này");
    }
    
    // Lấy thông tin người dùng
    await assertHiddenChatRoomAccess({userId: context.userId, roomId, token: hiddenChatAccessToken});
    const user = await User.findOne({ lv001: context.userId });
    if (!user) {
      throw new Error("Không tìm thấy thông tin người dùng");
    }

    // Tạo hoặc lấy router cho phòng
    if (!worker) {
      await initializeMediasoupWorker();
    }
    const router = await createRoomRouter(roomId, options);
    
    // Lưu thông tin người dùng
    const peerInfo = {
      id: socket.id,
      userId: context.userId,
      name: user.name,
      roomId,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      rtpCapabilities,
      metadata: options.metadata || {} // Lưu trữ metadata tùy chỉnh
    };
    
    peerState.set(socket.id, peerInfo);
    roomState.get(roomId).peers.set(socket.id, peerInfo);
    
    // Tham gia socket room
    await socket.join(roomId);
    
    // Thông báo cho những người dùng khác
    socket.to(roomId).emit('mediasoup:peerJoined', {
      peerId: socket.id,
      userId: context.userId,
      name: user.name,
      metadata: peerInfo.metadata
    });
    
    // Gửi danh sách người dùng hiện có và RTP capabilities
    const peerInfos = Array.from(roomState.get(roomId).peers.values())
      .filter(peer => peer.id !== socket.id)
      .map(peer => ({
        id: peer.id,
        userId: peer.userId,
        name: peer.name,
        metadata: peer.metadata
      }));
    
    socket.emit('mediasoup:roomInfo', {
      peers: peerInfos,
      routerRtpCapabilities: router.rtpCapabilities,
      metadata: roomState.get(roomId).options.metadata || {}
    });

    // Thêm participant vào MediaSession (nếu có)
    try {
      const roomRec = roomState.get(roomId);
      if (roomRec && roomRec.sessionId) {
        await MediaSession.findByIdAndUpdate(roomRec.sessionId, {
          $addToSet: {
            participants: {
              userId: context.userId,
              joinedAt: new Date(),
              metadata: peerInfo.metadata || {}
            }
          }
        });
      }
    } catch (err) {
      console.error(`[MediaSoup] Không thể thêm participant vào MediaSession: ${err?.message || err}`);
    }

  } catch (error) {
    console.error(`[MediaSoup] Lỗi join room: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tạo WebRTC Transport
async function handleCreateTransport(socket, io, { roomId, direction, options = {} }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }
    
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const roomData = roomState.get(roomId);
    if (!roomData) {
      throw new Error("Phòng không tồn tại");
    }
    
    // Kết hợp cấu hình mặc định với tùy chọn
    const transportOptions = {
      ...mediasoupConfig.webRtcTransport,
      ...(options.transportOptions || {})
    };
    
    // Tạo WebRTC transport
    const transport = await roomData.router.createWebRtcTransport(transportOptions);
    
    // Xử lý các sự kiện transport
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });
    
    transport.on('close', () => {
      console.log(`Transport ${transport.id} đã đóng`);
    });
    
    // Lưu transport
    peer.transports.set(transport.id, {
      transport,
      direction,
      options,
      metadata: options.metadata || {}
    });
    
    // Trả về thông tin transport cho client
    socket.emit('mediasoup:transportCreated', {
      transportId: transport.id,
      direction,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      metadata: options.metadata || {}
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi tạo transport: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Kết nối transport
async function handleConnectTransport(socket, io, { transportId, dtlsParameters, options = {} }) {
  try {
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const transportData = peer.transports.get(transportId);
    if (!transportData) {
      throw new Error("Transport không tồn tại");
    }
    
    await transportData.transport.connect({ dtlsParameters });
    
    // Cập nhật metadata nếu có
    if (options.metadata) {
      transportData.metadata = {
        ...transportData.metadata,
        ...options.metadata
      };
    }
    
    socket.emit('mediasoup:transportConnected', {
      transportId,
      connected: true,
      metadata: transportData.metadata
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi connect transport: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tạo producer (gửi media)
async function handleProduce(socket, io, { transportId, kind, rtpParameters, options = {} }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }
    
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const transportData = peer.transports.get(transportId);
    if (!transportData || transportData.direction !== 'send') {
      throw new Error("Transport gửi không tồn tại");
    }
    
    // Chuẩn bị appData với metadata
    const appData = {
      peerId: socket.id,
      userId: peer.userId,
      ...options,
      metadata: options.metadata || {}
    };
    
    // Tạo producer
    const producer = await transportData.transport.produce({
      kind,
      rtpParameters,
      appData
    });
    
    // Xử lý sự kiện producer
    producer.on('transportclose', () => {
      producer.close();
      peer.producers.delete(producer.id);
    });
    
    producer.on('score', (score) => {
      // Lưu điểm producer
      if (peer.producers.has(producer.id)) {
        peer.producers.get(producer.id).score = score;
      }
    });
    
    // Lưu producer
    peer.producers.set(producer.id, {
      producer,
      kind,
      options,
      metadata: options.metadata || {}
    });
    
    // Thông báo cho những người dùng khác
    await runWithContext(context, async () => {
      socket.to(peer.roomId).emit('mediasoup:newProducer', {
        producerId: producer.id,
        peerId: socket.id,
        userId: peer.userId,
        kind,
        metadata: options.metadata || {}
      });
    });
    
    socket.emit('mediasoup:producerCreated', {
      id: producer.id,
      kind,
      metadata: options.metadata || {}
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi produce: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tạm dừng producer
async function handlePauseProducer(socket, io, { producerId, options = {} }) {
  try {
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const producerData = peer.producers.get(producerId);
    if (!producerData) {
      throw new Error("Producer không tồn tại");
    }
    
    await producerData.producer.pause();
    
    // Cập nhật metadata nếu có
    if (options.metadata) {
      producerData.metadata = {
        ...producerData.metadata,
        ...options.metadata
      };
    }
    
    // Thông báo cho các peers khác
    socket.to(peer.roomId).emit('mediasoup:producerPaused', {
      producerId,
      peerId: socket.id,
      userId: peer.userId,
      metadata: producerData.metadata
    });
    
    socket.emit('mediasoup:producerPaused', {
      producerId,
      paused: true,
      metadata: producerData.metadata
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi pause producer: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tiếp tục producer
async function handleResumeProducer(socket, io, { producerId, options = {} }) {
  try {
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const producerData = peer.producers.get(producerId);
    if (!producerData) {
      throw new Error("Producer không tồn tại");
    }
    
    await producerData.producer.resume();
    
    // Cập nhật metadata nếu có
    if (options.metadata) {
      producerData.metadata = {
        ...producerData.metadata,
        ...options.metadata
      };
    }
    
    // Thông báo cho các peers khác
    socket.to(peer.roomId).emit('mediasoup:producerResumed', {
      producerId,
      peerId: socket.id,
      userId: peer.userId,
      metadata: producerData.metadata
    });
    
    socket.emit('mediasoup:producerResumed', {
      producerId,
      resumed: true,
      metadata: producerData.metadata
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi resume producer: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tạo consumer (nhận media)
async function handleConsume(socket, io, { roomId, producerId, transportId, rtpCapabilities, options = {} }) {
  try {
    const context = socket.context;
    if (!context?.userId) {
      throw new Error("Thiếu thông tin: userId");
    }
    
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const roomData = roomState.get(roomId);
    if (!roomData) {
      throw new Error("Phòng không tồn tại");
    }
    
    if (!roomData.router.canConsume({
      producerId,
      rtpCapabilities,
    })) {
      throw new Error("Không thể consume producer này");
    }
    
    const transportData = peer.transports.get(transportId);
    if (!transportData || transportData.direction !== 'recv') {
      throw new Error("Transport nhận không tồn tại");
    }
    
    // Tìm producer data
    let producerPeer = null;
    let producerData = null;
    
    for (const [peerId, peerData] of roomData.peers) {
      if (peerData.producers.has(producerId)) {
        producerPeer = peerData;
        producerData = peerData.producers.get(producerId);
        break;
      }
    }
    
    if (!producerPeer) {
      throw new Error("Producer không tồn tại");
    }
    
    // Tạo consumer
    const consumer = await transportData.transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Bắt đầu ở trạng thái tạm dừng
      appData: {
        peerId: socket.id,
        producerPeerId: producerPeer.id,
        userId: peer.userId,
        producerUserId: producerPeer.userId,
        ...options,
        metadata: options.metadata || {}
      }
    });
    
    // Xử lý sự kiện consumer
    consumer.on('transportclose', () => {
      consumer.close();
      peer.consumers.delete(consumer.id);
    });
    
    // Lưu consumer
    peer.consumers.set(consumer.id, {
      consumer,
      producerId,
      producerPeerId: producerPeer.id,
      producerUserId: producerPeer.userId,
      kind: consumer.kind,
      options,
      metadata: options.metadata || {},
      producerMetadata: producerData.metadata || {}
    });
    
    // Trả về thông tin consumer cho client
    socket.emit('mediasoup:consumerCreated', {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      producerUserId: producerPeer.userId,
      producerPeerId: producerPeer.id,
      metadata: {
        ...options.metadata,
        producerMetadata: producerData.metadata || {}
      }
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi consume: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Tiếp tục consumer
async function handleResumeConsumer(socket, io, { consumerId, options = {} }) {
  try {
    const peer = peerState.get(socket.id);
    if (!peer) {
      throw new Error("Không tìm thấy thông tin peer");
    }
    
    const consumerData = peer.consumers.get(consumerId);
    if (!consumerData) {
      throw new Error("Consumer không tồn tại");
    }
    
    await consumerData.consumer.resume();
    
    // Cập nhật metadata nếu có
    if (options.metadata) {
      consumerData.metadata = {
        ...consumerData.metadata,
        ...options.metadata
      };
    }
    
    socket.emit('mediasoup:consumerResumed', {
      consumerId,
      resumed: true,
      metadata: consumerData.metadata
    });
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi resume consumer: ${error.message}`);
    socket.emit("error", { message: error.message });
  }
}

// Xử lý ngắt kết nối của người dùng
async function handlePeerDisconnected(socket, io) {
  try {
    const peer = peerState.get(socket.id);
    if (!peer) return;
    
    const roomId = peer.roomId;
    const roomData = roomState.get(roomId);
    if (!roomData) return;
    
    console.log(`[MediaSoup] Peer ${socket.id} (${peer.userId}) ngắt kết nối khỏi phòng ${roomId}`);
    
    // Đóng tất cả transports
    for (const [transportId, transportData] of peer.transports) {
      transportData.transport.close();
    }
    
    // Xóa peer khỏi room
    roomData.peers.delete(socket.id);
    
    // Thông báo cho các peers khác
    socket.to(roomId).emit('mediasoup:peerLeft', {
      peerId: socket.id,
      userId: peer.userId
    });
    
    // Xóa room nếu không còn ai
    if (roomData.peers.size === 0) {
      console.log(`[MediaSoup] Xóa phòng trống ${roomId}`);
      // Đánh dấu MediaSession kết thúc nếu có
      try {
        const sessionId = roomData.sessionId;
        if (sessionId) {
          await MediaSession.findByIdAndUpdate(sessionId, {
            active: false,
            endedAt: new Date()
          });
          console.log(`[MediaSoup] Đã đánh dấu MediaSession ${sessionId} inactive`);
        }
      } catch (err) {
        console.error(`[MediaSoup] Không thể cập nhật MediaSession khi phòng rỗng: ${err?.message || err}`);
      }

      roomState.delete(roomId);
    }
    
    // Xóa peer
    peerState.delete(socket.id);
    
  } catch (error) {
    console.error(`[MediaSoup] Lỗi xử lý ngắt kết nối: ${error.message}`);
  }
}

// Đăng ký các sự kiện socket MediaSoup
export const handleMediasoupEvents = (socket, io) => {
  // Khởi tạo worker nếu chưa có
  if (!worker) {
    initializeMediasoupWorker().catch(error => {
      console.error('Khởi tạo MediaSoup worker thất bại:', error);
    });
  }
  
  // Đăng ký các sự kiện
  socket.on('mediasoup:joinRoom', (data) => handleJoinRoom(socket, io, data));
  socket.on('mediasoup:createTransport', (data) => handleCreateTransport(socket, io, data));
  socket.on('mediasoup:connectTransport', (data) => handleConnectTransport(socket, io, data));
  socket.on('mediasoup:produce', (data) => handleProduce(socket, io, data));
  socket.on('mediasoup:consume', (data) => handleConsume(socket, io, data));
  socket.on('mediasoup:pauseProducer', (data) => handlePauseProducer(socket, io, data));
  socket.on('mediasoup:resumeProducer', (data) => handleResumeProducer(socket, io, data));
  socket.on('mediasoup:resumeConsumer', (data) => handleResumeConsumer(socket, io, data));
  
  // Xử lý ngắt kết nối
  socket.on('disconnect', () => handlePeerDisconnected(socket, io));
};
