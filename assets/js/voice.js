(function (window, document) {
  'use strict';

  /**
   * Hệ thống Voice Chat trực tiếp (WebRTC P2P Mesh + Signaling qua WordPress REST API)
   * Hỗ trợ 2–4 người chơi nói chuyện trực tiếp, bật/tắt Mic và tắt/mở Âm thanh tức thì.
   */
  class TLMNVoiceManager {
    constructor() {
      this.roomId = null;
      this.playerToken = null;
      this.restBase = '';
      this.iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ];

      this.localStream = null;
      this.micEnabled = false;
      this.micBusy = false;
      this.audioMuted = false;

      this.peers = new Map(); // peerToken -> PeerContext
      this.knownPeerTokens = new Set(); // online players/spectators in room (excluding self)
      this.remoteMicStates = new Map(); // peerToken -> boolean
      this.speakingStates = new Map(); // token -> boolean
      this.speakingHoldUntil = new Map(); // token -> timestamp

      this.pollTimer = null;
      this.pollGen = 0;
      this.lastSignalId = 0;
      this.lastSignalActivityAt = 0;

      this.vadCtx = null;
      this.vadTimer = null;
      this.localAnalyser = null;
      this.localSource = null;

      this.audioContainer = null;

      // Callbacks do app.js đăng ký
      this.onMicStateChange = null;
      this.onPeerMicStateChange = null;
      this.onSpeakingChange = null;
      this.onNotice = null;
      this.onPeerCountChange = null;

      window.addEventListener('pagehide', () => {
        this._sendByeBeacon();
        this._stopLocalStream();
      });
    }

    configure(opts) {
      if (!opts) return;
      if (opts.restBase) {
        this.restBase = String(opts.restBase).replace(/\/+$/, '');
      }
      if (Array.isArray(opts.iceServers) && opts.iceServers.length > 0) {
        this.iceServers = opts.iceServers;
      }
      if (typeof opts.audioMuted === 'boolean') {
        this.audioMuted = opts.audioMuted;
      }
    }

    isSupported() {
      return typeof window.RTCPeerConnection !== 'undefined';
    }

    _buildUrl(path, queryParams) {
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      let url = this.restBase + cleanPath;
      if (queryParams && typeof queryParams === 'object') {
        const parts = [];
        Object.keys(queryParams).forEach((k) => {
          const v = queryParams[k];
          if (v !== undefined && v !== null) {
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
          }
        });
        if (parts.length > 0) {
          url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
        }
      }
      return url;
    }

    async _apiGet(path, queryParams) {
      const params = Object.assign({}, queryParams || {}, { _t: Date.now() });
      const resp = await fetch(this._buildUrl(path, params), {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      return resp.json();
    }

    async _apiPost(path, body, keepalive) {
      const resp = await fetch(this._buildUrl(path), {
        method: 'POST',
        cache: 'no-store',
        keepalive: Boolean(keepalive),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body || {}),
      });
      return resp.json();
    }

    _ensureAudioContainer() {
      if (this.audioContainer && document.body.contains(this.audioContainer)) {
        return this.audioContainer;
      }
      let el = document.getElementById('tlmnVoiceAudioContainer');
      if (!el) {
        el = document.createElement('div');
        el.id = 'tlmnVoiceAudioContainer';
        el.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
        document.body.appendChild(el);
      }
      this.audioContainer = el;
      return el;
    }

    joinRoom(roomId, playerToken, initialPeers) {
      if (!roomId || !playerToken) return;
      if (this.roomId === roomId && this.playerToken === playerToken) {
        this.syncRoomMembers(initialPeers || []);
        return;
      }

      this.leaveRoom(false);

      this.roomId = String(roomId);
      this.playerToken = String(playerToken);
      this.lastSignalId = 0;
      this.lastSignalActivityAt = Date.now();
      this.micEnabled = false;
      this.remoteMicStates.clear();
      this.speakingStates.clear();
      this.speakingHoldUntil.clear();

      this.syncRoomMembers(initialPeers || []);

      if (!this.isSupported()) {
        return;
      }

      this._startPolling();
      this._startVadLoop();
      // Gửi tín hiệu hello để những người đang bật mic trong bàn tự kết nối truyền tiếng sang mình.
      this._sendSignal('*', 'hello', { micOn: false });
      this._emitMicState();
    }

    leaveRoom(sendBye) {
      const shouldBye = sendBye !== false;
      if (shouldBye && this.roomId && this.playerToken) {
        this._sendByeBeacon();
        this._syncServerMicState(false);
      }

      this.pollGen += 1;
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.vadTimer) {
        clearInterval(this.vadTimer);
        this.vadTimer = null;
      }

      // Đóng toàn bộ kết nối WebRTC và gỡ phần tử audio
      this.peers.forEach((ctx, peerToken) => {
        this._destroyPeer(peerToken);
      });
      this.peers.clear();
      this.knownPeerTokens.clear();
      this.remoteMicStates.clear();

      this._stopLocalStream();
      this.micEnabled = false;

      // Xóa trạng thái đang nói
      this.speakingStates.forEach((val, tok) => {
        if (val && typeof this.onSpeakingChange === 'function') {
          this.onSpeakingChange(tok, false);
        }
      });
      this.speakingStates.clear();
      this.speakingHoldUntil.clear();

      this.roomId = null;
      this.lastSignalId = 0;
      this._emitMicState();
      this._emitPeerCount();
    }

    _sendByeBeacon() {
      if (!this.roomId || !this.playerToken || !this.restBase) return;
      try {
        this._apiPost(
          '/rooms/' + this.roomId + '/voice/signal',
          {
            playerToken: this.playerToken,
            toToken: '*',
            signalType: 'bye',
            data: {},
          },
          true
        ).catch(() => {});
      } catch (e) {
        // Bỏ qua khi đóng tab
      }
    }

    /**
     * Đồng bộ danh sách thành viên hiện tại trong phòng từ state game.
     */
    syncRoomMembers(members) {
      if (!this.roomId || !this.playerToken) return;
      const activeSet = new Set();

      (members || []).forEach((m) => {
        if (!m || !m.playerToken || m.playerToken === this.playerToken) return;
        activeSet.add(m.playerToken);
        if (typeof m.micOn === 'boolean') {
          this.remoteMicStates.set(m.playerToken, m.micOn);
        }
      });

      this.knownPeerTokens = activeSet;

      // Gỡ các peer đã rời khỏi phòng
      Array.from(this.peers.keys()).forEach((peerToken) => {
        if (!activeSet.has(peerToken)) {
          this._destroyPeer(peerToken);
        }
      });

      // Nếu mình đang bật mic, đảm bảo đã tạo kết nối tới tất cả người mới vào bàn
      if (this.micEnabled && this.localStream) {
        activeSet.forEach((peerToken) => {
          if (!this.peers.has(peerToken)) {
            this._ensurePeerConnection(peerToken, true);
          }
        });
      }
    }

    /**
     * Bật / Tắt Micro trực tiếp.
     */
    async toggleMic() {
      if (!this.roomId || !this.playerToken || this.micBusy) return this.micEnabled;

      if (!this.isSupported()) {
        this._notify('⚠️ Trình duyệt hiện tại không hỗ trợ đàm thoại trực tiếp (WebRTC).');
        return false;
      }

      if (this.micEnabled) {
        // Đang bật -> Tắt Mic tức thì (giữ kết nối WebRTC nóng để bật lại không trễ)
        this._setLocalTracksEnabled(false);
        this.micEnabled = false;
        this._setSpeakingState(this.playerToken, false);
        this._emitMicState();
        this._syncServerMicState(false);
        this._sendSignal('*', 'mic_state', { micOn: false });
        return false;
      }

      // Đang tắt -> Bật Mic
      this.micBusy = true;
      try {
        if (!this.localStream || !this._hasLiveAudioTrack()) {
          if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            this._notify('⚠️ Tính năng Mic yêu cầu mở trang bằng HTTPS để trình duyệt cho phép truy cập micro.');
            return false;
          }
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            this._notify('⚠️ Trình duyệt này không hỗ trợ truy cập Micro (hãy mở bằng Chrome/Safari trên HTTPS).');
            return false;
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          this.localStream = stream;
          this._attachLocalVad(stream);
        }

        this._setLocalTracksEnabled(true);
        this.micEnabled = true;
        this.lastSignalActivityAt = Date.now();
        this._emitMicState();
        this._syncServerMicState(true);
        this._sendSignal('*', 'mic_state', { micOn: true });

        // Gắn audio track vào toàn bộ peer trong phòng
        this.knownPeerTokens.forEach((peerToken) => {
          this._ensurePeerConnection(peerToken, true);
        });

        // Mở khóa audio từ xa luôn trong sự kiện click của người dùng
        this.unlockRemoteAudio();
        return true;
      } catch (err) {
        const name = err && err.name ? String(err.name) : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          this._notify('⚠️ Bạn chưa cấp quyền Micro. Hãy cho phép quyền Micro trên thanh địa chỉ trình duyệt rồi bấm lại.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          this._notify('⚠️ Không tìm thấy thiết bị Micro trên máy này.');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          this._notify('⚠️ Micro đang được ứng dụng khác sử dụng, không thể mở lúc này.');
        } else {
          this._notify('⚠️ Không thể bật Micro: ' + (err && err.message ? err.message : 'Lỗi không xác định'));
        }
        this.micEnabled = false;
        this._emitMicState();
        return false;
      } finally {
        this.micBusy = false;
      }
    }

    /**
     * Tắt / Mở âm thanh (loa nghe giọng nói của mọi người trong bàn).
     */
    setAudioMuted(muted) {
      this.audioMuted = Boolean(muted);
      this.peers.forEach((ctx, peerToken) => {
        if (ctx.audioEl) {
          ctx.audioEl.muted = this.audioMuted;
          if (!this.audioMuted && ctx.audioEl.srcObject) {
            ctx.audioEl.play().catch(() => {});
          }
        }
        if (this.audioMuted) {
          this._setSpeakingState(peerToken, false);
        }
      });
    }

    /**
     * Gọi trong sự kiện chạm của người dùng để đảm bảo các luồng audio WebRTC được phát trên Mobile.
     */
    unlockRemoteAudio() {
      if (this.audioMuted) return;
      this.peers.forEach((ctx) => {
        if (ctx.audioEl && ctx.audioEl.srcObject && ctx.audioEl.paused) {
          ctx.audioEl.muted = false;
          ctx.audioEl.play().catch(() => {});
        }
      });
      if (this.vadCtx && this.vadCtx.state === 'suspended') {
        this.vadCtx.resume().catch(() => {});
      }
    }

    getMicState() {
      return {
        micEnabled: this.micEnabled,
        audioMuted: this.audioMuted,
        connectedPeers: this._countConnectedPeers(),
      };
    }

    getPeerMicOn(peerToken) {
      if (peerToken === this.playerToken) return this.micEnabled;
      return Boolean(this.remoteMicStates.get(peerToken));
    }

    hasPeerMicState(peerToken) {
      if (peerToken === this.playerToken) return true;
      return this.remoteMicStates.has(peerToken);
    }

    isSpeaking(token) {
      return Boolean(this.speakingStates.get(token));
    }

    _hasLiveAudioTrack() {
      if (!this.localStream) return false;
      const tracks = this.localStream.getAudioTracks();
      return tracks.length > 0 && tracks[0].readyState === 'live';
    }

    _setLocalTracksEnabled(enabled) {
      if (!this.localStream) return;
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = Boolean(enabled);
      });
    }

    _stopLocalStream() {
      if (this.localSource) {
        try {
          this.localSource.disconnect();
        } catch (e) {
          // Bỏ qua
        }
        this.localSource = null;
      }
      this.localAnalyser = null;

      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch (e) {
            // Bỏ qua
          }
        });
        this.localStream = null;
      }
    }

    // ==================== SIGNALING ====================

    _sendSignal(toToken, signalType, data) {
      if (!this.roomId || !this.playerToken || !this.restBase) return;
      this.lastSignalActivityAt = Date.now();
      this._apiPost('/rooms/' + this.roomId + '/voice/signal', {
        playerToken: this.playerToken,
        toToken: toToken || '*',
        signalType: signalType,
        data: data || {},
      }).catch(() => {});
    }

    _syncServerMicState(micOn) {
      if (!this.roomId || !this.playerToken || !this.restBase) return;
      this._apiPost('/rooms/' + this.roomId + '/voice/state', {
        playerToken: this.playerToken,
        micOn: Boolean(micOn),
      }).catch(() => {});
    }

    _startPolling() {
      this.pollGen += 1;
      const myGen = this.pollGen;

      const tick = async () => {
        if (myGen !== this.pollGen || !this.roomId) return;
        const rid = this.roomId;

        try {
          const res = await this._apiGet('/rooms/' + rid + '/voice/poll', {
            token: this.playerToken,
            afterId: this.lastSignalId,
          });

          if (myGen !== this.pollGen || this.roomId !== rid) return;

          if (res && res.ok && Array.isArray(res.signals)) {
            if (Number(res.latestId) > this.lastSignalId) {
              this.lastSignalId = Number(res.latestId);
            }
            if (res.signals.length > 0) {
              this.lastSignalActivityAt = Date.now();
              for (let i = 0; i < res.signals.length; i++) {
                await this._handleIncomingSignal(res.signals[i]);
              }
            }
          }
        } catch (e) {
          // Mạng chập chờn: tự thử lại ở nhịp tiếp theo
        }

        if (myGen !== this.pollGen || this.roomId !== rid) return;

        // Nhịp poll thích ứng: nhanh (650ms) lúc đang bắt tay WebRTC, chậm dần (2000ms) khi ổn định để tiết kiệm tài nguyên WordPress
        const recentlyActive = Date.now() - this.lastSignalActivityAt < 15000;
        let delay = recentlyActive ? 650 : 2000;
        if (document.hidden) {
          delay = 3500;
        }
        this.pollTimer = setTimeout(tick, delay);
      };

      this.pollTimer = setTimeout(tick, 450);
    }

    async _handleIncomingSignal(sig) {
      if (!sig || !sig.fromToken || sig.fromToken === this.playerToken) return;
      const peerToken = sig.fromToken;
      const type = sig.signalType;
      const data = sig.payload || {};

      if (type === 'bye') {
        this.remoteMicStates.set(peerToken, false);
        this._destroyPeer(peerToken);
        if (typeof this.onPeerMicStateChange === 'function') {
          this.onPeerMicStateChange(peerToken, false);
        }
        return;
      }

      if (type === 'mic_state') {
        const isMicOn = Boolean(data.micOn);
        this.remoteMicStates.set(peerToken, isMicOn);
        if (!isMicOn) {
          this._setSpeakingState(peerToken, false);
        }
        if (typeof this.onPeerMicStateChange === 'function') {
          this.onPeerMicStateChange(peerToken, isMicOn);
        }
        return;
      }

      if (type === 'hello') {
        this.knownPeerTokens.add(peerToken);
        if (typeof data.micOn === 'boolean') {
          this.remoteMicStates.set(peerToken, data.micOn);
        }
        // Nếu mình đang bật mic, chủ động kết nối để người mới vào nghe được tiếng mình ngay
        if (this.micEnabled && this.localStream) {
          this._destroyPeer(peerToken);
          this._ensurePeerConnection(peerToken, true);
        }
        return;
      }

      if (type === 'offer' || type === 'answer') {
        const ctx = this._ensurePeerConnection(peerToken, false);
        if (!ctx) return;

        const desc = data && data.sdp ? { type: data.type || type, sdp: data.sdp } : null;
        if (!desc) return;

        const pc = ctx.pc;
        const offerCollision =
          desc.type === 'offer' && (ctx.makingOffer || pc.signalingState !== 'stable');

        ctx.ignoreOffer = !ctx.polite && offerCollision;
        if (ctx.ignoreOffer) {
          return;
        }

        try {
          if (offerCollision && ctx.polite) {
            await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          }
          await pc.setRemoteDescription(new window.RTCSessionDescription(desc));

          // Xả hàng đợi ICE candidate đến sớm
          while (ctx.pendingCandidates.length > 0) {
            const cand = ctx.pendingCandidates.shift();
            await pc.addIceCandidate(new window.RTCIceCandidate(cand)).catch(() => {});
          }

          if (desc.type === 'offer') {
            if (this.localStream && !ctx.trackAttached) {
              this._attachLocalTrackToPeer(ctx);
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this._sendSignal(peerToken, 'answer', {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            });
          }
        } catch (err) {
          // Bỏ qua lỗi SDP race tạm thời
        }
        return;
      }

      if (type === 'ice') {
        const ctx = this.peers.get(peerToken);
        if (!ctx || ctx.ignoreOffer) return;

        const list = Array.isArray(data.candidates)
          ? data.candidates
          : data.candidate
          ? [data.candidate]
          : [];

        for (let i = 0; i < list.length; i++) {
          const cand = list[i];
          if (!cand) continue;
          try {
            if (ctx.pc.remoteDescription && ctx.pc.remoteDescription.type) {
              await ctx.pc.addIceCandidate(new window.RTCIceCandidate(cand));
            } else {
              ctx.pendingCandidates.push(cand);
            }
          } catch (e) {
            // Bỏ qua candidate đã hết hạn
          }
        }
      }
    }

    // ==================== PEER CONNECTION ====================

    _ensurePeerConnection(peerToken, attachLocal) {
      let ctx = this.peers.get(peerToken);
      if (ctx && ctx.pc && ctx.pc.connectionState !== 'closed') {
        if (attachLocal && this.localStream && !ctx.trackAttached) {
          this._attachLocalTrackToPeer(ctx);
        }
        return ctx;
      }

      const pc = new window.RTCPeerConnection({
        iceServers: this.iceServers,
      });

      ctx = {
        peerToken: peerToken,
        pc: pc,
        polite: String(this.playerToken) < String(peerToken),
        makingOffer: false,
        ignoreOffer: false,
        trackAttached: false,
        pendingCandidates: [],
        iceOutQueue: [],
        iceFlushTimer: null,
        audioEl: null,
        remoteStream: null,
        remoteAnalyser: null,
        remoteSource: null,
      };

      this.peers.set(peerToken, ctx);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          ctx.iceOutQueue.push(ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
          if (!ctx.iceFlushTimer) {
            ctx.iceFlushTimer = setTimeout(() => {
              ctx.iceFlushTimer = null;
              if (ctx.iceOutQueue.length > 0 && this.peers.get(peerToken) === ctx) {
                const batch = ctx.iceOutQueue.splice(0, ctx.iceOutQueue.length);
                this._sendSignal(peerToken, 'ice', { candidates: batch });
              }
            }, 180);
          }
        }
      };

      pc.onnegotiationneeded = async () => {
        if (this.peers.get(peerToken) !== ctx) return;
        try {
          ctx.makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          await pc.setLocalDescription(offer);
          this._sendSignal(peerToken, 'offer', {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          });
        } catch (e) {
          // Bỏ qua
        } finally {
          ctx.makingOffer = false;
        }
      };

      pc.ontrack = (ev) => {
        const stream = (ev.streams && ev.streams[0]) || new window.MediaStream([ev.track]);
        ctx.remoteStream = stream;
        this._attachRemoteAudio(ctx, stream);
        this._attachRemoteVad(ctx, stream);
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'failed' && typeof pc.restartIce === 'function') {
          try {
            pc.restartIce();
          } catch (e) {
            // Bỏ qua
          }
        }
        this._emitPeerCount();
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') {
          this._setSpeakingState(peerToken, false);
        }
        this._emitPeerCount();
      };

      if (attachLocal && this.localStream) {
        this._attachLocalTrackToPeer(ctx);
      }

      return ctx;
    }

    _attachLocalTrackToPeer(ctx) {
      if (!ctx || !ctx.pc || !this.localStream || ctx.trackAttached) return;
      const tracks = this.localStream.getAudioTracks();
      if (tracks.length === 0) return;
      try {
        ctx.pc.addTrack(tracks[0], this.localStream);
        ctx.trackAttached = true;
      } catch (e) {
        // Bỏ qua nếu track đã gắn
      }
    }

    _attachRemoteAudio(ctx, stream) {
      const container = this._ensureAudioContainer();
      if (!ctx.audioEl) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        audio.muted = this.audioMuted;
        audio.volume = 1.0;
        container.appendChild(audio);
        ctx.audioEl = audio;
      }
      ctx.audioEl.srcObject = stream;
      ctx.audioEl.muted = this.audioMuted;
      if (!this.audioMuted) {
        ctx.audioEl.play().catch(() => {});
      }
    }

    _destroyPeer(peerToken) {
      const ctx = this.peers.get(peerToken);
      if (!ctx) return;
      if (ctx.iceFlushTimer) {
        clearTimeout(ctx.iceFlushTimer);
        ctx.iceFlushTimer = null;
      }
      if (ctx.remoteSource) {
        try {
          ctx.remoteSource.disconnect();
        } catch (e) {
          // Bỏ qua
        }
      }
      if (ctx.audioEl) {
        try {
          ctx.audioEl.pause();
          ctx.audioEl.srcObject = null;
          if (ctx.audioEl.parentNode) {
            ctx.audioEl.parentNode.removeChild(ctx.audioEl);
          }
        } catch (e) {
          // Bỏ qua
        }
      }
      if (ctx.pc) {
        try {
          ctx.pc.onicecandidate = null;
          ctx.pc.ontrack = null;
          ctx.pc.onnegotiationneeded = null;
          ctx.pc.close();
        } catch (e) {
          // Bỏ qua
        }
      }
      this.peers.delete(peerToken);
      this._setSpeakingState(peerToken, false);
      this._emitPeerCount();
    }

    _countConnectedPeers() {
      let count = 0;
      this.peers.forEach((ctx) => {
        if (
          ctx.pc &&
          (ctx.pc.connectionState === 'connected' ||
            ctx.pc.iceConnectionState === 'connected' ||
            ctx.pc.iceConnectionState === 'completed')
        ) {
          count += 1;
        }
      });
      return count;
    }

    // ==================== SPEAKING INDICATOR (VAD) ====================

    _ensureVadContext() {
      if (this.vadCtx) return this.vadCtx;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.vadCtx = new AudioCtx();
      } catch (e) {
        this.vadCtx = null;
      }
      return this.vadCtx;
    }

    _attachLocalVad(stream) {
      const ctx = this._ensureVadContext();
      if (!ctx || !stream) return;
      try {
        if (this.localSource) {
          this.localSource.disconnect();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        this.localSource = source;
        this.localAnalyser = analyser;
      } catch (e) {
        // Bỏ qua nếu trình duyệt hạn chế MediaStreamSource
      }
    }

    _attachRemoteVad(peerCtx, stream) {
      const ctx = this._ensureVadContext();
      if (!ctx || !stream) return;
      try {
        if (peerCtx.remoteSource) {
          peerCtx.remoteSource.disconnect();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        peerCtx.remoteSource = source;
        peerCtx.remoteAnalyser = analyser;
      } catch (e) {
        // Bỏ qua
      }
    }

    _measureLevel(analyser) {
      if (!analyser) return 0;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      return Math.sqrt(sumSq / buf.length);
    }

    _startVadLoop() {
      if (this.vadTimer) clearInterval(this.vadTimer);
      this.vadTimer = setInterval(() => {
        const now = Date.now();
        // Local mic VAD
        if (this.playerToken) {
          const localActive = this.micEnabled && this.localAnalyser && this._measureLevel(this.localAnalyser) > 0.032;
          this._updateSpeakingWithHold(this.playerToken, localActive, now);
        }
        // Remote peers VAD
        this.peers.forEach((ctx, peerToken) => {
          const remoteActive =
            !this.audioMuted &&
            ctx.remoteAnalyser &&
            this._measureLevel(ctx.remoteAnalyser) > 0.025;
          this._updateSpeakingWithHold(peerToken, remoteActive, now);
        });
      }, 160);
    }

    _updateSpeakingWithHold(token, isLoud, now) {
      if (isLoud) {
        this.speakingHoldUntil.set(token, now + 380);
        this._setSpeakingState(token, true);
      } else {
        const until = this.speakingHoldUntil.get(token) || 0;
        if (now >= until) {
          this._setSpeakingState(token, false);
        }
      }
    }

    _setSpeakingState(token, speaking) {
      const prev = Boolean(this.speakingStates.get(token));
      const next = Boolean(speaking);
      if (prev !== next) {
        this.speakingStates.set(token, next);
        if (typeof this.onSpeakingChange === 'function') {
          this.onSpeakingChange(token, next);
        }
      }
    }

    _emitMicState() {
      if (typeof this.onMicStateChange === 'function') {
        this.onMicStateChange(this.getMicState());
      }
    }

    _emitPeerCount() {
      if (typeof this.onPeerCountChange === 'function') {
        this.onPeerCountChange(this._countConnectedPeers());
      }
    }

    _notify(msg) {
      if (typeof this.onNotice === 'function') {
        this.onNotice(msg);
      }
    }
  }

  window.TLMN_VoiceManager = new TLMNVoiceManager();
})(window, document);
