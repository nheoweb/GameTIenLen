(function (window, document) {
  'use strict';

  const root = document.getElementById('tlmnAppRoot');
  if (!root) return;

  const config = window.TLMN_CONFIG || {};
  const soundManager = window.TLMN_SoundManager;
  const REST_BASE = String(config.restBase || '/wp-json/tien-len/v1').replace(/\/+$/, '');
  const POLL_ROOM_MS = Number(config.pollRoomMs) || 900;
  const POLL_LOBBY_MS = Number(config.pollLobbyMs) || 2500;

  // Lưu playerToken trong sessionStorage để:
  // 1) Bấm F5 tải lại trang vẫn giữ nguyên đúng ghế và bài trên tay
  // 2) Mở 2-4 tab trên cùng 1 trình duyệt vẫn đóng vai được 2-4 người chơi độc lập
  function getOrCreatePlayerToken() {
    let token = '';
    try {
      token = sessionStorage.getItem('tl_player_token') || '';
    } catch (e) {
      token = '';
    }
    if (!token) {
      let randPart = '';
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(6);
        window.crypto.getRandomValues(bytes);
        randPart = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      } else {
        randPart = Math.random().toString(36).slice(2, 12);
      }
      token = 'p_' + randPart + '_' + Date.now().toString(36);
      try {
        sessionStorage.setItem('tl_player_token', token);
      } catch (e) {
        // Bỏ qua nếu storage bị chặn
      }
    }
    return token;
  }

  const playerToken = getOrCreatePlayerToken();
  let currentRoomId = null;
  let currentRoomState = null;
  let lastRoomVersion = 0;
  let lastSeenEventId = 0;
  let lastCountdownSeconds = null;
  let selectedCardIds = new Set();
  let alertTimeout = null;
  let pollTimer = null;
  let pollGeneration = 0;
  let hbCounter = 0;
  let isActionBusy = false;
  let isChatBusy = false;
  let banterTimeout = null;
  let lastRenderedChatId = -1;
  let lastLocalChatSoundAt = 0;
  const seatBubbles = {}; // playerToken -> { text, expiresAt }

  // DOM Elements (scoped trong root)
  const $ = (id) => document.getElementById(id);

  const lobbyView = $('lobbyView');
  const roomView = $('roomView');
  const inputNickname = $('inputNickname');
  const inputRoomName = $('inputRoomName');
  const inputRoomCode = $('inputRoomCode');
  const btnCreateRoom = $('btnCreateRoom');
  const btnJoinByCode = $('btnJoinByCode');
  const lobbyRoomsList = $('lobbyRoomsList');
  const lobbyCountBadge = $('lobbyCountBadge');
  const shareLobbyUrlText = $('shareLobbyUrlText');
  const btnCopyLobbyUrl = $('btnCopyLobbyUrl');

  const btnTestAlarm = $('btnTestAlarm');
  const btnToggleSound = $('btnToggleSound');
  const alertBanner = $('alertBanner');
  const alertBannerText = $('alertBannerText');

  const lblRoomCode = $('lblRoomCode');
  const lblRoomName = $('lblRoomName');
  const lblRoundBadge = $('lblRoundBadge');
  const btnCopyInvite = $('btnCopyInvite');
  const btnNudgeRoom = $('btnNudgeRoom');
  const btnLeaveRoom = $('btnLeaveRoom');

  const seatTop = $('seatTop');
  const seatLeft = $('seatLeft');
  const seatRight = $('seatRight');
  const seatBottom = $('seatBottom');

  const waitingCenterBox = $('waitingCenterBox');
  const countdownOverlay = $('countdownOverlay');
  const countdownNumber = $('countdownNumber');
  const waitingTitle = $('waitingTitle');
  const waitingInstruction = $('waitingInstruction');
  const rankingsBox = $('rankingsBox');
  const rankingsList = $('rankingsList');
  const btnReadyToggle = $('btnReadyToggle');
  const btnHostStart = $('btnHostStart');

  const playingCenterBox = $('playingCenterBox');
  const turnBanner = $('turnBanner');
  const requiredCardHint = $('requiredCardHint');
  const trickZone = $('trickZone');

  const playControlsBar = $('playControlsBar');
  const selectedComboHint = $('selectedComboHint');
  const btnClearSelection = $('btnClearSelection');
  const btnPassTurn = $('btnPassTurn');
  const btnPlayCards = $('btnPlayCards');
  const myHandContainer = $('myHandContainer');

  const roomLogList = $('roomLogList');
  const spectatorBadge = $('spectatorBadge');
  const banterCalloutBox = $('banterCalloutBox');
  const chatMessagesList = $('chatMessagesList');
  const quickVoiceBar = $('quickVoiceBar');
  const emojiPickerBar = $('emojiPickerBar');
  const inputChatMessage = $('inputChatMessage');
  const btnSendChat = $('btnSendChat');

  // Helper xây dựng URL REST API chuẩn cho cả Pretty Permalink và ?rest_route=
  function buildApiUrl(path, queryParams) {
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    let url = REST_BASE + cleanPath;
    if (queryParams && typeof queryParams === 'object') {
      const searchParts = [];
      Object.keys(queryParams).forEach((key) => {
        const val = queryParams[key];
        if (val !== undefined && val !== null) {
          searchParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)));
        }
      });
      if (searchParts.length > 0) {
        url += (url.indexOf('?') === -1 ? '?' : '&') + searchParts.join('&');
      }
    }
    return url;
  }

  async function apiGet(path, queryParams) {
    const params = Object.assign({}, queryParams || {}, { _t: Date.now() });
    const resp = await fetch(buildApiUrl(path, params), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    return resp.json();
  }

  async function apiPost(path, body) {
    const resp = await fetch(buildApiUrl(path), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    return resp.json();
  }

  function getCleanPageUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    return url.toString();
  }

  function setUrlRoomParam(roomId) {
    try {
      const url = new URL(window.location.href);
      if (roomId) {
        url.searchParams.set('room', roomId);
      } else {
        url.searchParams.delete('room');
      }
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      // Bỏ qua nếu môi trường chặn replaceState
    }
  }

  // Hiển thị link sảnh chơi
  if (shareLobbyUrlText) {
    shareLobbyUrlText.textContent = getCleanPageUrl();
  }
  if (btnCopyLobbyUrl) {
    btnCopyLobbyUrl.addEventListener('click', async () => {
      const url = getCleanPageUrl();
      try {
        await navigator.clipboard.writeText(url);
        showAlertBanner('📋 Đã copy link sảnh chơi! Gửi cho bạn bè vào chơi ngay.');
      } catch (e) {
        window.prompt('Copy link sảnh chơi dưới đây:', url);
      }
    });
  }

  // Khởi tạo Nickname ban đầu (ưu tiên tên đã lưu -> tên tài khoản WordPress -> tên ngẫu nhiên)
  function loadInitialNickname() {
    try {
      const sNick = sessionStorage.getItem('tl_nickname');
      if (sNick) return sNick;
      const lNick = localStorage.getItem('tl_nickname');
      if (lNick) return lNick;
    } catch (e) {
      // Bỏ qua
    }
    if (config.wpUserName && String(config.wpUserName).trim()) {
      return String(config.wpUserName).trim().slice(0, 20);
    }
    return 'Người chơi ' + Math.floor(100 + Math.random() * 900);
  }

  const defaultNick = loadInitialNickname();
  inputNickname.value = defaultNick;

  function getNickname() {
    const val = inputNickname.value.trim() || defaultNick;
    inputNickname.value = val;
    try {
      sessionStorage.setItem('tl_nickname', val);
      localStorage.setItem('tl_nickname', val);
    } catch (e) {
      // Bỏ qua
    }
    return val;
  }

  inputNickname.addEventListener('change', getNickname);

  // Nút Âm thanh
  function updateSoundButtonUI() {
    if (!soundManager) return;
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
    if (!soundManager) return;
    soundManager.unlockAudio();
    soundManager.toggleMute();
    updateSoundButtonUI();
    if (!soundManager.muted) {
      soundManager.playJoinSound();
    }
  });

  btnTestAlarm.addEventListener('click', () => {
    if (!soundManager) return;
    soundManager.unlockAudio();
    if (soundManager.muted) {
      soundManager.setMuted(false);
      updateSoundButtonUI();
    }
    soundManager.playRoomFullAlarm();
    showAlertBanner('🔔 Đang phát thử: Chuông báo động khi phòng đủ 4/4 người chơi!');
  });

  function showAlertBanner(message, durationMs) {
    const ms = durationMs || 5500;
    alertBannerText.textContent = message;
    alertBanner.classList.remove('hidden');
    if (alertTimeout) clearTimeout(alertTimeout);
    alertTimeout = setTimeout(() => {
      alertBanner.classList.add('hidden');
    }, ms);
  }

  function showBanterCallout(speakerName, text, durationMs) {
    if (!banterCalloutBox) return;
    const ms = durationMs || 4200;
    banterCalloutBox.textContent = (speakerName ? speakerName + ': ' : '') + text;
    banterCalloutBox.classList.remove('hidden');
    if (banterTimeout) clearTimeout(banterTimeout);
    banterTimeout = setTimeout(() => {
      banterCalloutBox.classList.add('hidden');
    }, ms);
  }

  function setSeatBubble(pToken, text, durationMs) {
    if (!pToken || !text) return;
    const ms = durationMs || 4500;
    seatBubbles[pToken] = {
      text: text,
      expiresAt: Date.now() + ms,
    };
    if (currentRoomState) {
      renderFourSeats(currentRoomState);
    }
    setTimeout(() => {
      if (seatBubbles[pToken] && Date.now() >= seatBubbles[pToken].expiresAt) {
        delete seatBubbles[pToken];
        if (currentRoomState) {
          renderFourSeats(currentRoomState);
        }
      }
    }, ms + 60);
  }

  // ==================== SMART POLLING ====================

  function stopPolling() {
    pollGeneration += 1;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function startLobbyPolling() {
    stopPolling();
    const myGen = pollGeneration;

    async function tick() {
      if (myGen !== pollGeneration || currentRoomId) return;
      try {
        const res = await apiGet('/lobby');
        if (myGen !== pollGeneration || currentRoomId) return;
        if (res && res.ok && Array.isArray(res.rooms)) {
          renderLobbyRooms(res.rooms);
        }
      } catch (e) {
        // Mạng chập chờn: tự thử lại ở nhịp tiếp theo
      }
      if (myGen !== pollGeneration || currentRoomId) return;
      const delay = document.hidden ? 6000 : POLL_LOBBY_MS;
      pollTimer = setTimeout(tick, delay);
    }

    tick();
  }

  function startRoomPolling() {
    stopPolling();
    const myGen = pollGeneration;
    hbCounter = 0;

    async function tick() {
      if (myGen !== pollGeneration || !currentRoomId) return;
      const roomIdSnapshot = currentRoomId;
      hbCounter += 1;
      const sendHb = hbCounter % 4 === 0 ? 1 : 0;

      try {
        const res = await apiGet('/rooms/' + roomIdSnapshot, {
          token: playerToken,
          version: lastRoomVersion,
          sinceEventId: lastSeenEventId,
          hb: sendHb,
        });

        if (myGen !== pollGeneration || currentRoomId !== roomIdSnapshot) return;

        if (res && res.deleted) {
          showAlertBanner('ℹ️ Bàn chơi đã đóng, đưa bạn về sảnh chờ.');
          resetToLobbyUI();
          return;
        }

        if (res && res.ok && !res.unchanged && res.state) {
          applyRoomState(res.state, true);
        }
      } catch (e) {
        // Mạng chập chờn: tự thử lại ở nhịp tiếp theo
      }

      if (myGen !== pollGeneration || currentRoomId !== roomIdSnapshot) return;

      let nextDelay = POLL_ROOM_MS;
      if (currentRoomState && currentRoomState.status === 'COUNTDOWN') {
        nextDelay = 450;
      } else if (document.hidden) {
        nextDelay = 1500;
      }
      pollTimer = setTimeout(tick, nextDelay);
    }

    // Nhịp đầu tiên chạy sau 1 khoảng ngắn vì state vừa nhận từ create/join
    pollTimer = setTimeout(tick, POLL_ROOM_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (currentRoomId) {
        startRoomPolling();
      } else {
        startLobbyPolling();
      }
    }
  });

  // ==================== ROOM ACTIONS ====================

  btnCreateRoom.addEventListener('click', async () => {
    if (isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();

    const nickname = getNickname();
    const roomName = inputRoomName.value.trim();
    isActionBusy = true;
    btnCreateRoom.disabled = true;

    try {
      const res = await apiPost('/rooms', {
        playerToken: playerToken,
        nickname: nickname,
        roomName: roomName,
      });
      if (!res || !res.ok) {
        showAlertBanner('❌ ' + ((res && res.error) || 'Không thể tạo bàn'));
        return;
      }
      enterRoomUI(res.roomId, res.state, null);
      if (soundManager) soundManager.playJoinSound();
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối máy chủ WordPress. Vui lòng thử lại!');
    } finally {
      isActionBusy = false;
      btnCreateRoom.disabled = false;
    }
  });

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

  async function joinRoomById(roomId) {
    if (isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();
    const nickname = getNickname();
    isActionBusy = true;

    try {
      const res = await apiPost('/rooms/join', {
        roomId: roomId,
        playerToken: playerToken,
        nickname: nickname,
      });
      if (!res || !res.ok) {
        showAlertBanner('❌ ' + ((res && res.error) || 'Không thể vào bàn'));
        setUrlRoomParam(null);
        return;
      }
      enterRoomUI(res.roomId, res.state, res.immediateAlert || null);
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối máy chủ. Vui lòng thử lại!');
    } finally {
      isActionBusy = false;
    }
  }

  function enterRoomUI(roomId, initialState, immediateAlert) {
    currentRoomId = roomId;
    selectedCardIds.clear();
    lastRoomVersion = initialState ? Number(initialState.version) || 0 : 0;
    lastSeenEventId = initialState ? Number(initialState.latestEventId) || 0 : 0;
    lastCountdownSeconds = null;

    setUrlRoomParam(roomId);
    lobbyView.classList.add('hidden');
    roomView.classList.remove('hidden');

    if (initialState) {
      applyRoomState(initialState, false);
    }
    if (immediateAlert) {
      handleRoomAlert(immediateAlert);
    }

    startRoomPolling();
  }

  function resetToLobbyUI() {
    currentRoomId = null;
    currentRoomState = null;
    lastRoomVersion = 0;
    lastSeenEventId = 0;
    lastCountdownSeconds = null;
    selectedCardIds.clear();
    setUrlRoomParam(null);
    roomView.classList.add('hidden');
    lobbyView.classList.remove('hidden');
    startLobbyPolling();
  }

  btnLeaveRoom.addEventListener('click', async () => {
    if (!currentRoomId) return;
    const leavingId = currentRoomId;
    stopPolling();
    try {
      await apiPost('/rooms/' + leavingId + '/leave', {
        playerToken: playerToken,
      });
    } catch (e) {
      // Dù lỗi mạng vẫn cho thoát về sảnh
    }
    resetToLobbyUI();
  });

  // Copy Link Mời trực tiếp (?room=XXXX)
  btnCopyInvite.addEventListener('click', async () => {
    if (!currentRoomId) return;
    const url = new URL(getCleanPageUrl());
    url.searchParams.set('room', currentRoomId);
    const inviteUrl = url.toString();

    try {
      await navigator.clipboard.writeText(inviteUrl);
      showAlertBanner('📋 Đã copy link mời: ' + inviteUrl + ' — Gửi cho bạn bè click là vào thẳng bàn!');
    } catch (e) {
      window.prompt('Copy link mời dưới đây gửi cho bạn bè:', inviteUrl);
    }
  });

  // Nút Gõ bàn gọi bạn
  btnNudgeRoom.addEventListener('click', async () => {
    if (!currentRoomId || isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();
    isActionBusy = true;
    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/nudge', {
        playerToken: playerToken,
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Không thể gõ bàn lúc này'));
        return;
      }
      if (res.state) {
        applyRoomState(res.state, true);
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi mạng khi gõ bàn.');
    } finally {
      isActionBusy = false;
    }
  });

  // Nút Bấm Sẵn sàng / Hủy Sẵn sàng
  btnReadyToggle.addEventListener('click', async () => {
    if (!currentRoomId || !currentRoomState || isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();

    const me = currentRoomState.players.find((p) => p.playerToken === playerToken);
    const nextReady = me ? !me.ready : true;

    isActionBusy = true;
    btnReadyToggle.disabled = true;
    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/ready', {
        playerToken: playerToken,
        ready: nextReady,
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Không thể đổi trạng thái Sẵn sàng'));
        return;
      }
      if (res.state) {
        applyRoomState(res.state, true);
        if (res.state.status === 'COUNTDOWN') {
          startRoomPolling();
        }
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối khi đổi trạng thái Sẵn sàng.');
    } finally {
      isActionBusy = false;
      btnReadyToggle.disabled = false;
    }
  });

  // Nút Chủ phòng bấm Bắt đầu chia bài (Cách 1)
  btnHostStart.addEventListener('click', async () => {
    if (!currentRoomId || isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();

    isActionBusy = true;
    btnHostStart.disabled = true;
    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/start', {
        playerToken: playerToken,
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Chưa đủ điều kiện chia bài'));
        return;
      }
      if (res.state) {
        applyRoomState(res.state, true);
        startRoomPolling();
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối khi bắt đầu chia bài.');
    } finally {
      isActionBusy = false;
    }
  });

  // Nút Bỏ chọn bài
  btnClearSelection.addEventListener('click', () => {
    selectedCardIds.clear();
    renderMyHand();
  });

  // Nút Đánh bài
  btnPlayCards.addEventListener('click', async () => {
    if (!currentRoomId || selectedCardIds.size === 0 || isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();

    const cardIds = Array.from(selectedCardIds);
    isActionBusy = true;
    btnPlayCards.disabled = true;

    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/play', {
        playerToken: playerToken,
        cardIds: cardIds,
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Nước đánh không hợp lệ'));
        return;
      }
      selectedCardIds.clear();
      if (res.state) {
        applyRoomState(res.state, true);
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối khi đánh bài.');
    } finally {
      isActionBusy = false;
      if (currentRoomState) {
        renderPlayingCenter(currentRoomState);
      }
    }
  });

  // Nút Bỏ lượt
  btnPassTurn.addEventListener('click', async () => {
    if (!currentRoomId || isActionBusy) return;
    if (soundManager) soundManager.unlockAudio();

    isActionBusy = true;
    btnPassTurn.disabled = true;

    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/pass', {
        playerToken: playerToken,
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Không thể bỏ lượt'));
        return;
      }
      if (res.state) {
        applyRoomState(res.state, true);
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi kết nối khi bỏ lượt.');
    } finally {
      isActionBusy = false;
      if (currentRoomState) {
        renderPlayingCenter(currentRoomState);
      }
    }
  });

  // ==================== CHAT & EMOJI & QUICK VOICE ====================

  async function sendChatMessage(messageText, voiceText, audioClip) {
    const cleanText = String(messageText || '').trim();
    if (!cleanText) return;

    // Phát âm thanh NGAY LẬP TỨC trong sự kiện chạm (synchronous user gesture) để mobile không bị chặn Autoplay
    if (soundManager) {
      soundManager.unlockAudio();
      lastLocalChatSoundAt = Date.now();
      if (audioClip || voiceText) {
        soundManager.speakBanter(voiceText, 'COUNTER_3X', audioClip);
      } else {
        soundManager.playChatSound();
      }
    }

    // Hiển thị bong bóng tức thì cho người bấm
    if (currentRoomState) {
      const me = (currentRoomState.players || []).find((p) => p.playerToken === playerToken);
      const myName = (me && me.nickname) || getNickname();
      if (audioClip || voiceText) {
        showBanterCallout(myName, cleanText, 4200);
      }
      setSeatBubble(playerToken, cleanText, 4800);
    }

    if (!currentRoomId || isChatBusy) return;

    isChatBusy = true;
    if (btnSendChat) btnSendChat.disabled = true;

    try {
      const res = await apiPost('/rooms/' + currentRoomId + '/chat', {
        playerToken: playerToken,
        message: cleanText,
        voiceText: voiceText || '',
        audioClip: audioClip || '',
        sinceEventId: lastSeenEventId,
      });
      if (!res || !res.ok) {
        showAlertBanner('⚠️ ' + ((res && res.error) || 'Không thể gửi tin nhắn'));
        return;
      }
      if (inputChatMessage && !voiceText && !audioClip) {
        inputChatMessage.value = '';
      }
      if (res.state) {
        applyRoomState(res.state, true);
      }
    } catch (e) {
      showAlertBanner('❌ Lỗi mạng khi gửi tin nhắn chat.');
    } finally {
      isChatBusy = false;
      if (btnSendChat) btnSendChat.disabled = false;
    }
  }

  if (btnSendChat && inputChatMessage) {
    btnSendChat.addEventListener('click', () => {
      sendChatMessage(inputChatMessage.value, '', '');
    });

    inputChatMessage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage(inputChatMessage.value, '', '');
      }
    });
  }

  if (emojiPickerBar && inputChatMessage) {
    emojiPickerBar.addEventListener('click', (e) => {
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('.btn-emoji') : null;
      if (!btn) return;
      const emoji = btn.getAttribute('data-emoji') || '';
      if (!emoji) return;
      if (soundManager) {
        soundManager.unlockAudio();
        soundManager.playChatSound();
      }
      inputChatMessage.value = (inputChatMessage.value + emoji).slice(0, 120);
      if (window.innerWidth > 768) {
        inputChatMessage.focus();
      }
    });
  }

  if (quickVoiceBar) {
    quickVoiceBar.addEventListener('click', (e) => {
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('.btn-quick-voice') : null;
      if (!btn) return;
      const text = btn.getAttribute('data-text') || '';
      const voice = btn.getAttribute('data-voice') || '';
      const clip = btn.getAttribute('data-clip') || '';
      if (!text) return;
      sendChatMessage(text, voice, clip);
    });
  }

  // ==================== STATE & ALERTS ====================

  function applyRoomState(state, processEvents) {
    if (!state) return;
    currentRoomState = state;
    lastRoomVersion = Number(state.version) || lastRoomVersion;

    // Xử lý tiếng bíp đếm ngược (3..2..1)
    if (state.status === 'COUNTDOWN' && state.countdownSeconds !== null && state.countdownSeconds !== undefined) {
      if (state.countdownSeconds !== lastCountdownSeconds) {
        lastCountdownSeconds = state.countdownSeconds;
        if (soundManager) {
          soundManager.playCountdownBeep(state.countdownSeconds);
        }
      }
    } else {
      lastCountdownSeconds = null;
    }

    // Xử lý các sự kiện âm thanh & thông báo mới
    if (processEvents && Array.isArray(state.newEvents)) {
      state.newEvents.forEach((ev) => {
        const eid = Number(ev.id) || 0;
        if (eid > lastSeenEventId) {
          lastSeenEventId = eid;
          handleRoomAlert(ev);
        }
      });
    }

    if (Number(state.latestEventId) > lastSeenEventId) {
      lastSeenEventId = Number(state.latestEventId);
    }

    renderRoomState(state);
  }

  function handleRoomAlert(alert) {
    if (!alert) return;

    switch (alert.type) {
      case 'ROOM_FULL_4':
        if (soundManager) {
          soundManager.playRoomFullAlarm();
          soundManager.triggerUrgentTabAlert(
            '🔔 [4/4 ĐỦ NGƯỜI!]',
            '🃏 Bàn #' + currentRoomId + ' đã đủ 4/4 người!',
            alert.message || 'Quay lại bàn bấm Sẵn sàng để chia bài ngay!'
          );
        }
        showAlertBanner(alert.message, 8000);
        break;

      case 'PLAYER_JOINED':
      case 'SPECTATOR_JOINED':
        if (soundManager) soundManager.playJoinSound();
        showAlertBanner(alert.message, 4000);
        break;

      case 'NUDGE':
        if (soundManager) {
          soundManager.playNudgeSound();
          soundManager.triggerUrgentTabAlert(
            '🔔 [CÓ NGƯỜI GÕ BÀN!]',
            '🔔 Bàn #' + currentRoomId,
            alert.message
          );
        }
        showAlertBanner(alert.message, 5000);
        break;

      case 'COUNTDOWN_CANCELLED':
        showAlertBanner(alert.message, 4000);
        break;

      case 'GAME_STARTED':
        if (soundManager) {
          soundManager.playGameStartSound();
          soundManager.triggerUrgentTabAlert(
            '🃏 [ĐÃ CHIA BÀI!]',
            '🃏 Bàn #' + currentRoomId + ' đã chia bài!',
            alert.message
          );
        }
        showAlertBanner(alert.message, 4000);
        break;

      case 'CARD_PLAYED':
        if (soundManager) soundManager.playCardSound(alert.cardCount || 1);
        if (alert.banter) {
          if (soundManager) {
            soundManager.speakBanter(alert.banter.voiceText, alert.banter.kind, alert.banter.audioClip);
          }
          showBanterCallout(alert.nickname, alert.banter.displayText, 4200);
          setSeatBubble(alert.playerToken, alert.banter.displayText, 4500);
        }
        break;

      case 'CHOP':
        if (soundManager) soundManager.playChopSound();
        showAlertBanner(alert.message, 5500);
        if (alert.banter) {
          if (soundManager) {
            soundManager.speakBanter(alert.banter.voiceText, alert.banter.kind, alert.banter.audioClip);
          }
          showBanterCallout(alert.nickname, alert.banter.displayText, 4600);
          setSeatBubble(alert.playerToken, alert.banter.displayText, 4600);
        }
        break;

      case 'CHAT_MESSAGE':
        if (alert.chat) {
          const isOwnRecentChat =
            alert.chat.playerToken === playerToken && Date.now() - lastLocalChatSoundAt < 4000;
          if (alert.chat.audioClip || alert.chat.voiceText) {
            if (soundManager && !isOwnRecentChat) {
              soundManager.speakBanter(alert.chat.voiceText, 'COUNTER_3X', alert.chat.audioClip);
            }
            showBanterCallout(alert.chat.nickname, alert.chat.text, 4200);
          } else if (soundManager && !isOwnRecentChat) {
            soundManager.playChatSound();
          }
          setSeatBubble(alert.chat.playerToken, alert.chat.text, 4800);
        }
        break;

      case 'PASS':
        if (soundManager) soundManager.playPassSound();
        break;

      case 'GAME_ENDED':
        if (soundManager) soundManager.playWinSound();
        showAlertBanner(alert.message, 6000);
        break;
    }
  }

  // ==================== RENDERING ====================

  function renderLobbyRooms(rooms) {
    lobbyCountBadge.textContent = rooms.length + ' bàn đang mở';

    if (rooms.length === 0) {
      lobbyRoomsList.innerHTML =
        '<div class="empty-lobby" role="status">' +
        '<p><strong>Chưa có bàn nào đang mở trong sảnh.</strong></p>' +
        '<p>Hãy nhập tên bàn bên trái và bấm <strong>➕ Tạo Bàn</strong> để mở sảnh rủ anh em!</p>' +
        '</div>';
      return;
    }

    lobbyRoomsList.innerHTML = '';
    rooms.forEach((r) => {
      const isFull = r.playerCount >= r.maxPlayers;
      const isPlaying = r.status === 'PLAYING';
      const statusText = isPlaying
        ? '🃏 Đang đánh ván #' + r.roundNumber
        : isFull
        ? '🔔 Đủ 4/4 chân (Sắp đánh)'
        : '⏳ Đang chờ (' + r.playerCount + '/' + r.maxPlayers + ' người)';

      const card = document.createElement('div');
      card.className = 'room-card';
      card.setAttribute('role', 'listitem');
      card.innerHTML =
        '<div>' +
        '<div class="room-card-header">' +
        '<span class="room-card-code">BÀN #' + escapeHtml(r.roomId) + '</span>' +
        '<span class="badge ' + (isFull ? 'badge-gold' : 'badge-subtle') + '">' + r.playerCount + '/' + r.maxPlayers + ' ghế</span>' +
        '</div>' +
        '<div class="room-card-name">' + escapeHtml(r.roomName) + '</div>' +
        '<div class="room-card-meta">' +
        '<span>👑 Chủ bàn: <strong>' + escapeHtml(r.hostNickname) + '</strong></span>' +
        '<span>Trạng thái: ' + statusText + '</span>' +
        '</div>' +
        '</div>' +
        '<button type="button" class="btn ' + (isPlaying || isFull ? 'btn-secondary' : 'btn-primary') + ' btn-join-room">' +
        (isPlaying || isFull ? '👀 Vào Xem / Chờ Ván Sau' : '🪑 Vào Ngồi Ngay') +
        '</button>';

      card.querySelector('.btn-join-room').addEventListener('click', () => {
        joinRoomById(r.roomId);
      });

      lobbyRoomsList.appendChild(card);
    });
  }

  function renderRoomState(state) {
    lblRoomCode.textContent = state.roomId;
    lblRoomName.textContent = state.roomName;
    lblRoundBadge.textContent =
      state.status === 'PLAYING'
        ? 'Đang đánh Ván #' + state.roundNumber
        : state.roundNumber > 0
        ? 'Nghỉ giữa ván (Đã chơi ' + state.roundNumber + ' ván)'
        : 'Phòng chờ';

    if (state.spectators && state.spectators.length > 0) {
      spectatorBadge.classList.remove('hidden');
      spectatorBadge.textContent = '👀 Khán giả: ' + state.spectators.map((s) => s.nickname).join(', ');
    } else {
      spectatorBadge.classList.add('hidden');
    }

    renderFourSeats(state);

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

    renderMyHand();
    renderChatMessages(state.chats || []);

    roomLogList.innerHTML = (state.logs || [])
      .slice()
      .reverse()
      .map((line) => '<div>' + escapeHtml(line) + '</div>')
      .join('');
  }

  function renderChatMessages(chats) {
    if (!chatMessagesList) return;
    if (!Array.isArray(chats) || chats.length === 0) {
      if (lastRenderedChatId !== 0) {
        lastRenderedChatId = 0;
        chatMessagesList.innerHTML =
          '<div class="chat-empty-hint">Chưa có tin nhắn nào. Hãy chọn icon hoặc bấm câu cà khịa để phát tiếng nói!</div>';
      }
      return;
    }

    const latestId = Number(chats[chats.length - 1].id) || chats.length;
    if (latestId === lastRenderedChatId) {
      return;
    }
    lastRenderedChatId = latestId;

    chatMessagesList.innerHTML = chats
      .map((c) => {
        const isMe = c.playerToken === playerToken;
        return (
          '<div class="chat-msg-row">' +
          '<span class="chat-msg-author ' + (isMe ? 'is-me' : '') + '">' +
          escapeHtml(c.nickname) + (isMe ? ' (Bạn)' : '') + ':' +
          '</span>' +
          '<span class="chat-msg-text">' + escapeHtml(c.text) + '</span>' +
          (c.timeLabel ? '<span class="chat-msg-time">' + escapeHtml(c.timeLabel) + '</span>' : '') +
          '</div>'
        );
      })
      .join('');

    chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
  }

  function renderFourSeats(state) {
    const players = state.players || [];
    const myIndex = players.findIndex((p) => p.playerToken === playerToken);

    let orderedForView = [null, null, null, null];
    if (myIndex >= 0) {
      orderedForView = [0, 1, 2, 3].map((offset) => {
        return players.find((p) => (p.seatIndex - players[myIndex].seatIndex + 4) % 4 === offset) || null;
      });
    } else {
      for (let s = 0; s < 4; s++) {
        orderedForView[s] = players.find((p) => p.seatIndex === s) || null;
      }
    }

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
      return (
        '<div class="seat-card seat-empty">' +
        '<div>🪑 ' + escapeHtml(emptyLabel) + '</div>' +
        '<div>Đang chờ người vào...</div>' +
        '</div>'
      );
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
      statusPill = '<span class="status-pill pill-rank">' + (rankNames[player.finishOrder] || 'Hạng ' + player.finishOrder) + '</span>';
    } else if (player.passedInRound) {
      statusPill = '<span class="status-pill pill-pass">⏭️ Đã bỏ lượt</span>';
    } else {
      statusPill = '<span class="status-pill pill-ready">🂠 Còn ' + player.cardCount + ' lá</span>';
    }

    const activeBubble =
      seatBubbles[player.playerToken] && Date.now() < seatBubbles[player.playerToken].expiresAt
        ? '<div class="seat-chat-bubble">' + escapeHtml(seatBubbles[player.playerToken].text) + '</div>'
        : '';

    return (
      '<div class="seat-card ' + (isTurn ? 'active-turn' : '') + '">' +
      activeBubble +
      '<div class="seat-header-line">' +
      '<span>' + (player.isHost ? '👑 ' : '') + escapeHtml(player.nickname) + (isMe ? ' (Bạn)' : '') + '</span>' +
      '<span title="' + (player.online ? 'Đang trực tuyến' : 'Tạm mất kết nối') + '">' + (player.online ? '🟢' : '🔴') + '</span>' +
      '</div>' +
      '<div class="seat-badges-line">' +
      '<span>Điểm: <strong>' + player.score + '</strong></span>' +
      statusPill +
      '</div>' +
      '</div>'
    );
  }

  function renderWaitingCenter(state) {
    const readiness = state.readiness || {
      totalPlayers: state.players.length,
      readyCount: 0,
      canHostStart: false,
    };
    const totalPlayers = readiness.totalPlayers;
    const readyCount = readiness.readyCount;
    const canHostStart = readiness.canHostStart;

    const me = state.players.find((p) => p.playerToken === playerToken);
    const amHost = state.hostToken === playerToken;

    if (state.status === 'COUNTDOWN' && state.countdownSeconds !== null && state.countdownSeconds !== undefined) {
      countdownOverlay.classList.remove('hidden');
      countdownNumber.textContent = state.countdownSeconds;
    } else {
      countdownOverlay.classList.add('hidden');
    }

    if (state.rankings && state.rankings.length > 0) {
      rankingsBox.classList.remove('hidden');
      rankingsList.innerHTML = state.rankings
        .map((r) => {
          const deltaText = r.scoreDelta >= 0 ? '+' + r.scoreDelta : String(r.scoreDelta);
          return (
            '<div class="ranking-row">' +
            '<span><strong>#' + r.place + ' (' + escapeHtml(r.rankTitle) + ')</strong> — ' + escapeHtml(r.nickname) + '</span>' +
            '<span>' + deltaText + ' đ (Tổng: ' + r.totalScore + ')</span>' +
            '</div>'
          );
        })
        .join('');
    } else {
      rankingsBox.classList.add('hidden');
    }

    if (totalPlayers < 2) {
      waitingTitle.textContent = 'Đang chờ thêm người chơi (' + totalPlayers + '/4 người)...';
      waitingInstruction.textContent =
        'Hãy bấm nút "📋 Copy Link Mời Bạn" ở góc trên để gửi cho bạn bè hoặc bảo bạn vào từ Sảnh chờ.';
    } else if (totalPlayers === 4) {
      waitingTitle.textContent = '🔔 ĐÃ ĐỦ 4/4 CHÂN! (Đã sẵn sàng: ' + readyCount + '/4)';
      waitingInstruction.textContent =
        'Khi cả 4/4 người cùng bấm nút [SẴN SÀNG], hệ thống sẽ tự động đếm ngược 3 giây và chia bài!';
    } else {
      waitingTitle.textContent = 'Đã có ' + totalPlayers + '/4 người trong bàn (Sẵn sàng: ' + readyCount + '/' + totalPlayers + ')';
      waitingInstruction.textContent = canHostStart
        ? '✅ 100% người trong bàn đã Sẵn sàng! Chủ phòng có thể bấm [🃏 BẮT ĐẦU CHIA BÀI] ngay hoặc chờ thêm người thứ 4.'
        : 'Tất cả người chơi trong bàn hãy bấm [SẴN SÀNG]. Khi 100% đã Sẵn sàng, Chủ phòng sẽ mở khóa nút Chia bài.';
    }

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

    if (amHost) {
      btnHostStart.classList.remove('hidden');
      btnHostStart.disabled = !canHostStart || state.status === 'COUNTDOWN';
      btnHostStart.textContent = canHostStart
        ? '🃏 BẮT ĐẦU CHIA BÀI (' + totalPlayers + ' NGƯỜI)'
        : '🃏 Chờ đủ người bấm Sẵn sàng (' + readyCount + '/' + Math.max(2, totalPlayers) + ')';
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
      btnPlayCards.disabled = isActionBusy;
      btnPassTurn.disabled = isActionBusy || !state.currentTrick;
    } else {
      turnBanner.textContent = '⏳ Đang tới lượt của: ' + (turnPlayer ? turnPlayer.nickname : '...');
      turnBanner.classList.remove('my-turn');
      if (state.myRole === 'PLAYER') {
        playControlsBar.classList.remove('hidden');
        btnPlayCards.disabled = true;
        btnPassTurn.disabled = true;
      } else {
        playControlsBar.classList.add('hidden');
      }
    }

    if (state.requiredFirstCardLabel) {
      requiredCardHint.classList.remove('hidden');
      requiredCardHint.textContent =
        '💡 Lượt mở màn ván đầu: Bắt buộc đánh bộ bài có chứa lá ' + state.requiredFirstCardLabel;
    } else {
      requiredCardHint.classList.add('hidden');
    }

    if (!state.currentTrick) {
      trickZone.innerHTML =
        '<div class="trick-empty">✨ Bàn trống (Vòng mới) — Người tới lượt được ra bất kỳ bộ hợp lệ nào!</div>';
    } else {
      const trick = state.currentTrick;
      const cardsHtml = (trick.cards || [])
        .map((card) => createCardElementHTML(card, false, true))
        .join('');
      trickZone.innerHTML =
        '<div class="trick-meta">' +
        escapeHtml(trick.nickname) + ' vừa đánh: <strong>' + escapeHtml(trick.label) + '</strong>' +
        (trick.chopNote ? ' — <span>' + escapeHtml(trick.chopNote) + '</span>' : '') +
        '</div>' +
        '<div class="trick-cards-row">' + cardsHtml + '</div>';
    }
  }

  function renderMyHand() {
    const hand = (currentRoomState && currentRoomState.myHand) || [];
    const handIds = new Set(hand.map((c) => c.id));
    selectedCardIds.forEach((id) => {
      if (!handIds.has(id)) {
        selectedCardIds.delete(id);
      }
    });

    if (hand.length === 0) {
      myHandContainer.innerHTML =
        currentRoomState && currentRoomState.status === 'PLAYING'
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
      btn.className = 'playing-card color-' + card.color + (isSelected ? ' selected' : '');
      btn.setAttribute('aria-label', 'Lá bài ' + card.label);
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.innerHTML =
        '<div class="card-corner-top">' +
        '<span class="card-rank">' + escapeHtml(card.rank) + '</span>' +
        '<span class="card-suit-sm">' + escapeHtml(card.suitSymbol) + '</span>' +
        '</div>' +
        '<div class="card-center-suit">' + escapeHtml(card.suitSymbol) + '</div>';

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

  function createCardElementHTML(card, isSelected, isTableCard) {
    return (
      '<div class="playing-card color-' + card.color + (isSelected ? ' selected' : '') + (isTableCard ? ' table-card' : '') + '">' +
      '<div class="card-corner-top">' +
      '<span class="card-rank">' + escapeHtml(card.rank) + '</span>' +
      '<span class="card-suit-sm">' + escapeHtml(card.suitSymbol) + '</span>' +
      '</div>' +
      '<div class="card-center-suit">' + escapeHtml(card.suitSymbol) + '</div>' +
      '</div>'
    );
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
    selectedComboHint.textContent = 'Đang chọn (' + selected.length + ' lá): ' + labels;
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Khởi động: tự vào phòng nếu mở từ Link mời (?room=XXXX) hoặc chạy sảnh chờ
  function init() {
    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get('room');
    if (invitedRoom && /^\d{4}$/.test(invitedRoom.trim())) {
      inputRoomCode.value = invitedRoom.trim();
      joinRoomById(invitedRoom.trim());
    } else {
      startLobbyPolling();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
