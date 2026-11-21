(function (window) {
  'use strict';

  // Hệ thống Âm thanh Đa tầng (Web Audio API Synthesizer + Tiếng đập bài thật + Giọng nói Tiếng Việt)
  class SoundAndAlertManager {
    constructor() {
      this.ctx = null;
      this.noiseBuffer = null;
      this.muted = localStorage.getItem('tl_muted') === 'true';
      this.voiceEnabled = localStorage.getItem('tl_voice_off') !== 'true';
      this.unlocked = false;
      this.originalTitle = document.title || 'Tiến Lên Miền Nam Nội Bộ';
      this.flashInterval = null;
      this.viVoice = null;
      this.clipCache = {};
      this.decodedBufferCache = {};
      this.loadingClipPromises = {};
      this.currentVoiceAudio = null;
      this.currentVoiceSource = null;
      this.htmlAudioUnlocked = false;
      this.preloadedStarted = false;
      this.sharedVoiceAudio = null;
      this.wakeLockSentinel = null;
      this.keepAliveActive = false;
      this.keepAliveTimer = null;

      if (typeof window.Audio !== 'undefined') {
        try {
          this.sharedVoiceAudio = new window.Audio();
          this.sharedVoiceAudio.preload = 'auto';
          this.sharedVoiceAudio.setAttribute('playsinline', 'true');
          this.sharedVoiceAudio.setAttribute('webkit-playsinline', 'true');
        } catch (e) {
          this.sharedVoiceAudio = null;
        }
      }

      window.addEventListener('focus', () => {
        this.stopTabFlashing();
        if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
          this.ctx.resume().catch(() => {});
        }
        if (this.keepAliveActive) {
          this._requestWakeLock();
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.stopTabFlashing();
          if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
            this.ctx.resume().catch(() => {});
          }
          if (this.keepAliveActive) {
            this._requestWakeLock();
          }
        }
      });

      this._initSpeechVoices();
      this._bindGlobalAudioUnlock();
    }

    _bindGlobalAudioUnlock() {
      const onGesture = () => {
        if (
          !this.ctx ||
          this.ctx.state !== 'running' ||
          !this.unlocked ||
          !this.htmlAudioUnlocked ||
          !this.preloadedStarted
        ) {
          this.unlockAudio();
        }
      };
      ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click', 'keydown'].forEach((evt) => {
        window.addEventListener(evt, onGesture, { passive: true, capture: true });
      });
    }

    _initSpeechVoices() {
      if (!('speechSynthesis' in window)) return;
      const pickVoice = () => {
        try {
          const voices = window.speechSynthesis.getVoices() || [];
          this.viVoice =
            voices.find((v) => /vi[-_]?VN/i.test(v.lang) && /Natural|Online|Google|HoaiMy|NamMinh/i.test(v.name)) ||
            voices.find((v) => /^vi/i.test(v.lang)) ||
            null;
        } catch (e) {
          // Bỏ qua nếu trình duyệt không hỗ trợ
        }
      };
      pickVoice();
      if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = pickVoice;
      }
    }

    initContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          try {
            this.ctx = new AudioCtx();
          } catch (e) {
            this.ctx = null;
          }
        }
      }
      if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = Boolean(this.ctx && this.ctx.state === 'running');
      return this.ctx;
    }

    _resolveClipUrl(audioClip) {
      if (!audioClip) return '';
      const cfg = window.TLMN_CONFIG || {};
      const audioBase = cfg.audioBase ? String(cfg.audioBase) : '';
      if (!audioBase) return '';

      const cleanClip = String(audioClip).replace(/^\/+/, '');
      const verSuffix = cfg.audioVer ? '?v=' + encodeURIComponent(String(cfg.audioVer)) : '';
      const rawUrl = audioBase.replace(/\/+$/, '') + '/' + cleanClip + verSuffix;

      try {
        const parsed = new URL(rawUrl, window.location.href);
        if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
          parsed.protocol = 'https:';
        }
        if (parsed.hostname === window.location.hostname) {
          return parsed.pathname + parsed.search;
        }
        return parsed.toString();
      } catch (e) {
        return rawUrl;
      }
    }

    _decodeAudioData(ctx, arrayBuffer) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const onResolve = (buf) => {
          if (!settled) {
            settled = true;
            resolve(buf);
          }
        };
        const onReject = (err) => {
          if (!settled) {
            settled = true;
            reject(err || new Error('Decode failed'));
          }
        };
        try {
          const p = ctx.decodeAudioData(arrayBuffer, onResolve, onReject);
          if (p && typeof p.then === 'function') {
            p.then(onResolve).catch(onReject);
          }
        } catch (e) {
          onReject(e);
        }
      });
    }

    _loadClipBuffer(clipUrl) {
      if (!clipUrl) return Promise.reject(new Error('Empty clipUrl'));
      if (this.decodedBufferCache[clipUrl]) {
        return Promise.resolve(this.decodedBufferCache[clipUrl]);
      }
      if (this.loadingClipPromises[clipUrl]) {
        return this.loadingClipPromises[clipUrl];
      }
      const ctx = this.initContext();
      if (!ctx || typeof window.fetch !== 'function') {
        return Promise.reject(new Error('Web Audio fetch unavailable'));
      }

      this.loadingClipPromises[clipUrl] = window
        .fetch(clipUrl, { credentials: 'same-origin' })
        .then((resp) => {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.arrayBuffer();
        })
        .then((arrayBuf) => this._decodeAudioData(ctx, arrayBuf))
        .then((audioBuf) => {
          this.decodedBufferCache[clipUrl] = audioBuf;
          delete this.loadingClipPromises[clipUrl];
          return audioBuf;
        })
        .catch((err) => {
          delete this.loadingClipPromises[clipUrl];
          throw err;
        });

      return this.loadingClipPromises[clipUrl];
    }

    preloadVoiceClips() {
      if (this.preloadedStarted) return;
      const cfg = window.TLMN_CONFIG || {};
      if (!cfg.audioBase) return;
      this.preloadedStarted = true;

      // Ưu tiên nạp trước các âm báo có người vào phòng & 6 câu cà khịa trên thanh bấm nhanh cho mobile
      const priorityClips = [
        'player_join.mp3',
        'room_full.mp3',
        'nudge_1.mp3',
        'counter_1.mp3',
        'followup_1.mp3',
        'quick_warn.mp3',
        'quick_hurry.mp3',
        'quick_age.mp3',
        'quick_mercy.mp3',
        'chop_1.mp3',
        'chop_2.mp3',
        'counter_2.mp3',
        'counter_3.mp3',
        'followup_2.mp3',
        'lastcard_1.mp3',
        'pig_1.mp3',
        'win_1.mp3',
      ];

      priorityClips.forEach((clipName) => {
        const url = this._resolveClipUrl(clipName);
        if (url) {
          this._loadClipBuffer(url).catch(() => {});
        }
      });
    }

    _getNoiseBuffer(ctx) {
      if (this.noiseBuffer) return this.noiseBuffer;
      const sampleRate = ctx.sampleRate;
      const length = Math.floor(sampleRate * 0.16);
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        // White noise pha chút pink envelope cho tiếng giấy bài tự nhiên
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.045));
      }
      this.noiseBuffer = buffer;
      return buffer;
    }

    unlockAudio() {
      const ctx = this.initContext();
      if (ctx) {
        try {
          if (ctx.state !== 'running') {
            ctx.resume().catch(() => {});
          }
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          if (typeof source.start === 'function') {
            source.start(0);
          } else if (typeof source.noteOn === 'function') {
            source.noteOn(0);
          }
          this.unlocked = true;
        } catch (e) {
          // Bỏ qua
        }
      }

      // Mở khóa phần tử HTML5 Audio dự phòng ngay trong thao tác chạm đầu tiên trên điện thoại
      if (!this.htmlAudioUnlocked && this.sharedVoiceAudio) {
        try {
          this.sharedVoiceAudio.src =
            'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          this.sharedVoiceAudio.volume = 0.01;
          const playPromise = this.sharedVoiceAudio.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise
              .then(() => {
                this.sharedVoiceAudio.pause();
                this.sharedVoiceAudio.currentTime = 0;
                this.sharedVoiceAudio.volume = 1.0;
                this.htmlAudioUnlocked = true;
              })
              .catch(() => {});
          }
        } catch (e) {
          // Bỏ qua
        }
      }

      // Nạp sẵn các clip MP3 vào bộ nhớ Web Audio API
      this.preloadVoiceClips();

      // Mở khóa Web Speech API trên trình duyệt di động/desktop
      if ('speechSynthesis' in window) {
        try {
          this._initSpeechVoices();
        } catch (e) {
          // Bỏ qua
        }
      }

      if (this.keepAliveActive) {
        this._requestWakeLock();
      }
    }

    /**
     * Giữ màn hình điện thoại không tự tắt (Screen Wake Lock) và giữ AudioContext luôn sống
     * khi người tạo bàn để điện thoại trên bàn chờ bạn bè bấm link vào phòng.
     */
    setRoomKeepAlive(active) {
      this.keepAliveActive = Boolean(active);
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }

      if (this.keepAliveActive) {
        this._requestWakeLock();
        this.keepAliveTimer = setInterval(() => {
          if (!this.keepAliveActive || this.muted) return;
          const ctx = this.initContext();
          if (ctx && ctx.state === 'running') {
            try {
              const buf = ctx.createBuffer(1, 1, 22050);
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(ctx.destination);
              src.start(0);
            } catch (e) {
              // Bỏ qua
            }
          }
        }, 12000);
      } else {
        this._releaseWakeLock();
      }
    }

    _requestWakeLock() {
      if (!this.keepAliveActive || document.hidden) return;
      if (this.wakeLockSentinel && !this.wakeLockSentinel.released) return;
      if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
        navigator.wakeLock
          .request('screen')
          .then((sentinel) => {
            this.wakeLockSentinel = sentinel;
          })
          .catch(() => {});
      }
    }

    _releaseWakeLock() {
      if (this.wakeLockSentinel) {
        try {
          this.wakeLockSentinel.release().catch(() => {});
        } catch (e) {
          // Bỏ qua
        }
        this.wakeLockSentinel = null;
      }
    }

    vibrateDevice(pattern) {
      if (this.muted) return;
      if (navigator && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(pattern || [200, 100, 250]);
        } catch (e) {
          // Bỏ qua nếu trình duyệt không hỗ trợ rung
        }
      }
    }

    _stopCurrentVoice() {
      if (this.currentVoiceSource) {
        try {
          this.currentVoiceSource.stop(0);
          this.currentVoiceSource.disconnect();
        } catch (e) {
          // Bỏ qua
        }
        this.currentVoiceSource = null;
      }
      if (this.currentVoiceAudio) {
        try {
          this.currentVoiceAudio.pause();
          this.currentVoiceAudio.currentTime = 0;
        } catch (e) {
          // Bỏ qua
        }
      }
    }

    _playDecodedBuffer(audioBuf) {
      if (this.muted || !audioBuf) return false;
      const ctx = this.initContext();
      if (!ctx) return false;

      this._stopCurrentVoice();
      try {
        const source = ctx.createBufferSource();
        source.buffer = audioBuf;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1.25, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.onended = () => {
          if (this.currentVoiceSource === source) {
            this.currentVoiceSource = null;
          }
        };
        this.currentVoiceSource = source;
        source.start(0);
        return true;
      } catch (e) {
        return false;
      }
    }

    _playHtmlAudioOrSpeech(clipUrl, voiceText) {
      if (this.muted) return;
      if (clipUrl && typeof window.Audio !== 'undefined') {
        try {
          this._stopCurrentVoice();
          const audioEl = this.sharedVoiceAudio || this.clipCache[clipUrl] || new window.Audio();
          audioEl.src = clipUrl;
          audioEl.volume = 1.0;
          audioEl.currentTime = 0;
          this.currentVoiceAudio = audioEl;
          const playPromise = audioEl.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
              this._fallbackSpeech(voiceText);
            });
          }
          return;
        } catch (e) {
          // Rơi xuống fallback Web Speech
        }
      }
      this._fallbackSpeech(voiceText);
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      try {
        localStorage.setItem('tl_muted', String(this.muted));
      } catch (e) {
        // Bỏ qua
      }
      if (this.muted && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (e) {
          // Bỏ qua
        }
      }
      if (this.muted) {
        this._stopCurrentVoice();
      }
      return this.muted;
    }

    toggleMute() {
      return this.setMuted(!this.muted);
    }

    _playTone(opts) {
      const freq = opts.freq !== undefined ? opts.freq : 440;
      const type = opts.type || 'sine';
      const startOffset = opts.startOffset || 0;
      const duration = opts.duration || 0.15;
      const gain = opts.gain !== undefined ? opts.gain : 0.22;
      const slideTo = opts.slideTo || null;

      if (this.muted) return;
      const ctx = this.initContext();
      if (!ctx) return;

      const now = ctx.currentTime + startOffset;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
      }

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.linearRampToValueAtTime(gain, now + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0008, now + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    /**
     * Tiếng quân bài đập/quật xuống mặt bàn nỉ (Card Snap + Paper Slap + Felt/Wood Table Thud)
     */
    playCardSound(cardCount) {
      if (this.muted) return;
      const ctx = this.initContext();
      if (!ctx) return;

      const count = Math.max(1, Number(cardCount) || 1);
      const isMulti = count >= 2;
      const noiseBuf = this._getNoiseBuffer(ctx);
      const baseDelay = isMulti ? 0.022 : 0;
      const now = ctx.currentTime + baseDelay;

      // Nếu đánh bộ nhiều lá (Đôi, Sám, Sảnh, Đôi thông): thêm tiếng vẩy gió nhẹ trước khi đập xuống bàn
      if (isMulti) {
        const swishSrc = ctx.createBufferSource();
        swishSrc.buffer = noiseBuf;
        const swishFilter = ctx.createBiquadFilter();
        swishFilter.type = 'bandpass';
        swishFilter.frequency.setValueAtTime(2600, ctx.currentTime);
        swishFilter.Q.setValueAtTime(1.8, ctx.currentTime);

        const swishGain = ctx.createGain();
        swishGain.gain.setValueAtTime(0.001, ctx.currentTime);
        swishGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.01);
        swishGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.032);

        swishSrc.connect(swishFilter);
        swishFilter.connect(swishGain);
        swishGain.connect(ctx.destination);
        swishSrc.start(ctx.currentTime);
        swishSrc.stop(ctx.currentTime + 0.035);
      }

      // 1. Lớp Card Snap (tiếng "Phạch!" đanh giòn của lá bài cứng đập xuống mặt bàn)
      const snapSrc = ctx.createBufferSource();
      snapSrc.buffer = noiseBuf;
      const snapFilter = ctx.createBiquadFilter();
      snapFilter.type = 'bandpass';
      snapFilter.frequency.setValueAtTime(1750, now);
      snapFilter.Q.setValueAtTime(1.15, now);

      const snapGain = ctx.createGain();
      const snapPeak = isMulti ? 0.85 : 0.72;
      snapGain.gain.setValueAtTime(0.001, now);
      snapGain.gain.linearRampToValueAtTime(snapPeak, now + 0.0025);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.058);

      snapSrc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(ctx.destination);
      snapSrc.start(now);
      snapSrc.stop(now + 0.065);

      // 2. Lớp Crisp Edge (tiếng tát cạnh lá bài sắc nét ở tần số cao)
      const edgeSrc = ctx.createBufferSource();
      edgeSrc.buffer = noiseBuf;
      const edgeFilter = ctx.createBiquadFilter();
      edgeFilter.type = 'highpass';
      edgeFilter.frequency.setValueAtTime(3100, now);

      const edgeGain = ctx.createGain();
      edgeGain.gain.setValueAtTime(0.001, now);
      edgeGain.gain.linearRampToValueAtTime(isMulti ? 0.48 : 0.36, now + 0.0018);
      edgeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

      edgeSrc.connect(edgeFilter);
      edgeFilter.connect(edgeGain);
      edgeGain.connect(ctx.destination);
      edgeSrc.start(now);
      edgeSrc.stop(now + 0.032);

      // 3. Lớp Table Thud (tiếng "Bụp!" trầm chắc của mặt bàn gỗ bọc nỉ)
      const thudOsc = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(isMulti ? 185 : 165, now);
      thudOsc.frequency.exponentialRampToValueAtTime(44, now + 0.075);

      thudGain.gain.setValueAtTime(0.001, now);
      thudGain.gain.linearRampToValueAtTime(isMulti ? 0.65 : 0.52, now + 0.004);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      thudOsc.connect(thudGain);
      thudGain.connect(ctx.destination);
      thudOsc.start(now);
      thudOsc.stop(now + 0.09);

      // 4. Lớp Body Punch (cộng hưởng gỗ ấm)
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(115, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(38, now + 0.06);

      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.linearRampToValueAtTime(0.32, now + 0.003);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      bodyOsc.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      bodyOsc.start(now);
      bodyOsc.stop(now + 0.07);
    }

    /**
     * Tiếng Chặt Heo / Đôi Heo / Đè Hàng (Đập bài cực mạnh + Hiệu ứng chém chấn động)
     */
    playChopSound() {
      if (this.muted) return;
      this.playCardSound(6);
      this._playTone({ freq: 240, slideTo: 65, type: 'sawtooth', startOffset: 0.02, duration: 0.28, gain: 0.38 });
      this._playTone({ freq: 587.33, type: 'sawtooth', startOffset: 0.08, duration: 0.16, gain: 0.3 });
      this._playTone({ freq: 880, type: 'triangle', startOffset: 0.2, duration: 0.35, gain: 0.38 });
      this._playTone({ freq: 1174.66, type: 'triangle', startOffset: 0.32, duration: 0.4, gain: 0.4 });
    }

    /**
     * Phát câu nói cà khịa / tương tác vui nhộn Giọng Miền Nam
     * (Ưu tiên Web Audio API AudioBuffer để vượt rào cản chặn Autoplay trên Mobile -> HTML5 Audio -> Web Speech)
     */
    speakBanter(voiceText, banterKind, audioClip) {
      if (this.muted || (!voiceText && !audioClip)) return;

      const ctx = this.initContext();

      // 1. Nhạc hiệu ứng ngắn (Comic Stinger) theo tình huống
      if (banterKind === 'COUNTER_3X') {
        this._playTone({ freq: 659.25, type: 'triangle', startOffset: 0.02, duration: 0.08, gain: 0.16 });
        this._playTone({ freq: 783.99, type: 'triangle', startOffset: 0.1, duration: 0.08, gain: 0.18 });
        this._playTone({ freq: 1046.5, type: 'sawtooth', startOffset: 0.18, duration: 0.14, gain: 0.16 });
      } else if (banterKind === 'FOLLOW_UP_STRIKE') {
        this._playTone({ freq: 587.33, type: 'triangle', startOffset: 0.02, duration: 0.09, gain: 0.16 });
        this._playTone({ freq: 880.0, type: 'sawtooth', startOffset: 0.11, duration: 0.15, gain: 0.16 });
      } else if (banterKind === 'LAST_CARD') {
        this._playTone({ freq: 880, type: 'square', startOffset: 0.02, duration: 0.08, gain: 0.16 });
        this._playTone({ freq: 1318.5, type: 'square', startOffset: 0.12, duration: 0.12, gain: 0.18 });
      } else if (banterKind === 'PIG_PLAYED') {
        this._playTone({ freq: 392, slideTo: 587.33, type: 'triangle', startOffset: 0.02, duration: 0.18, gain: 0.18 });
      }

      if (!this.voiceEnabled) return;

      // 2. Phát file MP3 Giọng Miền Nam qua Web Audio API (hoạt động 100% trên cả iOS Safari & Android Mobile)
      const clipUrl = this._resolveClipUrl(audioClip);
      if (clipUrl) {
        if (this.decodedBufferCache[clipUrl] && this._playDecodedBuffer(this.decodedBufferCache[clipUrl])) {
          return;
        }
        if (ctx && typeof window.fetch === 'function') {
          this._loadClipBuffer(clipUrl)
            .then((audioBuf) => {
              if (!this.muted) {
                if (!this._playDecodedBuffer(audioBuf)) {
                  this._playHtmlAudioOrSpeech(clipUrl, voiceText);
                }
              }
            })
            .catch(() => {
              this._playHtmlAudioOrSpeech(clipUrl, voiceText);
            });
          return;
        }
        this._playHtmlAudioOrSpeech(clipUrl, voiceText);
        return;
      }

      // 3. Dự phòng bằng Web Speech API nếu không có file MP3
      this._fallbackSpeech(voiceText);
    }

    _fallbackSpeech(voiceText) {
      if (this.muted || !voiceText) return;
      if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
        return;
      }
      try {
        if (!this.viVoice) {
          this._initSpeechVoices();
        }
        window.speechSynthesis.cancel();
        const cleanSpeech = String(voiceText).replace(/[^\p{L}\p{N}\s,!?.]/gu, '').trim();
        if (!cleanSpeech) return;

        const utt = new window.SpeechSynthesisUtterance(cleanSpeech);
        utt.lang = 'vi-VN';
        if (this.viVoice) {
          utt.voice = this.viVoice;
        }
        utt.rate = 1.12;
        utt.pitch = 1.06;
        utt.volume = 1.0;
        window.speechSynthesis.speak(utt);
      } catch (e) {
        // Bỏ qua
      }
    }

    /**
     * Tiếng thông báo tin nhắn chat mới ("Pop-ting" vui tai)
     */
    playChatSound() {
      this._playTone({ freq: 659.25, type: 'sine', startOffset: 0, duration: 0.07, gain: 0.18 });
      this._playTone({ freq: 987.77, type: 'triangle', startOffset: 0.06, duration: 0.12, gain: 0.22 });
    }

    playJoinSound() {
      this._playTone({ freq: 587.33, type: 'sine', startOffset: 0, duration: 0.16, gain: 0.22 });
      this._playTone({ freq: 880.0, type: 'triangle', startOffset: 0.14, duration: 0.28, gain: 0.26 });
    }

    /**
     * Chuông báo + Rung + Giọng nói tự động gọi chủ bàn khi để điện thoại đó và có người mới bấm link vào bàn
     */
    playIncomingPlayerAlert(nickname, playerCount) {
      if (this.muted) return;

      // 1. Rung điện thoại (Android / Oppo)
      this.vibrateDevice([220, 100, 260, 100, 320]);

      // 2. Chuông cửa 4 nhịp vang rõ (Ding-Dong-Ding-Dong)
      const chimes = [
        { freq: 783.99, start: 0, dur: 0.16, gain: 0.36 },
        { freq: 987.77, start: 0.15, dur: 0.18, gain: 0.38 },
        { freq: 1174.66, start: 0.33, dur: 0.18, gain: 0.4 },
        { freq: 1567.98, start: 0.5, dur: 0.35, gain: 0.42 },
      ];
      chimes.forEach((n) => {
        this._playTone({
          freq: n.freq,
          type: 'triangle',
          startOffset: n.start,
          duration: n.dur,
          gain: n.gain,
        });
      });

      // 3. Phát giọng nói thông báo "Ting ting! Có đồng đội mới vô bàn kìa!"
      const voiceText =
        (nickname ? nickname + ' vừa vô bàn kìa! ' : 'Có đồng đội mới vô bàn kìa! ') +
        'Vào bấm sẵn sàng chia bài nghen!';
      this.speakBanter(voiceText, null, 'player_join.mp3');
    }

    playRoomFullAlarm() {
      if (this.muted) return;
      this.vibrateDevice([300, 120, 300, 120, 420]);

      const bellNotes = [0, 0.11, 0.22, 0.33];
      bellNotes.forEach((offset, idx) => {
        this._playTone({
          freq: idx % 2 === 0 ? 1174.66 : 1396.91,
          type: 'triangle',
          startOffset: offset,
          duration: 0.1,
          gain: 0.32,
        });
      });

      const fanfare = [
        { freq: 523.25, start: 0.5, dur: 0.16, gain: 0.32 },
        { freq: 659.25, start: 0.68, dur: 0.16, gain: 0.32 },
        { freq: 783.99, start: 0.86, dur: 0.18, gain: 0.35 },
        { freq: 1046.5, start: 1.06, dur: 0.35, gain: 0.38 },
        { freq: 783.99, start: 1.45, dur: 0.15, gain: 0.34 },
        { freq: 1046.5, start: 1.63, dur: 0.55, gain: 0.42 },
      ];

      fanfare.forEach((n) => {
        this._playTone({
          freq: n.freq,
          type: 'sawtooth',
          startOffset: n.start,
          duration: n.dur,
          gain: n.gain * 0.55,
        });
        this._playTone({
          freq: n.freq,
          type: 'triangle',
          startOffset: n.start,
          duration: n.dur,
          gain: n.gain,
        });
      });

      this.speakBanter('Đủ bốn chân rồi anh em ơi! Bấm sẵn sàng chia bài liền nè!', null, 'room_full.mp3');
    }

    playNudgeSound() {
      if (this.muted) return;
      this.vibrateDevice([200, 80, 200, 80, 300]);

      [0, 0.14, 0.28].forEach((offset) => {
        this._playTone({
          freq: 320,
          slideTo: 140,
          type: 'square',
          startOffset: offset,
          duration: 0.08,
          gain: 0.32,
        });
      });
      this._playTone({ freq: 987.77, type: 'triangle', startOffset: 0.45, duration: 0.15, gain: 0.35 });
      this._playTone({ freq: 1318.51, type: 'triangle', startOffset: 0.62, duration: 0.3, gain: 0.38 });

      this.speakBanter('Alo alo! Vô bàn bấm sẵn sàng đánh bài lẹ đi bồ ơi!', null, 'nudge_1.mp3');
    }

    playCountdownBeep(secondsLeft) {
      const freq = secondsLeft === 1 ? 987.77 : 783.99;
      this._playTone({
        freq: freq,
        type: 'sine',
        startOffset: 0,
        duration: 0.18,
        gain: 0.3,
      });
    }

    playGameStartSound() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        this._playTone({
          freq: freq,
          type: 'triangle',
          startOffset: i * 0.08,
          duration: 0.22,
          gain: 0.28,
        });
      });
    }

    playPassSound() {
      this._playTone({
        freq: 240,
        slideTo: 150,
        type: 'sine',
        startOffset: 0,
        duration: 0.12,
        gain: 0.15,
      });
    }

    playWinSound() {
      const melody = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      melody.forEach((freq, idx) => {
        this._playTone({
          freq: freq,
          type: 'triangle',
          startOffset: idx * 0.11,
          duration: 0.28,
          gain: 0.3,
        });
      });
    }

    triggerUrgentTabAlert(shortTabTitle, notificationTitle, notificationBody) {
      this.startTabFlashing(shortTabTitle);

      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const notif = new Notification(notificationTitle, {
            body: notificationBody,
            tag: 'tien-len-room-alert',
            renotify: true,
          });
          notif.onclick = function () {
            window.focus();
            notif.close();
          };
        } catch (e) {
          // Bỏ qua
        }
      }
    }

    startTabFlashing(alertText) {
      const label = alertText || '🔔 [4/4 ĐỦ NGƯỜI!]';
      this.stopTabFlashing();
      let toggle = false;
      this.flashInterval = setInterval(() => {
        document.title = toggle ? this.originalTitle : label + ' — Tiến Lên';
        toggle = !toggle;
      }, 650);
    }

    stopTabFlashing() {
      if (this.flashInterval) {
        clearInterval(this.flashInterval);
        this.flashInterval = null;
      }
      document.title = this.originalTitle;
    }
  }

  window.TLMN_SoundManager = new SoundAndAlertManager();
})(window);
