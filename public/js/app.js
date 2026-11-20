import { soundManager } from './audio.js';

const socket = window.io();

// Lưu playerToken trong sessionStorage để:
// 1) Bấm F5 tải lại trang vẫn giữ nguyên đúng ghế và bài trên tay
// 2) Mở 2-4 tab trên cùng 1 trình duyệt vẫn đóng vai được 2-4 người chơi độc lập
function getOrCreatePlayerToken() {
  let token = sessionStorage.getItem('tl_player_token');
  if (!token) {
    token = 'p_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    sessionStorage.setItem('tl_player_token', token);
  }
  return token;
}

const playerToken = getOrCreatePlayerToken();
let currentRoomId = null;
let currentRoomState = null;
let selectedCardIds = new Set();
let alertTimeout = null;
let lanBaseUrl = window.location.origin;

// DOM Elements
const lobbyView = document.getElementById('lobbyView');
const roomView = document.getElementById('roomView');
const inputNickname = document.getElementById('inputNickname');
const inputRoomName = document.getElementById('inputRoomName');
const inputRoomCode = document.getElementById('inputRoomCode');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinByCode = document.getElementById('btnJoinByCode');
const lobbyRoomsList = document.getElementById('lobbyRoomsList');
const lobbyCountBadge = document.getElementById('lobbyCountBadge');
const lanInfoBox = document.getElementById('lanInfoBox');
const lanUrlList = document.getElementById('lanUrlList');

const btnTestAlarm = document.getElementById('btnTestAlarm');
const btnToggleSound = document.getElementById('btnToggleSound');
const alertBanner = document.getElementById('alertBanner');
const alertBannerText = document.getElementById('alertBannerText');

const lblRoomCode = document.getElementById('lblRoomCode');
const lblRoomName = document.getElementById('lblRoomName');
const lblRoundBadge = document.getElementById('lblRoundBadge');
const btnCopyInvite = document.getElementById('btnCopyInvite');
const btnNudgeRoom = document.getElementById('btnNudgeRoom');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');

const seatTop = document.getElementById('seatTop');
const seatLeft = document.getElementById('seatLeft');
const seatRight = document.getElementById('seatRight');
const seatBottom = document.getElementById('seatBottom');

const waitingCenterBox = document.getElementById('waitingCenterBox');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const waitingTitle = document.getElementById('waitingTitle');
const waitingInstruction = document.getElementById('waitingInstruction');
const rankingsBox = document.getElementById('rankingsBox');
const rankingsList = document.getElementById('rankingsList');
const btnReadyToggle = document.getElementById('btnReadyToggle');
const btnHostStart = document.getElementById('btnHostStart');

const playingCenterBox = document.getElementById('playingCenterBox');
const turnBanner = document.getElementById('turnBanner');
const requiredCardHint = document.getElementById('requiredCardHint');
const trickZone = document.getElementById('trickZone');

const playControlsBar = document.getElementById('playControlsBar');
const selectedComboHint = document.getElementById('selectedComboHint');
const btnClearSelection = document.getElementById('btnClearSelection');
const btnPassTurn = document.getElementById('btnPassTurn');
const btnPlayCards = document.getElementById('btnPlayCards');
const myHandContainer = document.getElementById('myHandContainer');

const roomLogList = document.getElementById('roomLogList');
const spectatorBadge = document.getElementById('spectatorBadge');

// Khởi tạo Nickname ban đầu
const savedNick =
  sessionStorage.getItem('tl_nickname') ||
  localStorage.getItem('tl_nickname') ||
  `Người chơi ${Math.floor(100 + Math.random() * 900)}`;
inputNickname.value = savedNick;

function getNickname() {
  const val = inputNickname.value.trim() || savedNick;
  inputNickname.value = val;
  sessionStorage.setItem('tl_nickname', val);
  localStorage.setItem('tl_nickname', val);
  return val;
}

inputNickname.addEventListener('change', getNickname);

// Cập nhật nút Âm thanh
function updateSoundButtonUI() {
  if (soundManager.muted) {
    btnToggleSound.textContent = '🔇 Âm thanh: ĐÃ TẮT';
    btnToggleSound.setAttribute('aria-pressed', 'true');
  } else {
    btnToggleSound.textContent = '🔊 Âm thanh: BẬT';
    btnToggleSound.setAttribute('aria-pressed', 'false');
  }
}
updateSoundButtonUI();

btnToggleSound.addEventListener('click', () => {
  soundManager.unlockAudio();
  soundManager.toggleMute();
  updateSoundButtonUI();
  if (!soundManager.muted) {
    soundManager.playJoinSound();
  }
});

btnTestAlarm.addEventListener('click', () => {
  soundManager.unlockAudio();
  if (soundManager.muted) {
    soundManager.setMuted(false);
    updateSoundButtonUI();
  }
  soundManager.playRoomFullAlarm();
  showAlertBanner('🔔 Đang phát thử: Chuông báo động khi phòng đủ 4/4 người chơi!');
});

function showAlertBanner(message, durationMs = 5500) {
  alertBannerText.textContent = message;
  alertBanner.classList.remove('hidden');
  if (alertTimeout) clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    alertBanner.classList.add('hidden');
  }, durationMs);
}

// Lấy thông tin IP LAN để hiển thị link mời nội bộ
fetch('/api/network-info')
  .then((r) => r.json())
  .then((info) => {
    if (info.lanUrls && info.lanUrls.length > 0) {
      lanBaseUrl = info.lanUrls[0];
      lanInfoBox.classList.remove('hidden');
      lanUrlList.textContent = info.lanUrls.join('  |  ');
    }
  })
  .catch(() => {});

// Xử lý Tạo Bàn Mới
btnCreateRoom.addEventListener('click', () => {
  soundManager.unlockAudio();
  const nickname = getNickname();
  const roomName = inputRoomName.value.trim();

  socket.emit('room:create', { playerToken, nickname, roomName }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`❌ ${res?.error || 'Không thể tạo bàn'}`);
      return;
    }
    enterRoomUI(res.roomId, res.state);
    soundManager.playJoinSound();
  });
});

// Xử lý Vào Bàn Bằng Mã 4 Số
btnJoinByCode.addEventListener('click', () => {
  const code = inputRoomCode.value.trim();
  if (!/^\d{4}$/.test(code)) {
    showAlertBanner('⚠️ Vui lòng nhập đúng Mã phòng gồm 4 chữ số!');
    inputRoomCode.focus();
    return;
  }
  joinRoomById(code);
});

inputRoomCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnJoinByCode.click();
  }
});

function joinRoomById(roomId) {
  soundManager.unlockAudio();
  const nickname = getNickname();

  socket.emit('room:join', { roomId, playerToken, nickname }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`❌ ${res?.error || 'Không thể vào bàn'}`);
      // Xóa query param ?room= nếu phòng không tồn tại
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    enterRoomUI(res.roomId, res.state);
  });
}

function enterRoomUI(roomId, initialState) {
  currentRoomId = roomId;
  selectedCardIds.clear();
  window.history.replaceState({}, '', `?room=${roomId}`);
  lobbyView.classList.add('hidden');
  roomView.classList.remove('hidden');
  if (initialState) {
    renderRoomState(initialState);
  }
}

function leaveRoomToLobby() {
  if (!currentRoomId) return;
  socket.emit('room:leave', { roomId: currentRoomId, playerToken }, () => {
    currentRoomId = null;
    currentRoomState = null;
    selectedCardIds.clear();
    window.history.replaceState({}, '', window.location.pathname);
    roomView.classList.add('hidden');
    lobbyView.classList.remove('hidden');
  });
}

btnLeaveRoom.addEventListener('click', leaveRoomToLobby);

// Copy Link Mời trực tiếp (?room=XXXX)
btnCopyInvite.addEventListener('click', async () => {
  if (!currentRoomId) return;
  const originToUse =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? lanBaseUrl
      : window.location.origin;
  const inviteUrl = `${originToUse}/?room=${currentRoomId}`;

  try {
    await navigator.clipboard.writeText(inviteUrl);
    showAlertBanner(`📋 Đã copy link mời: ${inviteUrl} — Gửi cho bạn bè click là vào thẳng bàn!`);
  } catch {
    window.prompt('Copy link mời dưới đây gửi cho bạn bè:', inviteUrl);
  }
});

// Nút Gõ bàn gọi bạn
btnNudgeRoom.addEventListener('click', () => {
  if (!currentRoomId) return;
  soundManager.unlockAudio();
  socket.emit('room:nudge', { roomId: currentRoomId, playerToken });
});

// Nút Bấm Sẵn sàng / Hủy Sẵn sàng
btnReadyToggle.addEventListener('click', () => {
  if (!currentRoomId || !currentRoomState) return;
  soundManager.unlockAudio();

  const me = currentRoomState.players.find((p) => p.playerToken === playerToken);
  const nextReady = me ? !me.ready : true;

  socket.emit('room:ready', { roomId: currentRoomId, playerToken, ready: nextReady }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`⚠️ ${res?.error || 'Không thể đổi trạng thái Sẵn sàng'}`);
    }
  });
});

// Nút Chủ phòng bấm Bắt đầu chia bài (Cách 1)
btnHostStart.addEventListener('click', () => {
  if (!currentRoomId) return;
  soundManager.unlockAudio();

  socket.emit('room:start', { roomId: currentRoomId, playerToken }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`⚠️ ${res?.error || 'Chưa đủ điều kiện chia bài'}`);
    }
  });
});

// Nút Bỏ chọn bài
btnClearSelection.addEventListener('click', () => {
  selectedCardIds.clear();
  renderMyHand();
});

// Nút Đánh bài
btnPlayCards.addEventListener('click', () => {
  if (!currentRoomId || selectedCardIds.size === 0) return;
  soundManager.unlockAudio();

  const cardIds = Array.from(selectedCardIds);
  socket.emit('game:play', { roomId: currentRoomId, playerToken, cardIds }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`⚠️ ${res?.error || 'Nước đánh không hợp lệ'}`);
      return;
    }
    selectedCardIds.clear();
  });
});

// Nút Bỏ lượt
btnPassTurn.addEventListener('click', () => {
  if (!currentRoomId) return;
  soundManager.unlockAudio();

  socket.emit('game:pass', { roomId: currentRoomId, playerToken }, (res) => {
    if (!res?.ok) {
      showAlertBanner(`⚠️ ${res?.error || 'Không thể bỏ lượt'}`);
    }
  });
});

// Render Sảnh chờ trực tiếp (Live Lobby)
socket.on('lobby:update', (rooms = []) => {
  lobbyCountBadge.textContent = `${rooms.length} bàn đang mở`;

  if (rooms.length === 0) {
    lobbyRoomsList.innerHTML = `
      <div class="empty-lobby" role="status">
        <p><strong>Chưa có bàn nào đang mở trong sảnh.</strong></p>
        <p>Hãy nhập tên bàn bên trái và bấm <strong>➕ Tạo Bàn</strong> để mở sảnh rủ anh em!</p>
      </div>
    `;
    return;
  }

  lobbyRoomsList.innerHTML = '';
  rooms.forEach((r) => {
    const isFull = r.playerCount >= r.maxPlayers;
    const isPlaying = r.status === 'PLAYING';
    const statusText = isPlaying
      ? `🃏 Đang đánh ván #${r.roundNumber}`
      : isFull
      ? '🔔 Đủ 4/4 chân (Sắp đánh)'
      : `⏳ Đang chờ (${r.playerCount}/${r.maxPlayers} người)`;

    const card = document.createElement('div');
    card.className = 'room-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <div>
        <div class="room-card-header">
          <span class="room-card-code">BÀN #${escapeHtml(r.roomId)}</span>
          <span class="badge ${isFull ? 'badge-gold' : 'badge-subtle'}">${r.playerCount}/${r.maxPlayers} ghế</span>
        </div>
        <div class="room-card-name">${escapeHtml(r.roomName)}</div>
        <div class="room-card-meta">
          <span>👑 Chủ bàn: <strong>${escapeHtml(r.hostNickname)}</strong></span>
          <span>Trạng thái: ${statusText}</span>
        </div>
      </div>
      <button type="button" class="btn ${isPlaying || isFull ? 'btn-secondary' : 'btn-primary'} btn-join-room">
        ${isPlaying || isFull ? '👀 Vào Xem / Chờ Ván Sau' : '🪑 Vào Ngồi Ngay'}
      </button>
    `;

    card.querySelector('.btn-join-room').addEventListener('click', () => {
      joinRoomById(r.roomId);
    });

    lobbyRoomsList.appendChild(card);
  });
});

// Nhận sự kiện Âm thanh & Thông báo từ Phòng
socket.on('room:alert', (alert) => {
  if (!alert) return;

  switch (alert.type) {
    case 'ROOM_FULL_4':
      soundManager.playRoomFullAlarm();
      soundManager.triggerUrgentTabAlert(
        '🔔 [4/4 ĐỦ NGƯỜI!]',
        `🃏 Bàn #${currentRoomId} đã đủ 4/4 người!`,
        alert.message || 'Quay lại bàn bấm Sẵn sàng để chia bài ngay!'
      );
      showAlertBanner(alert.message, 8000);
      break;

    case 'PLAYER_JOINED':
    case 'SPECTATOR_JOINED':
      soundManager.playJoinSound();
      showAlertBanner(alert.message, 4000);
      break;

    case 'NUDGE':
      soundManager.playNudgeSound();
      soundManager.triggerUrgentTabAlert(
        '🔔 [CÓ NGƯỜI GÕ BÀN!]',
        `🔔 Bàn #${currentRoomId}`,
        alert.message
      );
      showAlertBanner(alert.message, 5000);
      break;

    case 'COUNTDOWN_TICK':
      soundManager.playCountdownBeep(alert.secondsLeft);
      break;

    case 'COUNTDOWN_CANCELLED':
      showAlertBanner(alert.message, 4000);
      break;

    case 'GAME_STARTED':
      soundManager.playGameStartSound();
      soundManager.triggerUrgentTabAlert(
        '🃏 [ĐÃ CHIA BÀI!]',
        `🃏 Bàn #${currentRoomId} đã chia bài!`,
        alert.message
      );
      showAlertBanner(alert.message, 4000);
      break;

    case 'CARD_PLAYED':
      soundManager.playCardSound();
      break;

    case 'CHOP':
      soundManager.playChopSound();
      showAlertBanner(alert.message, 5500);
      break;

    case 'PASS':
      soundManager.playPassSound();
      break;

    case 'GAME_ENDED':
      soundManager.playWinSound();
      showAlertBanner(alert.message, 6000);
      break;
  }
});

// Nhận cập nhật Trạng thái Phòng
socket.on('room:state', (state) => {
  if (!state) return;
  currentRoomState = state;
  renderRoomState(state);
});

function renderRoomState(state) {
  lblRoomCode.textContent = state.roomId;
  lblRoomName.textContent = state.roomName;
  lblRoundBadge.textContent =
    state.status === 'PLAYING'
      ? `Đang đánh Ván #${state.roundNumber}`
      : state.roundNumber > 0
      ? `Nghỉ giữa ván (Đã chơi ${state.roundNumber} ván)`
      : 'Phòng chờ';

  // Hiển thị số khán giả
  if (state.spectators && state.spectators.length > 0) {
    spectatorBadge.classList.remove('hidden');
    spectatorBadge.textContent = `👀 Khán giả: ${state.spectators.map((s) => s.nickname).join(', ')}`;
  } else {
    spectatorBadge.classList.add('hidden');
  }

  // Render 4 ghế xoay quanh góc nhìn của người chơi hiện tại
  renderFourSeats(state);

  // Render khu vực Tâm Bàn tùy theo trạng thái WAITING/COUNTDOWN hay PLAYING
  if (state.status === 'WAITING' || state.status === 'COUNTDOWN') {
    waitingCenterBox.classList.remove('hidden');
    playingCenterBox.classList.add('hidden');
    playControlsBar.classList.add('hidden');
    renderWaitingCenter(state);
  } else {
    waitingCenterBox.classList.add('hidden');
    playingCenterBox.classList.remove('hidden');
    renderPlayingCenter(state);
  }

  // Render bài trên tay của tôi
  renderMyHand();

  // Render nhật ký bàn chơi
  roomLogList.innerHTML = (state.logs || [])
    .slice()
    .reverse()
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');
}

function renderFourSeats(state) {
  const players = state.players || [];
  const myIndex = players.findIndex((p) => p.playerToken === playerToken);

  // Xác định người ngồi ở 4 vị trí: Bottom (Tôi), Right, Top, Left theo chiều đánh
  let orderedForView = [null, null, null, null];
  if (myIndex >= 0) {
    for (let offset = 0; offset < 4; offset++) {
      orderedForView[offset] = players[myIndex + offset] || null;
    }
    // Xoay vòng để tôi luôn ở ghế Bottom (vị trí 0)
    orderedForView = [0, 1, 2, 3].map((offset) => {
      // Nếu bàn có <= 4 người, sắp theo seatIndex tương đối
      return players.find((p) => (p.seatIndex - players[myIndex].seatIndex + 4) % 4 === offset) || null;
    });
  } else {
    for (let s = 0; s < 4; s++) {
      orderedForView[s] = players.find((p) => p.seatIndex === s) || null;
    }
  }

  // Nếu bàn chỉ có 2 người, để đối thủ ngồi ở ghế Top (đối diện) cho đẹp mắt
  if (players.length === 2 && myIndex >= 0) {
    const me = players[myIndex];
    const opponent = players.find((p) => p.playerToken !== playerToken) || null;
    orderedForView = [me, null, opponent, null];
  }

  seatBottom.innerHTML = renderSeatCardHTML(orderedForView[0], state, 'Ghế của bạn');
  seatRight.innerHTML = renderSeatCardHTML(orderedForView[1], state, 'Ghế Phải (Trống)');
  seatTop.innerHTML = renderSeatCardHTML(orderedForView[2], state, 'Ghế Đối Diện (Trống)');
  seatLeft.innerHTML = renderSeatCardHTML(orderedForView[3], state, 'Ghế Trái (Trống)');
}

function renderSeatCardHTML(player, state, emptyLabel) {
  if (!player) {
    return `
      <div class="seat-card seat-empty">
        <div>🪑 ${escapeHtml(emptyLabel)}</div>
        <div>Đang chờ người vào...</div>
      </div>
    `;
  }

  const isMe = player.playerToken === playerToken;
  const isTurn = state.status === 'PLAYING' && state.currentTurnToken === player.playerToken;
  const rankNames = { 1: '🏆 Nhất', 2: '🥈 Nhì', 3: '🥉 Ba', 4: '💀 Bét' };

  let statusPill = '';
  if (state.status !== 'PLAYING') {
    statusPill = player.ready
      ? '<span class="status-pill pill-ready">✅ SẴN SÀNG</span>'
      : '<span class="status-pill pill-unready">⏳ Chưa sẵn sàng</span>';
  } else if (player.finishOrder) {
    statusPill = `<span class="status-pill pill-rank">${rankNames[player.finishOrder] || `Hạng ${player.finishOrder}`}</span>`;
  } else if (player.passedInRound) {
    statusPill = '<span class="status-pill pill-pass">⏭️ Đã bỏ lượt</span>';
  } else {
    statusPill = `<span class="status-pill pill-ready">🂠 Còn ${player.cardCount} lá</span>`;
  }

  return `
    <div class="seat-card ${isTurn ? 'active-turn' : ''}">
      <div class="seat-header-line">
        <span>
          ${player.isHost ? '👑 ' : ''}${escapeHtml(player.nickname)}${isMe ? ' (Bạn)' : ''}
        </span>
        <span title="${player.online ? 'Đang trực tuyến' : 'Tạm mất kết nối'}">
          ${player.online ? '🟢' : '🔴'}
        </span>
      </div>
      <div class="seat-badges-line">
        <span>Điểm: <strong>${player.score}</strong></span>
        ${statusPill}
      </div>
    </div>
  `;
}

function renderWaitingCenter(state) {
  const { totalPlayers, readyCount, canHostStart } = state.readiness || {
    totalPlayers: state.players.length,
    readyCount: 0,
    canHostStart: false,
  };
  const me = state.players.find((p) => p.playerToken === playerToken);
  const amHost = state.hostToken === playerToken;

  // Countdown overlay
  if (state.status === 'COUNTDOWN' && state.countdownSeconds !== null) {
    countdownOverlay.classList.remove('hidden');
    countdownNumber.textContent = state.countdownSeconds;
  } else {
    countdownOverlay.classList.add('hidden');
  }

  // Bảng kết quả ván trước (nếu có)
  if (state.rankings && state.rankings.length > 0) {
    rankingsBox.classList.remove('hidden');
    rankingsList.innerHTML = state.rankings
      .map(
        (r) => `
        <div class="ranking-row">
          <span><strong>#${r.place} (${escapeHtml(r.rankTitle)})</strong> — ${escapeHtml(r.nickname)}</span>
          <span>${r.scoreDelta >= 0 ? `+${r.scoreDelta}` : r.scoreDelta} đ (Tổng: ${r.totalScore})</span>
        </div>
      `
      )
      .join('');
  } else {
    rankingsBox.classList.add('hidden');
  }

  // Hướng dẫn theo Cách 1
  if (totalPlayers < 2) {
    waitingTitle.textContent = `Đang chờ thêm người chơi (${totalPlayers}/4 người)...`;
    waitingInstruction.textContent =
      'Hãy bấm nút "📋 Copy Link Mời Bạn" ở góc trên để gửi cho bạn bè hoặc bảo bạn vào từ Sảnh chờ.';
  } else if (totalPlayers === 4) {
    waitingTitle.textContent = `🔔 ĐÃ ĐỦ 4/4 CHÂN! (Đã sẵn sàng: ${readyCount}/4)`;
    waitingInstruction.textContent =
      'Khi cả 4/4 người cùng bấm nút [SẴN SÀNG], hệ thống sẽ tự động đếm ngược 3 giây và chia bài!';
  } else {
    waitingTitle.textContent = `Đã có ${totalPlayers}/4 người trong bàn (Sẵn sàng: ${readyCount}/${totalPlayers})`;
    waitingInstruction.textContent = canHostStart
      ? '✅ 100% người trong bàn đã Sẵn sàng! Chủ phòng có thể bấm [🃏 BẮT ĐẦU CHIA BÀI] ngay hoặc chờ thêm người thứ 4.'
      : 'Tất cả người chơi trong bàn hãy bấm [SẴN SÀNG]. Khi 100% đã Sẵn sàng, Chủ phòng sẽ mở khóa nút Chia bài.';
  }

  // Nút Sẵn sàng của bản thân
  if (me) {
    btnReadyToggle.classList.remove('hidden');
    if (me.ready) {
      btnReadyToggle.textContent = '↩️ HỦY SẴN SÀNG (Đang Sẵn sàng ✅)';
      btnReadyToggle.classList.add('is-ready');
    } else {
      btnReadyToggle.textContent = '✅ BẤM SẴN SÀNG';
      btnReadyToggle.classList.remove('is-ready');
    }
  } else {
    btnReadyToggle.classList.add('hidden');
  }

  // Nút Chủ phòng bấm Chia bài (Cách 1)
  if (amHost) {
    btnHostStart.classList.remove('hidden');
    btnHostStart.disabled = !canHostStart || state.status === 'COUNTDOWN';
    btnHostStart.textContent = canHostStart
      ? `🃏 BẮT ĐẦU CHIA BÀI (${totalPlayers} NGƯỜI)`
      : `🃏 Chờ đủ người bấm Sẵn sàng (${readyCount}/${Math.max(2, totalPlayers)})`;
  } else {
    btnHostStart.classList.add('hidden');
  }
}

function renderPlayingCenter(state) {
  const isMyTurn = state.currentTurnToken === playerToken;
  const turnPlayer = state.players.find((p) => p.playerToken === state.currentTurnToken);

  if (isMyTurn) {
    turnBanner.textContent = '🎯 TỚI LƯỢT CỦA BẠN! Hãy chọn bài và bấm Đánh Bài.';
    turnBanner.classList.add('my-turn');
    playControlsBar.classList.remove('hidden');
    btnPlayCards.disabled = false;
    btnPassTurn.disabled = !state.currentTrick; // Không được bỏ lượt nếu đang mở vòng mới
  } else {
    turnBanner.textContent = `⏳ Đang tới lượt của: ${turnPlayer ? turnPlayer.nickname : '...'}`;
    turnBanner.classList.remove('my-turn');
    if (state.myRole === 'PLAYER') {
      playControlsBar.classList.remove('hidden');
      btnPlayCards.disabled = true;
      btnPassTurn.disabled = true;
    } else {
      playControlsBar.classList.add('hidden');
    }
  }

  // Nhắc đánh lá nhỏ nhất ở lượt đầu tiên của ván đầu
  if (state.requiredFirstCardLabel) {
    requiredCardHint.classList.remove('hidden');
    requiredCardHint.textContent = `💡 Lượt mở màn ván đầu: Bắt buộc đánh bộ bài có chứa lá ${state.requiredFirstCardLabel}`;
  } else {
    requiredCardHint.classList.add('hidden');
  }

  // Render bài vừa đánh trên bàn
  if (!state.currentTrick) {
    trickZone.innerHTML = `<div class="trick-empty">✨ Bàn trống (Vòng mới) — Người tới lượt được ra bất kỳ bộ hợp lệ nào!</div>`;
  } else {
    const trick = state.currentTrick;
    const cardsHtml = (trick.cards || [])
      .map((card) => createCardElementHTML(card, false, true))
      .join('');
    trickZone.innerHTML = `
      <div class="trick-meta">
        ${escapeHtml(trick.nickname)} vừa đánh: <strong>${escapeHtml(trick.label)}</strong>
        ${trick.chopNote ? ` — <span>${escapeHtml(trick.chopNote)}</span>` : ''}
      </div>
      <div class="trick-cards-row">${cardsHtml}</div>
    `;
  }
}

function renderMyHand() {
  const hand = currentRoomState?.myHand || [];
  // Xóa các lá đã chọn nếu không còn trên tay
  const handIds = new Set(hand.map((c) => c.id));
  for (const id of selectedCardIds) {
    if (!handIds.has(id)) {
      selectedCardIds.delete(id);
    }
  }

  if (hand.length === 0) {
    myHandContainer.innerHTML =
      currentRoomState?.status === 'PLAYING'
        ? '<div class="trick-empty">🎉 Bạn đã đánh hết bài trên tay!</div>'
        : '<div class="trick-empty">Bài của bạn sẽ xuất hiện tại đây ngay khi chia bài.</div>';
    updateSelectedComboHint(hand);
    return;
  }

  myHandContainer.innerHTML = '';
  hand.forEach((card) => {
    const isSelected = selectedCardIds.has(card.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `playing-card color-${card.color} ${isSelected ? 'selected' : ''}`;
    btn.setAttribute('aria-label', `Lá bài ${card.label}`);
    btn.setAttribute('aria-pressed', String(isSelected));
    btn.innerHTML = `
      <div class="card-corner-top">
        <span class="card-rank">${escapeHtml(card.rank)}</span>
        <span class="card-suit-sm">${escapeHtml(card.suitSymbol)}</span>
      </div>
      <div class="card-center-suit">${escapeHtml(card.suitSymbol)}</div>
    `;

    btn.addEventListener('click', () => {
      if (selectedCardIds.has(card.id)) {
        selectedCardIds.delete(card.id);
      } else {
        selectedCardIds.add(card.id);
      }
      renderMyHand();
    });

    myHandContainer.appendChild(btn);
  });

  updateSelectedComboHint(hand);
}

function createCardElementHTML(card, isSelected = false, isTableCard = false) {
  return `
    <div class="playing-card color-${card.color} ${isSelected ? 'selected' : ''} ${isTableCard ? 'table-card' : ''}">
      <div class="card-corner-top">
        <span class="card-rank">${escapeHtml(card.rank)}</span>
        <span class="card-suit-sm">${escapeHtml(card.suitSymbol)}</span>
      </div>
      <div class="card-center-suit">${escapeHtml(card.suitSymbol)}</div>
    </div>
  `;
}

function updateSelectedComboHint(hand) {
  if (!selectedComboHint) return;
  const selected = hand
    .filter((c) => selectedCardIds.has(c.id))
    .sort((a, b) => a.power - b.power);

  if (selected.length === 0) {
    selectedComboHint.textContent = 'Chọn các lá bài bên dưới để đánh';
    return;
  }

  const labels = selected.map((c) => c.label).join(' ');
  selectedComboHint.textContent = `Đang chọn (${selected.length} lá): ${labels}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tự động vào phòng nếu mở từ Link mời (?room=XXXX) hoặc khi F5 trang trong phòng
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const invitedRoom = params.get('room');
  if (invitedRoom && /^\d{4}$/.test(invitedRoom.trim())) {
    inputRoomCode.value = invitedRoom.trim();
    joinRoomById(invitedRoom.trim());
  }
});
