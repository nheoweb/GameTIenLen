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
$tlmn_game_enabled  = class_exists( 'TLMN_Plugin' ) ? TLMN_Plugin::is_game_enabled() : true;

if ( ! $tlmn_game_enabled ) :
	?>
	<div id="tlmnAppRoot" class="<?php echo esc_attr( $tlmn_root_class ); ?>">
		<div class="app-shell">
			<section class="panel-card tlmn-disabled-panel" role="status">
				<div class="tlmn-disabled-icon" aria-hidden="true">🔒</div>
				<h1 class="tlmn-disabled-title">Sảnh Giải Trí Nội Bộ Đang Tạm Đóng</h1>
				<p class="tlmn-disabled-desc">
					Giao diện trò chơi hiện đang được Quản trị viên tạm khóa ngoài giờ giải lao nội bộ.
				</p>
				<?php if ( function_exists( 'current_user_can' ) && current_user_can( 'manage_options' ) ) : ?>
					<div style="margin-top: 1.25rem;">
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=tien-len-mien-nam' ) ); ?>" class="btn btn-gold btn-sm">
							⚙️ Vào trang Quản trị để Bật lại Sảnh Game
						</a>
					</div>
				<?php endif; ?>
			</section>
		</div>
	</div>
	<?php
	return;
endif;
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
					🔔 Nghe thử chuông
				</button>
				<button id="btnToggleSound" type="button" class="btn btn-outline btn-sm" aria-pressed="false">
					🔊 Âm thanh: BẬT
				</button>
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

				<!-- 2 Tab Horizontal: Tham gia bàn | Tạo bàn mới -->
				<div class="lobby-action-tabs" role="tablist" aria-label="Chọn Tham gia hoặc Tạo bàn mới">
					<button
						id="tabJoinRoom"
						type="button"
						role="tab"
						aria-selected="true"
						aria-controls="panelJoinRoom"
						class="lobby-tab-btn active"
						data-tab="join"
					>
						🔑 Tham gia
					</button>
					<button
						id="tabCreateRoom"
						type="button"
						role="tab"
						aria-selected="false"
						aria-controls="panelCreateRoom"
						class="lobby-tab-btn"
						data-tab="create"
					>
						➕ Tạo bàn mới
					</button>
				</div>

				<!-- Nội dung Tab 1: Tham gia bằng mã phòng 4 số -->
				<div id="panelJoinRoom" role="tabpanel" aria-labelledby="tabJoinRoom" class="lobby-tab-panel">
					<div class="form-group">
						<label for="inputRoomCode">Nhập Mã phòng 4 số</label>
						<div class="input-row">
							<input
								id="inputRoomCode"
								type="text"
								maxlength="4"
								inputmode="numeric"
								pattern="[0-9]*"
								placeholder="VD: 4821"
							/>
							<button id="btnJoinByCode" type="button" class="btn btn-primary">
								🔑 Vào Bàn
							</button>
						</div>
					</div>
				</div>

				<!-- Nội dung Tab 2: Tạo bàn mới -->
				<div id="panelCreateRoom" role="tabpanel" aria-labelledby="tabCreateRoom" class="lobby-tab-panel hidden">
					<div class="form-group">
						<label for="inputRoomName">Tên bàn</label>
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

			<!-- Dưới cùng: Link sảnh chơi gửi cho nhóm bạn -->
			<section class="panel-card lobby-share-panel">
				<div class="share-info-box">
					<div class="share-info-title">🔗 Link sảnh chơi gửi cho nhóm bạn:</div>
					<div class="share-url-row">
						<span id="shareLobbyUrlText" class="share-url-text"></span>
						<button id="btnCopyLobbyUrl" type="button" class="btn btn-outline btn-sm">📋 Copy</button>
					</div>
				</div>
			</section>
		</main>

		<!-- MÀN HÌNH 2: PHÒNG CHỜ & BÀN CHƠI TIẾN LÊN -->
		<main id="roomView" class="room-container hidden">
			<!-- Thanh nhắc chuyển sang nằm ngang khi đang cầm dọc trên điện thoại -->
			<div id="portraitRotatePrompt" class="portrait-rotate-prompt hidden" role="region" aria-label="Gợi ý xoay ngang màn hình">
				<span class="rotate-prompt-text">📱 Chuyển sang màn hình ngang để xem rộng đủ 4 người &amp; tay bài</span>
				<div class="rotate-prompt-actions">
					<button id="btnEnterLandscape" type="button" class="btn btn-gold btn-xs">
						🔄 Xoay ngang
					</button>
					<button id="btnDismissRotatePrompt" type="button" class="btn btn-outline btn-xs" aria-label="Đóng thanh nhắc">
						✕
					</button>
				</div>
			</div>

			<!-- Thanh công cụ gọn nhẹ của Phòng -->
			<div class="room-toolbar">
				<div class="room-meta">
					<span class="room-code-badge">#<strong id="lblRoomCode">----</strong></span>
					<span id="lblRoomName" class="room-name-text"></span>
					<span id="lblRoundBadge" class="badge badge-subtle">Phòng chờ</span>
				</div>

				<div class="room-toolbar-buttons">
					<button id="btnToggleMic" type="button" class="btn btn-voice btn-sm" aria-pressed="false" title="Bật/Tắt Micro nói chuyện trực tiếp trong bàn">
						🎤 Mic: TẮT
					</button>
					<button id="btnRoomToggleSound" type="button" class="btn btn-outline btn-sm" aria-pressed="false" title="Bật/Tắt toàn bộ âm thanh game và tiếng nói">
						🔊 Âm thanh
					</button>
					<button id="btnToggleChatDrawer" type="button" class="btn btn-outline btn-sm btn-chat-toggle" aria-expanded="false" title="Mở khung trò chuyện &amp; cà khịa">
						💬 Chat <span id="chatUnreadBadge" class="chat-unread-badge hidden">0</span>
					</button>
					
					<button id="btnCopyInvite" type="button" class="btn btn-gold btn-sm" title="Copy đường link mời bạn bè vào bàn">
						📋 Mời
					</button>
					<button id="btnNudgeRoom" type="button" class="btn btn-outline btn-sm" title="Phát âm thanh gõ bàn gọi đồng đội đang ẩn tab">
						🔔
					</button>
					<button id="btnToggleLandscape" type="button" class="btn btn-outline btn-sm btn-landscape-toggle" title="Chuyển chế độ nằm ngang / toàn màn hình">
						📱 Ngang
					</button>
					<button id="btnLeaveRoom" type="button" class="btn btn-danger btn-sm" title="Rời khỏi bàn về sảnh">
						🚪 Rời
					</button>
				</div>
			</div>

			<!-- BÀN BÀI 4 GHẾ Ở 4 CẠNH MÀN HÌNH -->
			<div class="poker-table">
				<!-- Ghế đối diện (Cạnh trên) -->
				<div id="seatTop" class="seat-slot seat-top"></div>

				<!-- Hàng giữa: Ghế Trái - Tâm Bàn (Bài đã đánh) - Ghế Phải -->
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

						<!-- Khu vực hiển thị các quân bài đã đánh ra khi đang PLAYING -->
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

				<!-- Khu vực Người chơi chính (Cạnh dài bên dưới: Thông tin trái | Quạt bài giữa | Nút đánh bên phải trên mobile ngang) -->
				<div class="my-player-area">
					<div id="seatBottom" class="my-seat-header"></div>

					<!-- Quạt bài 13 lá trên tay (1 hàng ngang gọn gàng) -->
					<div id="myHandContainer" class="my-hand-container" role="region" aria-label="Bài trên tay của bạn"></div>

					<!-- Thanh điều khiển đánh bài (Chỉ hiện khi đang trong ván PLAYING) -->
					<div id="playControlsBar" class="play-controls-bar hidden">
						<div id="selectedComboHint" class="combo-hint">Chọn bài để đánh</div>
						<div class="play-action-buttons">
							<button id="btnPassTurn" type="button" class="btn btn-secondary btn-sm">
								⏭️ Bỏ lượt
							</button>
							<button id="btnPlayCards" type="button" class="btn btn-primary btn-play-main btn-sm">
								🔥 ĐÁNH BÀI
							</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Nền mờ & Ngăn kéo Chat trên màn hình ngang/di động -->
			<div id="chatDrawerBackdrop" class="chat-drawer-backdrop hidden" aria-hidden="true"></div>

			<!-- Hàng dưới (PC) / Ngăn kéo trượt bên phải (Mobile & Landscape): Khung Chat -->
			<div id="roomBottomDrawer" class="room-bottom-grid">
				<div class="chat-drawer-header">
					<span>💬 Trò chuyện trong bàn</span>
					<button id="btnCloseChatDrawer" type="button" class="btn btn-outline btn-xs" aria-label="Đóng khung chat">
						✕ Đóng
					</button>
				</div>
				<!-- Khung Chat + Icon khuôn mặt + Nút cà khịa có giọng nói -->
				<section class="room-chat-panel">
					<div class="log-header">
						<span>💬 Trò chuyện &amp; Cà khịa trong bàn</span>
						<span id="spectatorBadge" class="spectator-badge hidden">👀 Khán giả: 0</span>
						
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
			</div>
		</main>
	</div>
</div>
