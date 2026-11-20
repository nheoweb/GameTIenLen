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

  /**
   * Gọi ngay khi người chơi click nút "Tạo bàn" hoặc "Vào bàn" để mở khóa Autoplay của trình duyệt
   */
  unlockAudio() {
    const ctx = this.initContext();
    if (ctx) {
      // Phát 1 xung im lặng cực ngắn để mở khóa hoàn toàn AudioContext trên Safari/Chrome
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        this.unlocked = true;
      } catch {
        // Bỏ qua nếu trình duyệt chưa sẵn sàng
      }
    }

    // Xin quyền thông báo màn hình Desktop nếu trình duyệt hỗ trợ
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    localStorage.setItem('tl_muted', String(this.muted));
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /**
   * Hàm cơ sở tạo nốt nhạc bằng Oscillator
   */
  _playTone({ freq = 440, type = 'sine', startOffset = 0, duration = 0.15, gain = 0.22, slideTo = null }) {
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
   * 1. Tiếng "Ting-tong" nhẹ khi người thứ 2 hoặc thứ 3 bước vào bàn
   */
  playJoinSound() {
    this._playTone({ freq: 587.33, type: 'sine', startOffset: 0, duration: 0.16, gain: 0.2 }); // D5
    this._playTone({ freq: 880.0, type: 'triangle', startOffset: 0.14, duration: 0.28, gain: 0.25 }); // A5
  }

  /**
   * 2. ÂM BÁO TẬP HỢP KHI ĐỦ 4/4 NGƯỜI VÀO PHÒNG (Chuông reng + Fanfare bắt tai ~2.2 giây)
   * Đủ to và rõ để người chơi đang Alt+Tab sang cửa sổ khác nghe thấy ngay lập tức.
   */
  playRoomFullAlarm() {
    // Hồi chuông reng dồn dập mở đầu
    const bellNotes = [0, 0.11, 0.22, 0.33];
    bellNotes.forEach((offset, idx) => {
      this._playTone({
        freq: idx % 2 === 0 ? 1174.66 : 1396.91, // D6 <-> F6
        type: 'triangle',
        startOffset: offset,
        duration: 0.1,
        gain: 0.32,
      });
    });

    // Đoạn kèn Fanfare tập hợp: C5 -> E5 -> G5 -> C6 (giữ ngân) -> G5 -> C6!
    const fanfare = [
      { freq: 523.25, start: 0.5, dur: 0.16, gain: 0.32 },  // C5
      { freq: 659.25, start: 0.68, dur: 0.16, gain: 0.32 }, // E5
      { freq: 783.99, start: 0.86, dur: 0.18, gain: 0.35 }, // G5
      { freq: 1046.5, start: 1.06, dur: 0.35, gain: 0.38 }, // C6
      { freq: 783.99, start: 1.45, dur: 0.15, gain: 0.34 }, // G5
      { freq: 1046.5, start: 1.63, dur: 0.55, gain: 0.42 }, // C6 chốt vang
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

  /**
   * 3. Tiếng "Gõ bàn / Hú đồng đội" khi có người quên bấm Sẵn sàng hoặc quên đánh bài
   */
  playNudgeSound() {
    // 3 tiếng gõ bàn cốc-cốc-cốc
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
    // Kèm 2 tiếng chuông nhắc cao
    this._playTone({ freq: 987.77, type: 'triangle', startOffset: 0.45, duration: 0.15, gain: 0.35 });
    this._playTone({ freq: 1318.51, type: 'triangle', startOffset: 0.62, duration: 0.3, gain: 0.38 });
  }

  /**
   * 4. Tiếng Bíp đếm ngược (3... 2... 1...) trước khi chia bài
   */
  playCountdownBeep(secondsLeft = 3) {
    const freq = secondsLeft === 1 ? 987.77 : 783.99;
    this._playTone({
      freq,
      type: 'sine',
      startOffset: 0,
      duration: 0.18,
      gain: 0.3,
    });
  }

  /**
   * 5. Tiếng bắt đầu chia bài vào ván
   */
  playGameStartSound() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      this._playTone({
        freq,
        type: 'triangle',
        startOffset: i * 0.08,
        duration: 0.22,
        gain: 0.28,
      });
    });
  }

  /**
   * 6. Tiếng đặt bài xuống bàn
   */
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

  /**
   * 7. Tiếng chặt Heo / Tứ quý / Đôi thông
   */
  playChopSound() {
    this._playTone({ freq: 220, slideTo: 80, type: 'sawtooth', startOffset: 0, duration: 0.25, gain: 0.35 });
    this._playTone({ freq: 587.33, type: 'sawtooth', startOffset: 0.06, duration: 0.18, gain: 0.3 });
    this._playTone({ freq: 880, type: 'triangle', startOffset: 0.2, duration: 0.38, gain: 0.38 });
  }

  /**
   * 8. Tiếng bỏ lượt
   */
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

  /**
   * 9. Tiếng kết thúc ván (Chiến thắng)
   */
  playWinSound() {
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    melody.forEach((freq, idx) => {
      this._playTone({
        freq,
        type: 'triangle',
        startOffset: idx * 0.11,
        duration: 0.28,
        gain: 0.3,
      });
    });
  }

  /**
   * Nháy tiêu đề Tab & Đẩy Desktop Notification khi người chơi đang ẩn tab
   */
  triggerUrgentTabAlert(shortTabTitle, notificationTitle, notificationBody) {
    this.startTabFlashing(shortTabTitle);

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(notificationTitle, {
          body: notificationBody,
          tag: 'tien-len-room-alert',
          renotify: true,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch {
        // Bỏ qua nếu môi trường chặn Notification
      }
    }
  }

  startTabFlashing(alertText = '🔔 [4/4 ĐỦ NGƯỜI!]') {
    this.stopTabFlashing();
    let toggle = false;
    this.flashInterval = setInterval(() => {
      document.title = toggle ? this.originalTitle : `${alertText} — Tiến Lên`;
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

export const soundManager = new SoundAndAlertManager();
