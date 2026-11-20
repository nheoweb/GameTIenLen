<?php
/**
 * Markup HTML dùng chung cho cả chế độ Toàn màn hình và Nhúng Shortcode.
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$tlmn_is_fullscreen = isset( $tlmn_is_fullscreen ) ? (bool) $tlmn_is_fullscreen : true;
$tlmn_root_class    = $tlmn_is_fullscreen ? 'tlmn-root tlmn-fullscreen-mode' : 'tlmn-root tlmn-embed-mode';
?>
<div id="tlmnAppRoot" class="<?php echo esc_attr( $tlmn_root_class ); ?>">
	<div class="app-shell">
		<!-- Thanh Header chung -->
		<header class="topbar">
			<div class="brand">
				<span class="brand-icon" aria-hidden="true">🃏</span>
				<div>
					<h1 class="brand-title">Tiến Lên Miền Nam</h1>
					<p class="brand-subtitle">Sảnh nội bộ Online (2 – 4 người)</p>
				</div>
			</div>

			<div class="topbar-actions">
				<button id="btnTestAlarm" type="button" class="btn btn-outline btn-sm" title="Nghe thử âm báo khi phòng đủ 4 người">
					🔔 Nghe thử chuông đủ 4 người
				</button>
				<button id="btnToggleSound" type="button" class="btn btn-outline btn-sm" aria-pressed="false">
					🔊 Âm thanh: BẬT
				</button>
				<?php if ( $tlmn_is_fullscreen ) : ?>
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="btn btn-outline btn-sm">
						🏠 Trang chủ
					</a>
				<?php endif; ?>
			</div>
		</header>

		<!-- Banner thông báo nổi (Toast / Room Full Alert) -->
		<div id="alertBanner" class="alert-banner hidden" role="alert" aria-live="assertive">
			<span id="alertBannerText"></span>
		</div>

		<!-- MÀN HÌNH 1: SẢNH CHỜ NỘI BỘ (LIVE LOBBY) -->
		<main id="lobbyView" class="lobby-container">
			<!-- Cột trái: Thông tin người chơi & Tạo / Vào bàn nhanh -->
			<section class="panel-card">
				<h2 class="panel-title">1. Định danh &amp; Vào Bàn Nhanh</h2>
				<div class="form-group">
					<label for="inputNickname">Tên hiển thị (Nickname của bạn)</label>
					<input
						id="inputNickname"
						type="text"
						maxlength="20"
						placeholder="VD: Minh IT, Tuấn..."
						autocomplete="off"
					/>
					<small class="help-text">Hệ thống tự lưu phiên để nếu lỡ bấm F5 bạn vẫn giữ nguyên ghế và bài.</small>
				</div>

				<hr class="divider" />

				<div class="form-group">
					<label for="inputRoomName">Tạo bàn mới</label>
					<div class="input-row">
						<input
							id="inputRoomName"
							type="text"
							maxlength="30"
							placeholder="Tên bàn (VD: Bàn Trưa Văn Phòng)"
						/>
						<button id="btnCreateRoom" type="button" class="btn btn-primary">
							➕ Tạo Bàn
						</button>
					</div>
				</div>

				<div class="form-group">
					<label for="inputRoomCode">Hoặc nhập Mã phòng 4 số</label>
					<div class="input-row">
						<input
							id="inputRoomCode"
							type="text"
							maxlength="4"
							inputmode="numeric"
							pattern="[0-9]*"
							placeholder="VD: 4821"
						/>
						<button id="btnJoinByCode" type="button" class="btn btn-secondary">
							🔑 Vào Bàn
						</button>
					</div>
				</div>

				<div class="share-info-box">
					<div class="share-info-title">🔗 Link sảnh chơi gửi cho nhóm bạn:</div>
					<div class="share-url-row">
						<span id="shareLobbyUrlText" class="share-url-text"></span>
						<button id="btnCopyLobbyUrl" type="button" class="btn btn-outline btn-sm">📋 Copy</button>
					</div>
				</div>
			</section>

			<!-- Cột phải: Danh sách bàn đang mở trực tiếp -->
			<section class="panel-card lobby-list-panel">
				<div class="panel-header-row">
					<div>
						<h2 class="panel-title">2. Sảnh Chờ Nội Bộ (Live Rooms)</h2>
						<p class="panel-desc">Danh sách các bàn đang mở cập nhật tự động.</p>
					</div>
					<span id="lobbyCountBadge" class="badge badge-gold">0 bàn đang mở</span>
				</div>

				<div id="lobbyRoomsList" class="rooms-grid" role="list">
					<!-- Render động danh sách bàn -->
				</div>
			</section>
		</main>

		<!-- MÀN HÌNH 2: PHÒNG CHỜ & BÀN CHƠI TIẾN LÊN -->
		<main id="roomView" class="room-container hidden">
			<!-- Thanh công cụ của Phòng -->
			<div class="room-toolbar">
				<div class="room-meta">
					<span class="room-code-badge">MÃ BÀN: #<strong id="lblRoomCode">----</strong></span>
					<span id="lblRoomName" class="room-name-text"></span>
					<span id="lblRoundBadge" class="badge badge-subtle">Phòng chờ</span>
				</div>

				<div class="room-toolbar-buttons">
					<button id="btnCopyInvite" type="button" class="btn btn-gold btn-sm">
						📋 Copy Link Mời Bạn
					</button>
					<button id="btnNudgeRoom" type="button" class="btn btn-outline btn-sm" title="Phát âm thanh gõ bàn gọi đồng đội đang ẩn tab">
						🔔 Gõ bàn gọi bạn
					</button>
					<button id="btnLeaveRoom" type="button" class="btn btn-danger btn-sm">
						🚪 Rời bàn
					</button>
				</div>
			</div>

			<!-- BÀN BÀI 4 GHẾ -->
			<div class="poker-table">
				<!-- Ghế đối diện (Top) -->
				<div id="seatTop" class="seat-slot seat-top"></div>

				<!-- Hàng giữa: Ghế Trái - Tâm Bàn - Ghế Phải -->
				<div class="table-middle-row">
					<div id="seatLeft" class="seat-slot seat-left"></div>

					<!-- Khu vực Tâm Bàn Bài -->
					<div class="table-center">
						<!-- Bong bóng câu nói cà khịa nổ lớn giữa bàn ("Mày hả bưởi!", "Này thì!", "Chặt đẹp!") -->
						<div id="banterCalloutBox" class="banter-callout-box hidden" aria-live="polite"></div>

						<!-- Hộp điều khiển khi đang ở trạng thái WAITING / COUNTDOWN -->
						<div id="waitingCenterBox" class="waiting-center-box">
							<div id="countdownOverlay" class="countdown-overlay hidden">
								<div class="countdown-label">CHUẨN BỊ CHIA BÀI</div>
								<div id="countdownNumber" class="countdown-number">3</div>
							</div>

							<h3 id="waitingTitle" class="waiting-title">Đang tập hợp người chơi...</h3>
							<p id="waitingInstruction" class="waiting-instruction">
								Cần từ 2 đến 4 người chơi. Khi đủ 4 người vào phòng sẽ có chuông báo động tập hợp!
							</p>

							<!-- Bảng xếp hạng ván vừa kết thúc (nếu có) -->
							<div id="rankingsBox" class="rankings-box hidden">
								<h4 class="rankings-title">🏆 Kết quả ván vừa rồi</h4>
								<div id="rankingsList" class="rankings-list"></div>
							</div>

							<!-- Cụm nút Sẵn sàng & Chia bài (Cách 1) -->
							<div class="waiting-actions">
								<button id="btnReadyToggle" type="button" class="btn btn-ready-lg">
									✅ BẤM SẴN SÀNG
								</button>
								<button id="btnHostStart" type="button" class="btn btn-start-lg hidden" disabled>
									🃏 BẮT ĐẦU CHIA BÀI
								</button>
							</div>
						</div>

						<!-- Khu vực hiển thị bài đánh ra khi đang PLAYING -->
						<div id="playingCenterBox" class="playing-center-box hidden">
							<div id="turnBanner" class="turn-banner">Đang chờ lượt...</div>
							<div id="requiredCardHint" class="required-card-hint hidden"></div>

							<div id="trickZone" class="trick-zone">
								<div class="trick-empty">Bàn trống — Được quyền ra bài tự do</div>
							</div>
						</div>
					</div>

					<div id="seatRight" class="seat-slot seat-right"></div>
				</div>

				<!-- Khu vực Người chơi chính (Bottom Seat + Bài trên tay) -->
				<div class="my-player-area">
					<div id="seatBottom" class="my-seat-header"></div>

					<!-- Thanh điều khiển đánh bài (Chỉ hiện khi đang trong ván PLAYING) -->
					<div id="playControlsBar" class="play-controls-bar hidden">
						<div id="selectedComboHint" class="combo-hint">Chọn các lá bài bên dưới để đánh</div>
						<div class="play-action-buttons">
							<button id="btnClearSelection" type="button" class="btn btn-outline btn-sm">
								🧹 Bỏ chọn
							</button>
							<button id="btnPassTurn" type="button" class="btn btn-secondary">
								⏭️ Bỏ lượt
							</button>
							<button id="btnPlayCards" type="button" class="btn btn-primary btn-play-main">
								🔥 ĐÁNH BÀI
							</button>
						</div>
					</div>

					<!-- Quạt bài 13 lá trên tay -->
					<div id="myHandContainer" class="my-hand-container" role="region" aria-label="Bài trên tay của bạn"></div>
				</div>
			</div>

			<!-- Hàng dưới: Khung Chat Trực Tiếp & Nhật ký bàn chơi -->
			<div class="room-bottom-grid">
				<!-- Khung Chat + Icon khuôn mặt + Nút cà khịa có giọng nói -->
				<section class="room-chat-panel">
					<div class="log-header">
						<span>💬 Trò chuyện &amp; Cà khịa trong bàn</span>
						<span class="chat-hint-sub">Bấm câu cà khịa để phát tiếng nói!</span>
					</div>

					<div id="chatMessagesList" class="chat-messages-list" role="log" aria-live="polite">
						<div class="chat-empty-hint">Chưa có tin nhắn nào. Hãy chọn icon hoặc gõ lời chào anh em!</div>
					</div>

					<!-- Dãy nút Cà khịa nhanh (1-click gửi & phát giọng nói Miền Nam) -->
					<div id="quickVoiceBar" class="quick-voice-bar" aria-label="Câu nói cà khịa nhanh">
						<button type="button" class="btn-quick-voice" data-text="🍋 Mày hả bưởi! Đè lại liền nèèè!" data-voice="Mầy hả bưởi! Đè lại liền nè!" data-clip="counter_1.mp3">🍋 Mày hả bưởi!</button>
						<button type="button" class="btn-quick-voice" data-text="⚡ Này thì! Tới công chuyện luôn nè!" data-voice="Này thì! Cướp cái là tới công chuyện luôn nè!" data-clip="followup_1.mp3">⚡ Này thì!</button>
						<button type="button" class="btn-quick-voice" data-text="🐷 Đừng có giỡn mặt với tui nghen!" data-voice="Đừng có giỡn mặt với tui nghen!" data-clip="quick_warn.mp3">🐷 Đừng giỡn mặt!</button>
						<button type="button" class="btn-quick-voice" data-text="⏳ Đánh lẹ đi bồ ơi, ngủ gục tới nơi rồi nè!" data-voice="Đánh lẹ đi bồ ơi, ngủ gục tới nơi rồi nè!" data-clip="quick_hurry.mp3">⏳ Đánh lẹ bồ ơi!</button>
						<button type="button" class="btn-quick-voice" data-text="🤣 Xin nhẹ cái tuổi nghen bưởi!" data-voice="Xin nhẹ cái tuổi nghen bưởi!" data-clip="quick_age.mp3">🤣 Xin cái tuổi!</button>
						<button type="button" class="btn-quick-voice" data-text="🙏 Tha cho tui đi mà mấy đại ca!" data-voice="Tha cho tui đi mà mấy đại ca!" data-clip="quick_mercy.mp3">🙏 Tha cho tui!</button>
					</div>

					<!-- Dãy Icon Khuôn Mặt (Emoji) -->
					<div id="emojiPickerBar" class="emoji-picker-bar" aria-label="Icon khuôn mặt cảm xúc">
						<button type="button" class="btn-emoji" data-emoji="😂" title="Cười ra nước mắt">😂</button>
						<button type="button" class="btn-emoji" data-emoji="🤣" title="Cười lăn lộn">🤣</button>
						<button type="button" class="btn-emoji" data-emoji="😎" title="Ngầu">😎</button>
						<button type="button" class="btn-emoji" data-emoji="😏" title="Cười đểu">😏</button>
						<button type="button" class="btn-emoji" data-emoji="😱" title="Hoảng hốt">😱</button>
						<button type="button" class="btn-emoji" data-emoji="😡" title="Cay cú">😡</button>
						<button type="button" class="btn-emoji" data-emoji="😭" title="Khóc ròng">😭</button>
						<button type="button" class="btn-emoji" data-emoji="🥳" title="Ăn mừng">🥳</button>
						<button type="button" class="btn-emoji" data-emoji="🤡" title="Chú hề">🤡</button>
						<button type="button" class="btn-emoji" data-emoji="🐷" title="Con Heo">🐷</button>
						<button type="button" class="btn-emoji" data-emoji="🍋" title="Quả bưởi">🍋</button>
						<button type="button" class="btn-emoji" data-emoji="🔥" title="Cháy">🔥</button>
						<button type="button" class="btn-emoji" data-emoji="💥" title="Chặt nổ">💥</button>
						<button type="button" class="btn-emoji" data-emoji="👏" title="Vỗ tay">👏</button>
					</div>

					<!-- Ô nhập chat -->
					<div class="chat-input-row">
						<input
							id="inputChatMessage"
							type="text"
							maxlength="120"
							placeholder="Nhập tin nhắn hoặc chọn icon mặt cười..."
							autocomplete="off"
						/>
						<button id="btnSendChat" type="button" class="btn btn-gold btn-sm">
							💬 Gửi
						</button>
					</div>
				</section>

				<!-- Khung Nhật ký bàn chơi & Danh sách khán giả -->
				<section class="room-footer-log">
					<div class="log-header">
						<span>📜 Nhật ký bàn chơi</span>
						<span id="spectatorBadge" class="spectator-badge hidden">👀 Khán giả: 0</span>
					</div>
					<div id="roomLogList" class="room-log-list"></div>
				</section>
			</div>
		</main>
	</div>
</div>
