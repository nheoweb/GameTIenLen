import { dealHands, sortCards } from './deck.js';
import { classifyHand, canBeat } from './rules.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room object
    this.socketToPlayer = new Map(); // socketId -> { roomId, playerToken }
  }

  generateRoomId() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    return String(Date.now()).slice(-4);
  }

  getLobbyRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      const host = room.players.find((p) => p.playerToken === room.hostToken) || room.players[0];
      list.push({
        roomId: room.roomId,
        roomName: room.roomName,
        hostNickname: host ? host.nickname : 'Ẩn danh',
        playerCount: room.players.length,
        maxPlayers: 4,
        spectatorCount: room.spectators.length,
        status: room.status,
        roundNumber: room.roundNumber,
      });
    }
    return list;
  }

  createRoom({ playerToken, nickname, socketId, roomName = '' }) {
    if (!playerToken || !nickname) {
      return { ok: false, error: 'Vui lòng nhập Tên hiển thị (Nickname)' };
    }

    // Nếu người chơi đang ở phòng khác thì rời phòng cũ trước
    this.leaveCurrentRoomByToken(playerToken);

    const roomId = this.generateRoomId();
    const cleanName = String(nickname).trim().slice(0, 20) || 'Người chơi';
    const cleanRoomName = String(roomName || '').trim().slice(0, 30) || `Bàn của ${cleanName}`;

    const hostPlayer = {
      playerToken,
      nickname: cleanName,
      socketId,
      seatIndex: 0,
      ready: false,
      online: true,
      hand: [],
      passedInRound: false,
      finishOrder: null,
      score: 0,
    };

    const room = {
      roomId,
      roomName: cleanRoomName,
      hostToken: playerToken,
      status: 'WAITING', // 'WAITING' | 'COUNTDOWN' | 'PLAYING'
      countdownSeconds: null,
      players: [hostPlayer],
      spectators: [],
      roundNumber: 0,
      lastWinnerToken: null,
      requiredFirstCardId: null,
      requiredFirstCardLabel: null,
      currentTurnToken: null,
      currentTrick: null,
      tableHistory: [],
      rankings: [],
      finishCounter: 0,
      nextStarterAfterFinishToken: null,
      logs: [`🎉 ${cleanName} đã tạo phòng #${roomId}`],
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    if (socketId) {
      this.socketToPlayer.set(socketId, { roomId, playerToken });
    }

    return {
      ok: true,
      roomId,
      room,
      joinAlertType: 'CREATED',
    };
  }

  joinRoom({ roomId, playerToken, nickname, socketId }) {
    const code = String(roomId || '').trim();
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: `Không tìm thấy phòng #${code}` };
    }
    if (!playerToken || !nickname) {
      return { ok: false, error: 'Thiếu thông tin người chơi' };
    }

    const cleanName = String(nickname).trim().slice(0, 20) || 'Người chơi';

    // 1. Kiểm tra nếu người chơi đã có ghế trong phòng (Reconnect / F5)
    const existingPlayer = room.players.find((p) => p.playerToken === playerToken);
    if (existingPlayer) {
      if (existingPlayer.socketId && existingPlayer.socketId !== socketId) {
        this.socketToPlayer.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socketId;
      existingPlayer.online = true;
      existingPlayer.nickname = cleanName;
      if (socketId) {
        this.socketToPlayer.set(socketId, { roomId: code, playerToken });
      }
      this.addLog(room, `🔄 ${cleanName} đã kết nối lại bàn.`);
      return {
        ok: true,
        roomId: code,
        reconnected: true,
        role: 'PLAYER',
        joinAlertType: 'RECONNECTED',
      };
    }

    // 2. Kiểm tra nếu người chơi đang là Khán giả (Spectator) reconnect
    const existingSpec = room.spectators.find((s) => s.playerToken === playerToken);
    if (existingSpec) {
      existingSpec.socketId = socketId;
      existingSpec.online = true;
      existingSpec.nickname = cleanName;
      if (socketId) {
        this.socketToPlayer.set(socketId, { roomId: code, playerToken });
      }
      return {
        ok: true,
        roomId: code,
        reconnected: true,
        role: 'SPECTATOR',
        joinAlertType: 'RECONNECTED',
      };
    }

    // Rời phòng khác nếu đang ở phòng khác
    this.leaveCurrentRoomByToken(playerToken, code);

    // 3. Nếu phòng đang ở trạng thái WAITING/COUNTDOWN và còn ghế trống (< 4 người)
    if (room.status !== 'PLAYING' && room.players.length < 4) {
      // Nếu đang đếm ngược mà có người mới vào thì dừng đếm ngược để chờ người mới Sẵn sàng
      const wasCountdown = room.status === 'COUNTDOWN';
      if (wasCountdown) {
        room.status = 'WAITING';
        room.countdownSeconds = null;
      }

      const takenSeats = new Set(room.players.map((p) => p.seatIndex));
      let seatIndex = 0;
      while (takenSeats.has(seatIndex)) {
        seatIndex++;
      }

      const newPlayer = {
        playerToken,
        nickname: cleanName,
        socketId,
        seatIndex,
        ready: false,
        online: true,
        hand: [],
        passedInRound: false,
        finishOrder: null,
        score: 0,
      };

      room.players.push(newPlayer);
      room.players.sort((a, b) => a.seatIndex - b.seatIndex);

      if (socketId) {
        this.socketToPlayer.set(socketId, { roomId: code, playerToken });
      }

      const isFull4 = room.players.length === 4;
      const joinAlertType = isFull4 ? 'ROOM_FULL_4' : 'PLAYER_JOINED';

      if (isFull4) {
        this.addLog(room, `🔔 ${cleanName} đã vào bàn (ĐỦ 4/4 CHÂN!). Hãy bấm Sẵn sàng để chia bài!`);
      } else {
        this.addLog(room, `👋 ${cleanName} đã vào bàn (${room.players.length}/4 người).`);
      }

      return {
        ok: true,
        roomId: code,
        reconnected: false,
        role: 'PLAYER',
        joinAlertType,
        wasCountdownCancelled: wasCountdown,
      };
    }

    // 4. Phòng đang đánh dở ván hoặc đã đủ 4 ghế -> Vào làm Khán giả (Spectator)
    const spectator = {
      playerToken,
      nickname: cleanName,
      socketId,
      online: true,
    };
    room.spectators.push(spectator);
    if (socketId) {
      this.socketToPlayer.set(socketId, { roomId: code, playerToken });
    }
    this.addLog(room, `👀 ${cleanName} đang đứng xem bàn (sẽ vào ghế ở ván sau nếu còn chỗ).`);

    return {
      ok: true,
      roomId: code,
      reconnected: false,
      role: 'SPECTATOR',
      joinAlertType: 'SPECTATOR_JOINED',
    };
  }

  /**
   * Cơ chế Sẵn sàng (Cách 1):
   * - Khi 2 hoặc 3 người trong bàn đều đã Sẵn sàng: canHostStart = true (Chủ phòng bấm nút Chia bài).
   * - Khi đủ 4/4 người trong bàn và cả 4 đều đã Sẵn sàng: autoStartCountdown = true (Tự động đếm ngược 3..2..1 và chia bài).
   */
  setPlayerReady({ roomId, playerToken, ready }) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return { ok: false, error: 'Không tìm thấy phòng' };
    }
    if (room.status === 'PLAYING') {
      return { ok: false, error: 'Bàn đang trong ván đấu' };
    }

    const player = room.players.find((p) => p.playerToken === playerToken);
    if (!player) {
      return { ok: false, error: 'Bạn đang là khán giả, vui lòng đợi hết ván hiện tại' };
    }

    player.ready = Boolean(ready);
    const wasCountdown = room.status === 'COUNTDOWN';
    if (!player.ready && wasCountdown) {
      room.status = 'WAITING';
      room.countdownSeconds = null;
      this.addLog(room, `⏸️ ${player.nickname} đã hủy Sẵn sàng — Tạm dừng đếm ngược.`);
    } else if (player.ready) {
      this.addLog(room, `✅ ${player.nickname} đã Sẵn sàng!`);
    }

    const readiness = this.evaluateRoomReadiness(room);

    return {
      ok: true,
      ready: player.ready,
      wasCountdownCancelled: !player.ready && wasCountdown,
      ...readiness,
    };
  }

  evaluateRoomReadiness(room) {
    const totalPlayers = room.players.length;
    const readyCount = room.players.filter((p) => p.ready).length;
    const allSeatedReady = totalPlayers >= 2 && readyCount === totalPlayers;

    // Theo Cách 1:
    // - Có từ 2 người trở lên và 100% Sẵn sàng -> Chủ phòng có thể bấm Chia bài (canHostStart = true)
    // - Đủ 4/4 người và cả 4 cùng Sẵn sàng -> Tự động đếm ngược chia bài luôn (autoStartCountdown = true)
    const canHostStart = allSeatedReady;
    const autoStartCountdown = totalPlayers === 4 && readyCount === 4;

    return {
      totalPlayers,
      readyCount,
      allSeatedReady,
      canHostStart,
      autoStartCountdown,
    };
  }

  canHostStartGame(roomId, playerToken) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return { allowed: false, reason: 'Không tìm thấy phòng' };
    }
    if (room.status === 'PLAYING') {
      return { allowed: false, reason: 'Ván bài đang diễn ra' };
    }
    if (room.hostToken !== playerToken) {
      return { allowed: false, reason: 'Chỉ Chủ phòng mới có quyền bấm Bắt đầu chia bài' };
    }
    const { totalPlayers, allSeatedReady } = this.evaluateRoomReadiness(room);
    if (totalPlayers < 2) {
      return { allowed: false, reason: 'Cần tối thiểu 2 người chơi để chia bài' };
    }
    if (!allSeatedReady) {
      return { allowed: false, reason: 'Tất cả người chơi trong bàn phải bấm Sẵn sàng trước khi chia bài' };
    }
    return { allowed: true };
  }

  startGame(roomId) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return { ok: false, error: 'Không tìm thấy phòng' };
    }
    if (room.players.length < 2) {
      return { ok: false, error: 'Cần ít nhất 2 người chơi để bắt đầu' };
    }

    const { hands, lowestCard, lowestHolderIndex } = dealHands(room.players.length);
    return this._applyDealtHands(room, hands, lowestCard.id, lowestHolderIndex, lowestCard.label);
  }

  startGameWithCustomHands(roomId, customHands, lowestCardId = '3S', lowestHolderIndex = 0) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return { ok: false, error: 'Không tìm thấy phòng' };
    }
    const sortedHands = customHands.map((h) => sortCards(h));
    const lowestCard = sortedHands[lowestHolderIndex]?.[0];
    return this._applyDealtHands(
      room,
      sortedHands,
      lowestCardId,
      lowestHolderIndex,
      lowestCard ? lowestCard.label : lowestCardId
    );
  }

  _applyDealtHands(room, hands, lowestCardId, lowestHolderIndex, lowestCardLabel) {
    room.status = 'PLAYING';
    room.countdownSeconds = null;
    room.roundNumber += 1;
    room.currentTrick = null;
    room.tableHistory = [];
    room.rankings = [];
    room.finishCounter = 0;
    room.nextStarterAfterFinishToken = null;

    room.players.forEach((p, idx) => {
      p.hand = hands[idx];
      p.passedInRound = false;
      p.finishOrder = null;
    });

    // Xác định người đánh đầu tiên:
    // - Nếu có người thắng ván trước và người đó vẫn ngồi trong bàn -> Người đó đi trước tự do
    // - Ngược lại (ván đầu tiên hoặc người thắng cũ đã thoát) -> Người giữ lá nhỏ nhất trên bàn đi trước và bắt buộc đánh bộ có chứa lá đó
    const prevWinner = room.lastWinnerToken
      ? room.players.find((p) => p.playerToken === room.lastWinnerToken)
      : null;

    if (prevWinner) {
      room.currentTurnToken = prevWinner.playerToken;
      room.requiredFirstCardId = null;
      room.requiredFirstCardLabel = null;
      this.addLog(
        room,
        `🃏 Ván #${room.roundNumber} bắt đầu! ${prevWinner.nickname} (Nhất ván trước) được đánh trước.`
      );
    } else {
      const starter = room.players[lowestHolderIndex] || room.players[0];
      room.currentTurnToken = starter.playerToken;
      room.requiredFirstCardId = lowestCardId;
      room.requiredFirstCardLabel = lowestCardLabel;
      this.addLog(
        room,
        `🃏 Ván #${room.roundNumber} bắt đầu! ${starter.nickname} giữ lá nhỏ nhất (${lowestCardLabel}) đi trước.`
      );
    }

    return {
      ok: true,
      room,
    };
  }

  playCards({ roomId, playerToken, cardIds }) {
    const room = this.rooms.get(String(roomId));
    if (!room || room.status !== 'PLAYING') {
      return { ok: false, error: 'Bàn chưa bắt đầu ván đấu' };
    }
    if (room.currentTurnToken !== playerToken) {
      return { ok: false, error: 'Chưa tới lượt của bạn' };
    }
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      return { ok: false, error: 'Bạn chưa chọn lá bài nào' };
    }

    const playerIdx = room.players.findIndex((p) => p.playerToken === playerToken);
    const player = room.players[playerIdx];
    if (!player) {
      return { ok: false, error: 'Không tìm thấy người chơi trong bàn' };
    }

    // Kiểm tra người chơi có thực sự sở hữu tất cả các lá bài đã chọn không
    const selectedCards = [];
    for (const id of cardIds) {
      const card = player.hand.find((c) => c.id === id);
      if (!card) {
        return { ok: false, error: `Lá bài ${id} không có trên tay bạn` };
      }
      selectedCards.push(card);
    }

    // Kiểm tra bắt buộc chứa lá bài nhỏ nhất ở lượt đầu tiên của ván đầu
    if (room.requiredFirstCardId) {
      if (!cardIds.includes(room.requiredFirstCardId)) {
        return {
          ok: false,
          error: `Lượt đầu tiên bắt buộc phải đánh bộ bài có chứa lá ${room.requiredFirstCardLabel}`,
        };
      }
    }

    const classified = classifyHand(selectedCards);
    if (!classified.valid) {
      return { ok: false, error: classified.reason || 'Bộ bài không hợp lệ' };
    }

    const beatCheck = canBeat(room.currentTrick ? room.currentTrick.classifiedHand : null, classified);
    if (!beatCheck.allowed) {
      return { ok: false, error: beatCheck.reason || 'Không thể đè bài trên bàn' };
    }

    // Trừ bài trên tay người chơi
    const playedSet = new Set(cardIds);
    player.hand = player.hand.filter((c) => !playedSet.has(c.id));
    room.requiredFirstCardId = null;
    room.requiredFirstCardLabel = null;

    const trickEntry = {
      playerToken: player.playerToken,
      nickname: player.nickname,
      classifiedHand: classified,
      cards: classified.cards,
      label: classified.label,
      isChop: Boolean(beatCheck.isChop),
      chopNote: beatCheck.chopNote || null,
    };

    room.currentTrick = trickEntry;
    room.tableHistory.push(trickEntry);
    if (room.tableHistory.length > 3) {
      room.tableHistory.shift();
    }

    if (beatCheck.isChop && beatCheck.chopNote) {
      this.addLog(room, `${beatCheck.chopNote} (${player.nickname} đánh ${classified.label})`);
    } else {
      this.addLog(room, `🎴 ${player.nickname} đánh ${classified.label}`);
    }

    let playerFinished = false;
    if (player.hand.length === 0 && player.finishOrder === null) {
      room.finishCounter += 1;
      player.finishOrder = room.finishCounter;
      playerFinished = true;
      this.addLog(room, `🏆 ${player.nickname} đã hết bài (Về thứ ${player.finishOrder})!`);
    }

    // Kiểm tra xem ván bài đã kết thúc chưa (chỉ còn <= 1 người còn bài trên tay)
    const activeWithCards = room.players.filter((p) => p.hand.length > 0);
    if (activeWithCards.length <= 1) {
      this._finalizeRound(room, activeWithCards[0] || null);
      return {
        ok: true,
        isChop: Boolean(beatCheck.isChop),
        chopNote: beatCheck.chopNote || null,
        playerFinished,
        gameEnded: true,
        rankings: room.rankings,
      };
    }

    // Tìm người chơi kế tiếp trong vòng chưa bỏ lượt và còn bài
    const nextPlayer = this._findNextTurnPlayer(room, playerIdx);
    if (nextPlayer) {
      room.currentTurnToken = nextPlayer.playerToken;
    } else {
      // Tất cả người khác đã pass -> Mở vòng mới
      this._resetTrickForNewRound(room, playerIdx);
    }

    return {
      ok: true,
      isChop: Boolean(beatCheck.isChop),
      chopNote: beatCheck.chopNote || null,
      playerFinished,
      gameEnded: false,
    };
  }

  passTurn({ roomId, playerToken }) {
    const room = this.rooms.get(String(roomId));
    if (!room || room.status !== 'PLAYING') {
      return { ok: false, error: 'Bàn chưa bắt đầu ván đấu' };
    }
    if (room.currentTurnToken !== playerToken) {
      return { ok: false, error: 'Chưa tới lượt của bạn' };
    }
    if (!room.currentTrick) {
      return { ok: false, error: 'Bạn đang là người mở vòng mới, không thể bỏ lượt!' };
    }

    const playerIdx = room.players.findIndex((p) => p.playerToken === playerToken);
    const player = room.players[playerIdx];
    if (!player) {
      return { ok: false, error: 'Không tìm thấy người chơi' };
    }

    player.passedInRound = true;
    this.addLog(room, `⏭️ ${player.nickname} bỏ lượt.`);

    const trickOwnerIdx = room.players.findIndex(
      (p) => p.playerToken === room.currentTrick.playerToken
    );
    const trickOwner = room.players[trickOwnerIdx];

    // Kiểm tra còn ai khác ngoài chủ nhân bộ bài trên bàn chưa bỏ lượt không
    const contenders = room.players.filter(
      (p) =>
        p.hand.length > 0 &&
        !p.passedInRound &&
        p.playerToken !== room.currentTrick.playerToken
    );

    if (contenders.length === 0) {
      // Không còn ai theo được bộ bài trên bàn -> Kết thúc vòng (Trick), mở vòng mới!
      this._resetTrickForNewRound(
        room,
        trickOwnerIdx >= 0 ? trickOwnerIdx : playerIdx,
        trickOwner && trickOwner.hand.length > 0 ? trickOwner : null
      );
      return {
        ok: true,
        newTrickStarted: true,
      };
    }

    // Chuyển lượt cho người tiếp theo chưa bỏ lượt
    const nextPlayer = this._findNextTurnPlayer(room, playerIdx);
    if (nextPlayer) {
      room.currentTurnToken = nextPlayer.playerToken;
    }

    return {
      ok: true,
      newTrickStarted: false,
    };
  }

  _findNextTurnPlayer(room, fromIndex) {
    const count = room.players.length;
    for (let step = 1; step <= count; step++) {
      const idx = (fromIndex + step) % count;
      const candidate = room.players[idx];
      if (candidate.hand.length > 0 && !candidate.passedInRound) {
        return candidate;
      }
    }
    return null;
  }

  _resetTrickForNewRound(room, ownerSeatIdx, ownerWithCards = null) {
    room.currentTrick = null;
    room.tableHistory = [];
    room.players.forEach((p) => {
      p.passedInRound = false;
    });

    if (ownerWithCards && ownerWithCards.hand.length > 0) {
      room.currentTurnToken = ownerWithCards.playerToken;
      this.addLog(room, `🔄 Vòng mới! ${ownerWithCards.nickname} được quyền ra bài tự do.`);
      return;
    }

    // Nếu người đánh cuối vừa hết bài mà không ai đỡ được -> Người kế tiếp còn bài hưởng sái đi trước
    const nextStarter = this._findNextTurnPlayer(room, ownerSeatIdx);
    if (nextStarter) {
      room.currentTurnToken = nextStarter.playerToken;
      this.addLog(room, `🔄 Vòng mới! ${nextStarter.nickname} được quyền ra bài tự do.`);
    }
  }

  _finalizeRound(room, lastRemainingPlayer) {
    if (lastRemainingPlayer && lastRemainingPlayer.finishOrder === null) {
      room.finishCounter += 1;
      lastRemainingPlayer.finishOrder = room.finishCounter;
    }

    const total = room.players.length;
    const titleMap = {
      2: ['Nhất', 'Bét'],
      3: ['Nhất', 'Nhì', 'Bét'],
      4: ['Nhất', 'Nhì', 'Ba', 'Bét'],
    };
    const scoreMap = {
      2: [10, -10],
      3: [15, 5, -20],
      4: [20, 10, -10, -20],
    };

    const titles = titleMap[total] || ['Nhất', 'Nhì', 'Ba', 'Bét'];
    const deltas = scoreMap[total] || [20, 10, -10, -20];

    const ordered = [...room.players].sort(
      (a, b) => (a.finishOrder || 99) - (b.finishOrder || 99)
    );

    room.rankings = ordered.map((p, index) => {
      const scoreDelta = deltas[index] ?? 0;
      p.score += scoreDelta;
      return {
        playerToken: p.playerToken,
        nickname: p.nickname,
        place: index + 1,
        rankTitle: titles[index] || `Hạng ${index + 1}`,
        scoreDelta,
        totalScore: p.score,
        remainingCards: p.hand.length,
      };
    });

    if (room.rankings.length > 0) {
      room.lastWinnerToken = room.rankings[0].playerToken;
      this.addLog(
        room,
        `🏁 Kết thúc ván #${room.roundNumber}! Nhất: ${room.rankings[0].nickname}. Bấm Sẵn sàng để chơi ván tiếp theo!`
      );
    }

    // Đưa phòng về trạng thái WAITING để mọi người bấm Sẵn sàng cho ván mới
    room.status = 'WAITING';
    room.countdownSeconds = null;
    room.currentTurnToken = null;
    room.currentTrick = null;
    room.requiredFirstCardId = null;

    room.players.forEach((p) => {
      p.ready = false;
      p.passedInRound = false;
    });

    // Nếu bàn còn trống ghế (< 4 người) và có Khán giả đang chờ -> Tự động đưa Khán giả vào ghế cho ván mới
    while (room.players.length < 4 && room.spectators.length > 0) {
      const spec = room.spectators.shift();
      const takenSeats = new Set(room.players.map((p) => p.seatIndex));
      let seatIndex = 0;
      while (takenSeats.has(seatIndex)) {
        seatIndex++;
      }
      room.players.push({
        playerToken: spec.playerToken,
        nickname: spec.nickname,
        socketId: spec.socketId,
        seatIndex,
        ready: false,
        online: spec.online,
        hand: [],
        passedInRound: false,
        finishOrder: null,
        score: 0,
      });
      room.players.sort((a, b) => a.seatIndex - b.seatIndex);
      this.addLog(room, `🪑 Khán giả ${spec.nickname} đã được xếp vào ghế chơi ván mới!`);
    }
  }

  handleDisconnect(socketId) {
    const mapping = this.socketToPlayer.get(socketId);
    if (!mapping) {
      return null;
    }
    this.socketToPlayer.delete(socketId);

    const room = this.rooms.get(mapping.roomId);
    if (!room) {
      return null;
    }

    const player = room.players.find((p) => p.playerToken === mapping.playerToken);
    if (player) {
      player.online = false;
      this.addLog(room, `⚠️ ${player.nickname} tạm mất kết nối (giữ ghế chờ F5)...`);
      return { roomId: room.roomId, playerToken: player.playerToken };
    }

    const specIdx = room.spectators.findIndex((s) => s.playerToken === mapping.playerToken);
    if (specIdx >= 0) {
      room.spectators.splice(specIdx, 1);
      return { roomId: room.roomId, playerToken: mapping.playerToken };
    }

    return null;
  }

  leaveRoom({ roomId, playerToken }) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return { ok: false };
    }

    // Nếu là khán giả
    const specIdx = room.spectators.findIndex((s) => s.playerToken === playerToken);
    if (specIdx >= 0) {
      const [spec] = room.spectators.splice(specIdx, 1);
      if (spec.socketId) {
        this.socketToPlayer.delete(spec.socketId);
      }
      return { ok: true, roomId: room.roomId, roomDeleted: false };
    }

    const pIdx = room.players.findIndex((p) => p.playerToken === playerToken);
    if (pIdx === -1) {
      return { ok: false };
    }

    const [leavingPlayer] = room.players.splice(pIdx, 1);
    if (leavingPlayer.socketId) {
      this.socketToPlayer.delete(leavingPlayer.socketId);
    }

    this.addLog(room, `🚪 ${leavingPlayer.nickname} đã rời bàn.`);

    // Nếu bàn không còn ai -> Xóa phòng
    if (room.players.length === 0) {
      this.rooms.delete(room.roomId);
      return { ok: true, roomId: room.roomId, roomDeleted: true };
    }

    // Nếu Chủ phòng rời bàn -> Chuyển quyền Chủ phòng cho người ngồi đầu tiên còn lại
    if (room.hostToken === playerToken) {
      room.hostToken = room.players[0].playerToken;
      this.addLog(room, `👑 ${room.players[0].nickname} trở thành Chủ phòng mới.`);
    }

    // Nếu đang đếm ngược hoặc đang chơi mà chỉ còn 1 người thì kết thúc ván về WAITING
    if (room.status === 'COUNTDOWN') {
      room.status = 'WAITING';
      room.countdownSeconds = null;
    } else if (room.status === 'PLAYING') {
      if (room.players.length < 2) {
        this._finalizeRound(room, room.players[0]);
      } else if (room.currentTurnToken === playerToken) {
        const nextIdx = pIdx % room.players.length;
        room.currentTurnToken = room.players[nextIdx].playerToken;
      }
    }

    return { ok: true, roomId: room.roomId, roomDeleted: false };
  }

  leaveCurrentRoomByToken(playerToken, exceptRoomId = null) {
    for (const [rId, room] of this.rooms.entries()) {
      if (exceptRoomId && rId === exceptRoomId) continue;
      const inRoom =
        room.players.some((p) => p.playerToken === playerToken) ||
        room.spectators.some((s) => s.playerToken === playerToken);
      if (inRoom) {
        this.leaveRoom({ roomId: rId, playerToken });
      }
    }
  }

  getRoomStateForPlayer(roomId, viewerToken) {
    const room = this.rooms.get(String(roomId));
    if (!room) {
      return null;
    }

    const readiness = this.evaluateRoomReadiness(room);
    const me = room.players.find((p) => p.playerToken === viewerToken);
    const isSpectator = !me && room.spectators.some((s) => s.playerToken === viewerToken);

    return {
      roomId: room.roomId,
      roomName: room.roomName,
      hostToken: room.hostToken,
      status: room.status,
      countdownSeconds: room.countdownSeconds,
      roundNumber: room.roundNumber,
      currentTurnToken: room.currentTurnToken,
      requiredFirstCardId: room.requiredFirstCardId,
      requiredFirstCardLabel: room.requiredFirstCardLabel,
      currentTrick: room.currentTrick,
      tableHistory: room.tableHistory,
      rankings: room.rankings,
      logs: room.logs.slice(-15),
      readiness,
      myRole: me ? 'PLAYER' : isSpectator ? 'SPECTATOR' : 'VISITOR',
      myHand: me ? me.hand : [],
      players: room.players.map((p) => ({
        playerToken: p.playerToken,
        nickname: p.nickname,
        seatIndex: p.seatIndex,
        isHost: p.playerToken === room.hostToken,
        ready: p.ready,
        online: p.online,
        cardCount: p.hand.length,
        passedInRound: p.passedInRound,
        finishOrder: p.finishOrder,
        score: p.score,
      })),
      spectators: room.spectators.map((s) => ({
        playerToken: s.playerToken,
        nickname: s.nickname,
        online: s.online,
      })),
    };
  }

  addLog(room, message) {
    room.logs.push(message);
    if (room.logs.length > 40) {
      room.logs.shift();
    }
  }
}
