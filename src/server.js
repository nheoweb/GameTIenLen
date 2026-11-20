import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { RoomManager } from './game/roomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

export function createGameServer({ countdownSeconds = 3, tickIntervalMs = 1000 } = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const roomManager = new RoomManager();
  const countdownTimers = new Map(); // roomId -> IntervalId

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  app.get('/api/network-info', (req, res) => {
    const port = httpServer.address()?.port || process.env.PORT || 3000;
    const lanIps = getLanAddresses();
    res.json({
      port,
      lanIps,
      lanUrls: lanIps.map((ip) => `http://${ip}:${port}`),
    });
  });

  function broadcastLobby() {
    io.emit('lobby:update', roomManager.getLobbyRooms());
  }

  function broadcastRoomState(roomId) {
    const room = roomManager.rooms.get(String(roomId));
    if (!room) return;

    const allRecipients = [...room.players, ...room.spectators];
    for (const person of allRecipients) {
      if (person.socketId && person.online) {
        const personalState = roomManager.getRoomStateForPlayer(roomId, person.playerToken);
        io.to(person.socketId).emit('room:state', personalState);
      }
    }
  }

  function emitAlertToRoom(roomId, alertPayload) {
    io.to(`room:${roomId}`).emit('room:alert', {
      timestamp: Date.now(),
      ...alertPayload,
    });
  }

  function clearRoomCountdown(roomId) {
    const timer = countdownTimers.get(String(roomId));
    if (timer) {
      clearInterval(timer);
      countdownTimers.delete(String(roomId));
    }
  }

  function startRoomCountdown(roomId) {
    const code = String(roomId);
    const room = roomManager.rooms.get(code);
    if (!room || room.status === 'PLAYING') return;

    clearRoomCountdown(code);

    room.status = 'COUNTDOWN';
    room.countdownSeconds = countdownSeconds;
    roomManager.addLog(room, `⏳ Chuẩn bị chia bài sau ${countdownSeconds} giây...`);

    emitAlertToRoom(code, {
      type: 'COUNTDOWN_TICK',
      secondsLeft: room.countdownSeconds,
      message: `Chuẩn bị chia bài: ${room.countdownSeconds}...`,
    });
    broadcastRoomState(code);
    broadcastLobby();

    const timer = setInterval(() => {
      const currentRoom = roomManager.rooms.get(code);
      if (!currentRoom || currentRoom.status !== 'COUNTDOWN') {
        clearRoomCountdown(code);
        return;
      }

      currentRoom.countdownSeconds -= 1;

      if (currentRoom.countdownSeconds > 0) {
        emitAlertToRoom(code, {
          type: 'COUNTDOWN_TICK',
          secondsLeft: currentRoom.countdownSeconds,
          message: `Chuẩn bị chia bài: ${currentRoom.countdownSeconds}...`,
        });
        broadcastRoomState(code);
      } else {
        clearRoomCountdown(code);
        const startRes = roomManager.startGame(code);
        if (startRes.ok) {
          emitAlertToRoom(code, {
            type: 'GAME_STARTED',
            roundNumber: currentRoom.roundNumber,
            message: `🃏 Ván #${currentRoom.roundNumber} bắt đầu!`,
          });
          broadcastRoomState(code);
          broadcastLobby();
        }
      }
    }, tickIntervalMs);

    countdownTimers.set(code, timer);
  }

  io.on('connection', (socket) => {
    // Gửi ngay danh sách bàn hiện tại ở sảnh chờ
    socket.emit('lobby:update', roomManager.getLobbyRooms());

    socket.on('lobby:subscribe', (cb) => {
      const rooms = roomManager.getLobbyRooms();
      socket.emit('lobby:update', rooms);
      if (typeof cb === 'function') cb({ ok: true, rooms });
    });

    socket.on('room:create', (payload = {}, cb) => {
      const res = roomManager.createRoom({
        playerToken: payload.playerToken,
        nickname: payload.nickname,
        roomName: payload.roomName,
        socketId: socket.id,
      });

      if (!res.ok) {
        if (typeof cb === 'function') cb(res);
        return;
      }

      socket.join(`room:${res.roomId}`);
      broadcastRoomState(res.roomId);
      broadcastLobby();

      if (typeof cb === 'function') {
        cb({
          ok: true,
          roomId: res.roomId,
          state: roomManager.getRoomStateForPlayer(res.roomId, payload.playerToken),
        });
      }
    });

    socket.on('room:join', (payload = {}, cb) => {
      const res = roomManager.joinRoom({
        roomId: payload.roomId,
        playerToken: payload.playerToken,
        nickname: payload.nickname,
        socketId: socket.id,
      });

      if (!res.ok) {
        if (typeof cb === 'function') cb(res);
        return;
      }

      socket.join(`room:${res.roomId}`);

      if (res.wasCountdownCancelled) {
        clearRoomCountdown(res.roomId);
        emitAlertToRoom(res.roomId, {
          type: 'COUNTDOWN_CANCELLED',
          message: `⏸️ Tạm dừng đếm ngược vì ${payload.nickname} vừa vào bàn!`,
        });
      }

      if (res.joinAlertType === 'ROOM_FULL_4') {
        emitAlertToRoom(res.roomId, {
          type: 'ROOM_FULL_4',
          nickname: payload.nickname,
          message: `🔔 ĐỦ 4/4 CHÂN RỒI! (${payload.nickname} vừa vào). Tất cả bấm Sẵn sàng để tự động chia bài!`,
        });
      } else if (res.joinAlertType === 'PLAYER_JOINED') {
        emitAlertToRoom(res.roomId, {
          type: 'PLAYER_JOINED',
          nickname: payload.nickname,
          message: `👋 ${payload.nickname} vừa vào bàn!`,
        });
      } else if (res.joinAlertType === 'SPECTATOR_JOINED') {
        emitAlertToRoom(res.roomId, {
          type: 'SPECTATOR_JOINED',
          nickname: payload.nickname,
          message: `👀 ${payload.nickname} vào xem bàn.`,
        });
      }

      broadcastRoomState(res.roomId);
      broadcastLobby();

      if (typeof cb === 'function') {
        cb({
          ok: true,
          roomId: res.roomId,
          role: res.role,
          reconnected: res.reconnected,
          joinAlertType: res.joinAlertType,
          state: roomManager.getRoomStateForPlayer(res.roomId, payload.playerToken),
        });
      }
    });

    socket.on('room:ready', (payload = {}, cb) => {
      const res = roomManager.setPlayerReady({
        roomId: payload.roomId,
        playerToken: payload.playerToken,
        ready: payload.ready,
      });

      if (!res.ok) {
        if (typeof cb === 'function') cb(res);
        return;
      }

      if (res.wasCountdownCancelled) {
        clearRoomCountdown(payload.roomId);
        emitAlertToRoom(payload.roomId, {
          type: 'COUNTDOWN_CANCELLED',
          message: '⏸️ Đã dừng đếm ngược do có người hủy Sẵn sàng.',
        });
      }

      broadcastRoomState(payload.roomId);

      // Cách 1: Khi đủ 4/4 người và cả 4 người đều đã bấm Sẵn sàng -> Tự động đếm ngược chia bài luôn!
      if (res.autoStartCountdown) {
        startRoomCountdown(payload.roomId);
      }

      if (typeof cb === 'function') cb(res);
    });

    socket.on('room:start', (payload = {}, cb) => {
      const check = roomManager.canHostStartGame(payload.roomId, payload.playerToken);
      if (!check.allowed) {
        if (typeof cb === 'function') cb({ ok: false, error: check.reason });
        return;
      }

      startRoomCountdown(payload.roomId);
      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('room:nudge', (payload = {}, cb) => {
      const room = roomManager.rooms.get(String(payload.roomId));
      if (!room) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Không tìm thấy phòng' });
        return;
      }

      const sender =
        room.players.find((p) => p.playerToken === payload.playerToken) ||
        room.spectators.find((s) => s.playerToken === payload.playerToken);
      const fromName = sender ? sender.nickname : 'Đồng đội';

      const unreadyNames = room.players.filter((p) => !p.ready).map((p) => p.nickname);
      let msg = `🔔 ${fromName} đang gõ bàn gọi anh em!`;
      if (room.status === 'WAITING' && unreadyNames.length > 0) {
        msg = `🔔 ${fromName} gõ bàn nhắc [${unreadyNames.join(', ')}] bấm Sẵn sàng!`;
      } else if (room.status === 'PLAYING') {
        const turnPlayer = room.players.find((p) => p.playerToken === room.currentTurnToken);
        if (turnPlayer) {
          msg = `🔔 ${fromName} gõ bàn giục [${turnPlayer.nickname}] đánh bài lẹ!`;
        }
      }

      roomManager.addLog(room, msg);
      emitAlertToRoom(room.roomId, {
        type: 'NUDGE',
        fromNickname: fromName,
        message: msg,
      });
      broadcastRoomState(room.roomId);

      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('room:leave', (payload = {}, cb) => {
      const roomId = String(payload.roomId || '');
      clearRoomCountdown(roomId);

      const res = roomManager.leaveRoom({
        roomId,
        playerToken: payload.playerToken,
      });

      socket.leave(`room:${roomId}`);
      if (!res.roomDeleted) {
        broadcastRoomState(roomId);
      }
      broadcastLobby();

      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('game:play', (payload = {}, cb) => {
      const res = roomManager.playCards({
        roomId: payload.roomId,
        playerToken: payload.playerToken,
        cardIds: payload.cardIds,
      });

      if (!res.ok) {
        if (typeof cb === 'function') cb(res);
        return;
      }

      if (res.isChop) {
        emitAlertToRoom(payload.roomId, {
          type: 'CHOP',
          message: res.chopNote || '🔥 Chặt Heo / Hàng!',
        });
      } else {
        emitAlertToRoom(payload.roomId, {
          type: 'CARD_PLAYED',
        });
      }

      if (res.gameEnded) {
        emitAlertToRoom(payload.roomId, {
          type: 'GAME_ENDED',
          rankings: res.rankings,
          message: `🏆 Kết thúc ván! Nhất: ${res.rankings?.[0]?.nickname || ''}`,
        });
        broadcastLobby();
      }

      broadcastRoomState(payload.roomId);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('game:pass', (payload = {}, cb) => {
      const res = roomManager.passTurn({
        roomId: payload.roomId,
        playerToken: payload.playerToken,
      });

      if (!res.ok) {
        if (typeof cb === 'function') cb(res);
        return;
      }

      emitAlertToRoom(payload.roomId, {
        type: 'PASS',
        newTrickStarted: res.newTrickStarted,
      });

      broadcastRoomState(payload.roomId);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('disconnect', () => {
      const info = roomManager.handleDisconnect(socket.id);
      if (info) {
        broadcastRoomState(info.roomId);
      }
    });
  });

  async function close() {
    for (const timer of countdownTimers.values()) {
      clearInterval(timer);
    }
    countdownTimers.clear();
    await new Promise((resolve) => io.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
  }

  return {
    app,
    httpServer,
    io,
    roomManager,
    close,
  };
}

// Khởi chạy server nếu file được gọi trực tiếp bằng `node src/server.js`
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = Number(process.env.PORT) || 3000;
  const { httpServer } = createGameServer();
  httpServer.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    console.log('====================================================');
    console.log('🃏 TIẾN LÊN MIỀN NAM ONLINE NỘI BỘ ĐÃ KHỞI ĐỘNG!');
    console.log(`👉 Máy hiện tại:   http://localhost:${PORT}`);
    lanIps.forEach((ip) => {
      console.log(`👉 Mạng LAN/WiFi:  http://${ip}:${PORT}`);
    });
    console.log('====================================================');
  });
}
