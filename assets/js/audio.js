(function (window) {
  'use strict';

  // Hệ thống Âm thanh Đa tầng (Web Audio API Synthesizer) & Thông báo ngoài Tab
  class SoundAndAlertManager {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem('tl_muted') === 'true';
      this.unlocked = false;
      this.originalTitle = document.title || 'Tiến Lên Miền Nam Nội Bộ';
      this.flashInterval = null;

      window.addEventListener('focus', () => this.stopTabFlashing());
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.stopTabFlashing();
        }
      });
    }

    initContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = Boolean(this.ctx && this.ctx.state === 'running');
      return this.ctx;
    }

    unlockAudio() {
      const ctx = this.initContext();
      if (ctx) {
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          this.unlocked = true;
        } catch (e) {
          // Bỏ qua nếu trình duyệt chưa sẵn sàng
        }
      }

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      try {
        localStorage.setItem('tl_muted', String(this.muted));
      } catch (e) {
        // Bỏ qua nếu chế độ ẩn danh chặn storage
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

    playJoinSound() {
      this._playTone({ freq: 587.33, type: 'sine', startOffset: 0, duration: 0.16, gain: 0.2 });
      this._playTone({ freq: 880.0, type: 'triangle', startOffset: 0.14, duration: 0.28, gain: 0.25 });
    }

    playRoomFullAlarm() {
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
    }

    playNudgeSound() {
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

    playCardSound() {
      this._playTone({
        freq: 280,
        slideTo: 110,
        type: 'triangle',
        startOffset: 0,
        duration: 0.09,
        gain: 0.26,
      });
    }

    playChopSound() {
      this._playTone({ freq: 220, slideTo: 80, type: 'sawtooth', startOffset: 0, duration: 0.25, gain: 0.35 });
      this._playTone({ freq: 587.33, type: 'sawtooth', startOffset: 0.06, duration: 0.18, gain: 0.3 });
      this._playTone({ freq: 880, type: 'triangle', startOffset: 0.2, duration: 0.38, gain: 0.38 });
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
          // Bỏ qua nếu môi trường chặn Notification
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
