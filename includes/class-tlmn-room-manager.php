<?php
/**
 * Quản lý trạng thái phòng chơi, cơ chế Sẵn sàng (Cách 1), lượt đánh & tính điểm.
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TLMN_Room_Manager {

	/** Số giây không có nhịp tim (heartbeat) thì xem như tạm mất kết nối (giữ ghế chờ F5). */
	const ONLINE_TIMEOUT_SECONDS = 20;

	/** Thời gian đếm ngược trước khi chia bài (giây). */
	const COUNTDOWN_SECONDS = 3;

	/**
	 * Cắt chuỗi UTF-8 an toàn (hoạt động kể cả khi host không bật mbstring).
	 *
	 * @param string $str     Chuỗi đầu vào.
	 * @param int    $max_len Độ dài tối đa.
	 * @return string
	 */
	public static function safe_substr( $str, $max_len ) {
		if ( function_exists( 'mb_substr' ) ) {
			return mb_substr( $str, 0, $max_len, 'UTF-8' );
		}
		return substr( $str, 0, $max_len );
	}

	/**
	 * Chuẩn hóa token người chơi.
	 *
	 * @param mixed $token Token gửi lên từ client.
	 * @return string
	 */
	public static function sanitize_token( $token ) {
		$clean = preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $token );
		return substr( $clean, 0, 64 );
	}

	/**
	 * Chuẩn hóa tên hiển thị / tên phòng.
	 *
	 * @param mixed  $text     Chuỗi đầu vào.
	 * @param int    $max_len  Độ dài tối đa.
	 * @param string $fallback Giá trị dự phòng nếu rỗng.
	 * @return string
	 */
	public static function sanitize_label( $text, $max_len, $fallback ) {
		$stripped = wp_strip_all_tags( (string) $text );
		$clean    = trim( preg_replace( '/\s+/', ' ', $stripped ) );
		$clean    = self::safe_substr( $clean, $max_len );
		return '' !== $clean ? $clean : $fallback;
	}

	/**
	 * Tạo mảng state ban đầu cho phòng mới.
	 *
	 * @param string $room_id      Mã phòng 4 chữ số.
	 * @param string $player_token Token chủ phòng.
	 * @param string $nickname     Tên chủ phòng.
	 * @param string $room_name    Tên phòng.
	 * @return array<string, mixed>
	 */
	public static function create_room_state( $room_id, $player_token, $nickname, $room_name = '' ) {
		$now             = time();
		$clean_name      = self::sanitize_label( $nickname, 20, 'Người chơi' );
		$clean_room_name = self::sanitize_label( $room_name, 30, 'Bàn của ' . $clean_name );

		$host_player = array(
			'playerToken'   => $player_token,
			'nickname'      => $clean_name,
			'seatIndex'     => 0,
			'ready'         => false,
			'lastSeenAt'    => $now,
			'hand'          => array(),
			'passedInRound' => false,
			'finishOrder'   => null,
			'score'         => 0,
		);

		return array(
			'roomId'                 => (string) $room_id,
			'roomName'               => $clean_room_name,
			'hostToken'              => $player_token,
			'status'                 => 'WAITING',
			'countdownEndAt'         => null,
			'players'                => array( $host_player ),
			'spectators'             => array(),
			'roundNumber'            => 0,
			'lastWinnerToken'        => null,
			'requiredFirstCardId'    => null,
			'requiredFirstCardLabel' => null,
			'currentTurnToken'       => null,
			'currentTrick'           => null,
			'tableHistory'           => array(),
			'rankings'               => array(),
			'finishCounter'          => 0,
			'logs'                   => array( '🎉 ' . $clean_name . ' đã tạo phòng #' . $room_id ),
			'chats'                  => array(),
			'trickPlayers'           => array(),
			'pendingFollowUpToken'   => null,
			'events'                 => array(),
			'nextEventId'            => 1,
			'lastNudgeAt'            => 0,
			'version'                => 1,
			'createdAt'              => $now,
		);
	}

	/**
	 * Thêm dòng nhật ký bàn chơi (giữ tối đa 40 dòng).
	 *
	 * @param array<string, mixed> $room    Trạng thái phòng.
	 * @param string               $message Nội dung log.
	 * @return void
	 */
	public static function add_log( array &$room, $message ) {
		$room['logs'][] = (string) $message;
		if ( count( $room['logs'] ) > 40 ) {
			$room['logs'] = array_values( array_slice( $room['logs'], -40 ) );
		}
	}

	/**
	 * Đẩy 1 sự kiện âm thanh/thông báo vào phòng (giữ tối đa 25 sự kiện).
	 *
	 * @param array<string, mixed> $room    Trạng thái phòng.
	 * @param array<string, mixed> $payload Dữ liệu sự kiện.
	 * @return array<string, mixed> Sự kiện vừa tạo.
	 */
	public static function push_event( array &$room, array $payload ) {
		$event_id            = isset( $room['nextEventId'] ) ? (int) $room['nextEventId'] : 1;
		$room['nextEventId'] = $event_id + 1;

		$event = array_merge(
			array(
				'id'        => $event_id,
				'timestamp' => (int) round( microtime( true ) * 1000 ),
			),
			$payload
		);

		$room['events'][] = $event;
		if ( count( $room['events'] ) > 25 ) {
			$room['events'] = array_values( array_slice( $room['events'], -25 ) );
		}

		return $event;
	}

	/**
	 * Tăng version mỗi khi trạng thái bàn thay đổi.
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return void
	 */
	public static function bump_version( array &$room ) {
		$room['version'] = ( isset( $room['version'] ) ? (int) $room['version'] : 0 ) + 1;
	}

	/**
	 * Đánh giá trạng thái Sẵn sàng (Cách 1).
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return array<string, mixed>
	 */
	public static function evaluate_readiness( array $room ) {
		$total_players = count( $room['players'] );
		$ready_count   = 0;
		foreach ( $room['players'] as $p ) {
			if ( ! empty( $p['ready'] ) ) {
				$ready_count++;
			}
		}

		$all_seated_ready     = ( $total_players >= 2 && $ready_count === $total_players );
		$can_host_start       = $all_seated_ready;
		$auto_start_countdown = ( 4 === $total_players && 4 === $ready_count );

		return array(
			'totalPlayers'       => $total_players,
			'readyCount'         => $ready_count,
			'allSeatedReady'     => $all_seated_ready,
			'canHostStart'       => $can_host_start,
			'autoStartCountdown' => $auto_start_countdown,
		);
	}

	/**
	 * Cho người chơi vào phòng hoặc kết nối lại (F5).
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người chơi.
	 * @param string               $nickname     Tên hiển thị.
	 * @return array<string, mixed>
	 */
	public static function join_room( array &$room, $player_token, $nickname ) {
		$now        = time();
		$clean_name = self::sanitize_label( $nickname, 20, 'Người chơi' );

		// 1. Reconnect nếu đã có ghế trong bàn.
		foreach ( $room['players'] as &$p ) {
			if ( $p['playerToken'] === $player_token ) {
				$was_offline     = ( $now - (int) $p['lastSeenAt'] ) > self::ONLINE_TIMEOUT_SECONDS;
				$p['lastSeenAt'] = $now;
				$p['nickname']   = $clean_name;
				if ( $was_offline ) {
					self::add_log( $room, '🔄 ' . $clean_name . ' đã kết nối lại bàn.' );
				}
				self::bump_version( $room );
				return array(
					'ok'            => true,
					'roomId'        => $room['roomId'],
					'reconnected'   => true,
					'role'          => 'PLAYER',
					'joinAlertType' => 'RECONNECTED',
				);
			}
		}
		unset( $p );

		// 2. Reconnect nếu đang là Khán giả.
		foreach ( $room['spectators'] as &$s ) {
			if ( $s['playerToken'] === $player_token ) {
				$s['lastSeenAt'] = $now;
				$s['nickname']   = $clean_name;
				self::bump_version( $room );
				return array(
					'ok'            => true,
					'roomId'        => $room['roomId'],
					'reconnected'   => true,
					'role'          => 'SPECTATOR',
					'joinAlertType' => 'RECONNECTED',
				);
			}
		}
		unset( $s );

		// 3. Nếu đang WAITING / COUNTDOWN và còn ghế trống (< 4).
		if ( 'PLAYING' !== $room['status'] && count( $room['players'] ) < 4 ) {
			$was_countdown = ( 'COUNTDOWN' === $room['status'] );
			if ( $was_countdown ) {
				$room['status']         = 'WAITING';
				$room['countdownEndAt'] = null;
				self::push_event(
					$room,
					array(
						'type'    => 'COUNTDOWN_CANCELLED',
						'message' => '⏸️ Tạm dừng đếm ngược vì ' . $clean_name . ' vừa vào bàn!',
					)
				);
			}

			$taken_seats = array();
			foreach ( $room['players'] as $p ) {
				$taken_seats[ (int) $p['seatIndex'] ] = true;
			}
			$seat_index = 0;
			while ( isset( $taken_seats[ $seat_index ] ) ) {
				$seat_index++;
			}

			$room['players'][] = array(
				'playerToken'   => $player_token,
				'nickname'      => $clean_name,
				'seatIndex'     => $seat_index,
				'ready'         => false,
				'lastSeenAt'    => $now,
				'hand'          => array(),
				'passedInRound' => false,
				'finishOrder'   => null,
				'score'         => 0,
			);

			usort(
				$room['players'],
				function ( $a, $b ) {
					return (int) $a['seatIndex'] - (int) $b['seatIndex'];
				}
			);
			$room['players'] = array_values( $room['players'] );

			$is_full_4       = ( 4 === count( $room['players'] ) );
			$join_alert_type = $is_full_4 ? 'ROOM_FULL_4' : 'PLAYER_JOINED';
			$alert_event     = null;

			if ( $is_full_4 ) {
				self::add_log( $room, '🔔 ' . $clean_name . ' đã vào bàn (ĐỦ 4/4 CHÂN!). Hãy bấm Sẵn sàng để chia bài!' );
				$alert_event = self::push_event(
					$room,
					array(
						'type'        => 'ROOM_FULL_4',
						'playerToken' => $player_token,
						'nickname'    => $clean_name,
						'playerCount' => count( $room['players'] ),
						'message'     => '🔔 ĐỦ 4/4 CHÂN RỒI! (' . $clean_name . ' vừa vào). Tất cả bấm Sẵn sàng để tự động chia bài!',
					)
				);
			} else {
				self::add_log( $room, '👋 ' . $clean_name . ' đã vào bàn (' . count( $room['players'] ) . '/4 người).' );
				$alert_event = self::push_event(
					$room,
					array(
						'type'        => 'PLAYER_JOINED',
						'playerToken' => $player_token,
						'nickname'    => $clean_name,
						'playerCount' => count( $room['players'] ),
						'message'     => '👋 ' . $clean_name . ' vừa vào bàn (' . count( $room['players'] ) . '/4 người)!',
					)
				);
			}

			self::bump_version( $room );

			return array(
				'ok'                  => true,
				'roomId'              => $room['roomId'],
				'reconnected'         => false,
				'role'                => 'PLAYER',
				'joinAlertType'       => $join_alert_type,
				'wasCountdownCancelled' => $was_countdown,
				'immediateAlert'      => $alert_event,
			);
		}

		// 4. Phòng đang đánh hoặc đã đủ 4 ghế -> Vào làm Khán giả.
		$room['spectators'][] = array(
			'playerToken' => $player_token,
			'nickname'    => $clean_name,
			'lastSeenAt'  => $now,
		);
		$room['spectators'] = array_values( $room['spectators'] );

		self::add_log( $room, '👀 ' . $clean_name . ' đang đứng xem bàn (sẽ vào ghế ở ván sau nếu còn chỗ).' );
		$alert_event = self::push_event(
			$room,
			array(
				'type'     => 'SPECTATOR_JOINED',
				'nickname' => $clean_name,
				'message'  => '👀 ' . $clean_name . ' vào xem bàn.',
			)
		);
		self::bump_version( $room );

		return array(
			'ok'             => true,
			'roomId'         => $room['roomId'],
			'reconnected'    => false,
			'role'           => 'SPECTATOR',
			'joinAlertType'  => 'SPECTATOR_JOINED',
			'immediateAlert' => $alert_event,
		);
	}

	/**
	 * Bật / Tắt Sẵn sàng của người chơi (Cách 1).
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người chơi.
	 * @param bool                 $ready        Trạng thái sẵn sàng.
	 * @return array<string, mixed>
	 */
	public static function set_player_ready( array &$room, $player_token, $ready ) {
		if ( 'PLAYING' === $room['status'] ) {
			return array(
				'ok'    => false,
				'error' => 'Bàn đang trong ván đấu',
			);
		}

		$found_idx = -1;
		foreach ( $room['players'] as $idx => $p ) {
			if ( $p['playerToken'] === $player_token ) {
				$found_idx = $idx;
				break;
			}
		}

		if ( -1 === $found_idx ) {
			return array(
				'ok'    => false,
				'error' => 'Bạn đang là khán giả, vui lòng đợi hết ván hiện tại',
			);
		}

		$ready_bool                             = (bool) $ready;
		$room['players'][ $found_idx ]['ready'] = $ready_bool;
		$room['players'][ $found_idx ]['lastSeenAt'] = time();
		$nickname                               = $room['players'][ $found_idx ]['nickname'];

		$was_countdown = ( 'COUNTDOWN' === $room['status'] );
		if ( ! $ready_bool && $was_countdown ) {
			$room['status']         = 'WAITING';
			$room['countdownEndAt'] = null;
			self::add_log( $room, '⏸️ ' . $nickname . ' đã hủy Sẵn sàng — Tạm dừng đếm ngược.' );
			self::push_event(
				$room,
				array(
					'type'    => 'COUNTDOWN_CANCELLED',
					'message' => '⏸️ Đã dừng đếm ngược do có người hủy Sẵn sàng.',
				)
			);
		} elseif ( $ready_bool ) {
			self::add_log( $room, '✅ ' . $nickname . ' đã Sẵn sàng!' );
		}

		$readiness = self::evaluate_readiness( $room );

		// Đủ 4/4 người và cả 4 đều Sẵn sàng -> Tự động kích hoạt đếm ngược chia bài!
		if ( $readiness['autoStartCountdown'] && 'WAITING' === $room['status'] ) {
			self::start_countdown( $room, self::COUNTDOWN_SECONDS );
		}

		self::bump_version( $room );

		return array_merge(
			array(
				'ok'                    => true,
				'ready'                 => $ready_bool,
				'wasCountdownCancelled' => ( ! $ready_bool && $was_countdown ),
			),
			$readiness
		);
	}

	/**
	 * Kiểm tra quyền Chủ phòng bấm Bắt đầu chia bài (Cách 1).
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người gửi.
	 * @return array<string, mixed>
	 */
	public static function can_host_start_game( array $room, $player_token ) {
		if ( 'PLAYING' === $room['status'] ) {
			return array(
				'allowed' => false,
				'reason'  => 'Ván bài đang diễn ra',
			);
		}
		if ( 'COUNTDOWN' === $room['status'] ) {
			return array(
				'allowed' => false,
				'reason'  => 'Bàn đang đếm ngược chia bài',
			);
		}
		if ( $room['hostToken'] !== $player_token ) {
			return array(
				'allowed' => false,
				'reason'  => 'Chỉ Chủ phòng mới có quyền bấm Bắt đầu chia bài',
			);
		}

		$readiness = self::evaluate_readiness( $room );
		if ( $readiness['totalPlayers'] < 2 ) {
			return array(
				'allowed' => false,
				'reason'  => 'Cần tối thiểu 2 người chơi để chia bài',
			);
		}
		if ( ! $readiness['allSeatedReady'] ) {
			return array(
				'allowed' => false,
				'reason'  => 'Tất cả người chơi trong bàn phải bấm Sẵn sàng trước khi chia bài',
			);
		}

		return array( 'allowed' => true );
	}

	/**
	 * Bắt đầu đếm ngược chia bài (stateless timestamp).
	 *
	 * @param array<string, mixed> $room    Trạng thái phòng.
	 * @param int                  $seconds Số giây đếm ngược.
	 * @return void
	 */
	public static function start_countdown( array &$room, $seconds = 3 ) {
		if ( 'PLAYING' === $room['status'] ) {
			return;
		}
		$seconds                = max( 1, (int) $seconds );
		$room['status']         = 'COUNTDOWN';
		$room['countdownEndAt'] = microtime( true ) + $seconds;
		self::add_log( $room, '⏳ Chuẩn bị chia bài sau ' . $seconds . ' giây...' );
		self::bump_version( $room );
	}

	/**
	 * Kiểm tra nếu đồng hồ đếm ngược đã về 0 thì tự động chia bài.
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return bool True nếu vừa chuyển từ COUNTDOWN sang PLAYING.
	 */
	public static function check_countdown_completion( array &$room ) {
		if ( 'COUNTDOWN' !== $room['status'] || empty( $room['countdownEndAt'] ) ) {
			return false;
		}

		if ( microtime( true ) < (float) $room['countdownEndAt'] ) {
			return false;
		}

		$res = self::start_game( $room );
		return ! empty( $res['ok'] );
	}

	/**
	 * Chia bài và bắt đầu ván mới.
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return array<string, mixed>
	 */
	public static function start_game( array &$room ) {
		$player_count = count( $room['players'] );
		if ( $player_count < 2 ) {
			$room['status']         = 'WAITING';
			$room['countdownEndAt'] = null;
			self::bump_version( $room );
			return array(
				'ok'    => false,
				'error' => 'Cần ít nhất 2 người chơi để bắt đầu',
			);
		}

		$dealt = TLMN_Deck::deal_hands( $player_count );
		if ( empty( $dealt['ok'] ) ) {
			return $dealt;
		}

		$room['status']                 = 'PLAYING';
		$room['countdownEndAt']         = null;
		$room['roundNumber']            = (int) $room['roundNumber'] + 1;
		$room['currentTrick']           = null;
		$room['tableHistory']           = array();
		$room['trickPlayers']           = array();
		$room['pendingFollowUpToken']   = null;
		$room['rankings']               = array();
		$room['finishCounter']          = 0;

		foreach ( $room['players'] as $idx => &$p ) {
			$p['hand']          = $dealt['hands'][ $idx ];
			$p['passedInRound'] = false;
			$p['finishOrder']   = null;
		}
		unset( $p );

		// Xác định người đánh trước: Nhất ván trước (nếu còn ngồi) hoặc người giữ lá nhỏ nhất ván đầu.
		$prev_winner = null;
		if ( ! empty( $room['lastWinnerToken'] ) ) {
			foreach ( $room['players'] as $p ) {
				if ( $p['playerToken'] === $room['lastWinnerToken'] ) {
					$prev_winner = $p;
					break;
				}
			}
		}

		if ( null !== $prev_winner ) {
			$room['currentTurnToken']       = $prev_winner['playerToken'];
			$room['requiredFirstCardId']    = null;
			$room['requiredFirstCardLabel'] = null;
			self::add_log(
				$room,
				'🃏 Ván #' . $room['roundNumber'] . ' bắt đầu! ' . $prev_winner['nickname'] . ' (Nhất ván trước) được đánh trước.'
			);
		} else {
			$lowest_idx                     = (int) $dealt['lowestHolderIndex'];
			$starter                        = isset( $room['players'][ $lowest_idx ] ) ? $room['players'][ $lowest_idx ] : $room['players'][0];
			$lowest_card                    = $dealt['lowestCard'];
			$room['currentTurnToken']       = $starter['playerToken'];
			$room['requiredFirstCardId']    = $lowest_card['id'];
			$room['requiredFirstCardLabel'] = $lowest_card['label'];
			self::add_log(
				$room,
				'🃏 Ván #' . $room['roundNumber'] . ' bắt đầu! ' . $starter['nickname'] . ' giữ lá nhỏ nhất (' . $lowest_card['label'] . ') đi trước.'
			);
		}

		self::push_event(
			$room,
			array(
				'type'        => 'GAME_STARTED',
				'roundNumber' => $room['roundNumber'],
				'message'     => '🃏 Ván #' . $room['roundNumber'] . ' bắt đầu!',
			)
		);
		self::bump_version( $room );

		return array( 'ok' => true );
	}

	/**
	 * Xử lý hành động đánh bài.
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người chơi.
	 * @param array<int, string>   $card_ids     Mảng mã lá bài định đánh.
	 * @return array<string, mixed>
	 */
	public static function play_cards( array &$room, $player_token, $card_ids ) {
		if ( 'PLAYING' !== $room['status'] ) {
			return array(
				'ok'    => false,
				'error' => 'Bàn chưa bắt đầu ván đấu',
			);
		}
		if ( $room['currentTurnToken'] !== $player_token ) {
			return array(
				'ok'    => false,
				'error' => 'Chưa tới lượt của bạn',
			);
		}
		if ( ! is_array( $card_ids ) || empty( $card_ids ) ) {
			return array(
				'ok'    => false,
				'error' => 'Bạn chưa chọn lá bài nào',
			);
		}

		$clean_ids = array();
		foreach ( $card_ids as $cid ) {
			$clean_ids[] = strtoupper( trim( (string) $cid ) );
		}

		$player_idx = -1;
		foreach ( $room['players'] as $idx => $p ) {
			if ( $p['playerToken'] === $player_token ) {
				$player_idx = $idx;
				break;
			}
		}
		if ( -1 === $player_idx ) {
			return array(
				'ok'    => false,
				'error' => 'Không tìm thấy người chơi trong bàn',
			);
		}

		$room['players'][ $player_idx ]['lastSeenAt'] = time();
		$hand_by_id = array();
		foreach ( $room['players'][ $player_idx ]['hand'] as $card ) {
			$hand_by_id[ $card['id'] ] = $card;
		}

		$selected_cards = array();
		foreach ( $clean_ids as $id ) {
			if ( ! isset( $hand_by_id[ $id ] ) ) {
				return array(
					'ok'    => false,
					'error' => 'Lá bài ' . $id . ' không có trên tay bạn',
				);
			}
			$selected_cards[] = $hand_by_id[ $id ];
		}

		// Kiểm tra bắt buộc chứa lá nhỏ nhất ở lượt đầu tiên của ván đầu.
		if ( ! empty( $room['requiredFirstCardId'] ) ) {
			if ( ! in_array( $room['requiredFirstCardId'], $clean_ids, true ) ) {
				return array(
					'ok'    => false,
					'error' => 'Lượt đầu tiên bắt buộc phải đánh bộ bài có chứa lá ' . $room['requiredFirstCardLabel'],
				);
			}
		}

		$classified = TLMN_Rules::classify_hand( $selected_cards );
		if ( empty( $classified['valid'] ) ) {
			return array(
				'ok'    => false,
				'error' => isset( $classified['reason'] ) ? $classified['reason'] : 'Bộ bài không hợp lệ',
			);
		}

		$prev_hand  = ! empty( $room['currentTrick']['classifiedHand'] ) ? $room['currentTrick']['classifiedHand'] : null;
		$beat_check = TLMN_Rules::can_beat( $prev_hand, $classified );
		if ( empty( $beat_check['allowed'] ) ) {
			return array(
				'ok'    => false,
				'error' => isset( $beat_check['reason'] ) ? $beat_check['reason'] : 'Không thể đè bài trên bàn',
			);
		}

		// Trừ bài trên tay người chơi (giữ mảng tuần tự bằng array_values).
		$played_lookup = array_flip( $clean_ids );
		$remaining     = array();
		foreach ( $room['players'][ $player_idx ]['hand'] as $c ) {
			if ( ! isset( $played_lookup[ $c['id'] ] ) ) {
				$remaining[] = $c;
			}
		}
		$room['players'][ $player_idx ]['hand'] = array_values( $remaining );

		$room['requiredFirstCardId']    = null;
		$room['requiredFirstCardLabel'] = null;

		$nickname  = $room['players'][ $player_idx ]['nickname'];
		$is_chop   = ! empty( $beat_check['isChop'] );
		$chop_note = isset( $beat_check['chopNote'] ) ? $beat_check['chopNote'] : null;

		// Theo dõi chuỗi đánh bài để kích hoạt câu nói cà khịa (Voice Banter):
		// 1) A đánh -> B đè -> A bỏ qua -> B đánh tiếp ("Này thì!")
		$is_follow_up_strike = (
			empty( $prev_hand ) &&
			! empty( $room['pendingFollowUpToken'] ) &&
			$room['pendingFollowUpToken'] === $player_token
		);
		$room['pendingFollowUpToken'] = null;

		// 2) A đánh 1 lần -> B đánh đè 1 lần -> A đáp trả đè lại B ("Mày hả bưởi!")
		if ( ! isset( $room['trickPlayers'] ) || ! is_array( $room['trickPlayers'] ) ) {
			$room['trickPlayers'] = array();
		}
		$room['trickPlayers'][] = $player_token;
		$tp_count               = count( $room['trickPlayers'] );
		$is_counter_3x          = (
			$tp_count >= 3 &&
			$room['trickPlayers'][ $tp_count - 3 ] === $player_token &&
			$room['trickPlayers'][ $tp_count - 2 ] !== $player_token
		);

		$player_finished = false;
		if ( empty( $room['players'][ $player_idx ]['hand'] ) && null === $room['players'][ $player_idx ]['finishOrder'] ) {
			$room['finishCounter']                         = (int) $room['finishCounter'] + 1;
			$room['players'][ $player_idx ]['finishOrder'] = $room['finishCounter'];
			$player_finished                               = true;
		}

		$remaining_count = count( $room['players'][ $player_idx ]['hand'] );
		$finish_order    = $room['players'][ $player_idx ]['finishOrder'];
		$banter          = self::pick_play_banter(
			$is_chop,
			$is_counter_3x,
			$is_follow_up_strike,
			$player_finished,
			$finish_order,
			$remaining_count,
			$classified
		);

		$trick_entry = array(
			'playerToken'    => $player_token,
			'nickname'       => $nickname,
			'classifiedHand' => $classified,
			'cards'          => $classified['cards'],
			'label'          => $classified['label'],
			'isChop'         => $is_chop,
			'chopNote'       => $chop_note,
			'banter'         => $banter,
		);

		$room['currentTrick']   = $trick_entry;
		$room['tableHistory'][] = $trick_entry;
		if ( count( $room['tableHistory'] ) > 3 ) {
			$room['tableHistory'] = array_values( array_slice( $room['tableHistory'], -3 ) );
		}

		if ( $is_chop && ! empty( $chop_note ) ) {
			self::add_log( $room, $chop_note . ' (' . $nickname . ' đánh ' . $classified['label'] . ')' );
			self::push_event(
				$room,
				array(
					'type'        => 'CHOP',
					'playerToken' => $player_token,
					'nickname'    => $nickname,
					'cardCount'   => count( $classified['cards'] ),
					'message'     => $chop_note,
					'banter'      => $banter,
				)
			);
		} else {
			self::add_log( $room, '🎴 ' . $nickname . ' đánh ' . $classified['label'] );
			self::push_event(
				$room,
				array(
					'type'        => 'CARD_PLAYED',
					'playerToken' => $player_token,
					'nickname'    => $nickname,
					'cardCount'   => count( $classified['cards'] ),
					'banter'      => $banter,
				)
			);
		}

		if ( null !== $banter ) {
			self::add_log( $room, '🗣️ ' . $nickname . ': "' . $banter['displayText'] . '"' );
		}

		if ( $player_finished ) {
			self::add_log( $room, '🏆 ' . $nickname . ' đã hết bài (Về thứ ' . $room['finishCounter'] . ')!' );
		}

		// Kiểm tra kết thúc ván (còn <= 1 người còn bài).
		$active_indices = array();
		foreach ( $room['players'] as $idx => $p ) {
			if ( ! empty( $p['hand'] ) ) {
				$active_indices[] = $idx;
			}
		}

		if ( count( $active_indices ) <= 1 ) {
			$last_idx = ! empty( $active_indices ) ? $active_indices[0] : null;
			self::finalize_round( $room, $last_idx );
			self::bump_version( $room );
			return array(
				'ok'             => true,
				'isChop'         => $is_chop,
				'chopNote'       => $chop_note,
				'playerFinished' => $player_finished,
				'gameEnded'      => true,
				'rankings'       => $room['rankings'],
			);
		}

		// Tìm người tiếp theo trong vòng chưa bỏ lượt và còn bài.
		$next_player = self::find_next_turn_player( $room, $player_idx );
		if ( null !== $next_player ) {
			$room['currentTurnToken'] = $next_player['playerToken'];
		} else {
			self::reset_trick_for_new_round( $room, $player_idx, null );
		}

		self::bump_version( $room );

		return array(
			'ok'             => true,
			'isChop'         => $is_chop,
			'chopNote'       => $chop_note,
			'playerFinished' => $player_finished,
			'gameEnded'      => false,
		);
	}

	/**
	 * Xử lý hành động bỏ lượt (Pass).
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người chơi.
	 * @return array<string, mixed>
	 */
	public static function pass_turn( array &$room, $player_token ) {
		if ( 'PLAYING' !== $room['status'] ) {
			return array(
				'ok'    => false,
				'error' => 'Bàn chưa bắt đầu ván đấu',
			);
		}
		if ( $room['currentTurnToken'] !== $player_token ) {
			return array(
				'ok'    => false,
				'error' => 'Chưa tới lượt của bạn',
			);
		}
		if ( empty( $room['currentTrick'] ) ) {
			return array(
				'ok'    => false,
				'error' => 'Bạn đang là người mở vòng mới, không thể bỏ lượt!',
			);
		}

		$player_idx = -1;
		foreach ( $room['players'] as $idx => $p ) {
			if ( $p['playerToken'] === $player_token ) {
				$player_idx = $idx;
				break;
			}
		}
		if ( -1 === $player_idx ) {
			return array(
				'ok'    => false,
				'error' => 'Không tìm thấy người chơi',
			);
		}

		$room['players'][ $player_idx ]['passedInRound'] = true;
		$room['players'][ $player_idx ]['lastSeenAt']    = time();
		self::add_log( $room, '⏭️ ' . $room['players'][ $player_idx ]['nickname'] . ' bỏ lượt.' );

		$trick_owner_token = $room['currentTrick']['playerToken'];
		$trick_owner_idx   = -1;
		foreach ( $room['players'] as $idx => $p ) {
			if ( $p['playerToken'] === $trick_owner_token ) {
				$trick_owner_idx = $idx;
				break;
			}
		}

		$contenders = 0;
		foreach ( $room['players'] as $p ) {
			if ( ! empty( $p['hand'] ) && empty( $p['passedInRound'] ) && $p['playerToken'] !== $trick_owner_token ) {
				$contenders++;
			}
		}

		$new_trick_started = false;
		if ( 0 === $contenders ) {
			$owner_with_cards = null;
			if ( $trick_owner_idx >= 0 && ! empty( $room['players'][ $trick_owner_idx ]['hand'] ) ) {
				$owner_with_cards = $room['players'][ $trick_owner_idx ];
			}
			// Nếu trong vòng này đã có ít nhất 2 lượt đánh (A đánh -> B đè) rồi A bỏ qua -> đánh dấu để khi B đánh tiếp sẽ nổ câu "Này thì!"
			if ( null !== $owner_with_cards && ! empty( $room['trickPlayers'] ) && count( $room['trickPlayers'] ) >= 2 ) {
				$room['pendingFollowUpToken'] = $owner_with_cards['playerToken'];
			} else {
				$room['pendingFollowUpToken'] = null;
			}
			self::reset_trick_for_new_round(
				$room,
				$trick_owner_idx >= 0 ? $trick_owner_idx : $player_idx,
				$owner_with_cards
			);
			$new_trick_started = true;
		} else {
			$next_player = self::find_next_turn_player( $room, $player_idx );
			if ( null !== $next_player ) {
				$room['currentTurnToken'] = $next_player['playerToken'];
			}
		}

		self::push_event(
			$room,
			array(
				'type'            => 'PASS',
				'newTrickStarted' => $new_trick_started,
			)
		);
		self::bump_version( $room );

		return array(
			'ok'              => true,
			'newTrickStarted' => $new_trick_started,
		);
	}

	/**
	 * Gõ bàn gọi đồng đội.
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người gửi.
	 * @return array<string, mixed>
	 */
	public static function nudge_room( array &$room, $player_token ) {
		$now = time();
		if ( isset( $room['lastNudgeAt'] ) && ( $now - (int) $room['lastNudgeAt'] ) < 2 ) {
			return array(
				'ok'    => false,
				'error' => 'Vừa gõ bàn xong, chờ 2 giây rồi gõ tiếp nhé!',
			);
		}

		$from_name = 'Đồng đội';
		foreach ( $room['players'] as &$p ) {
			if ( $p['playerToken'] === $player_token ) {
				$from_name       = $p['nickname'];
				$p['lastSeenAt'] = $now;
				break;
			}
		}
		unset( $p );
		foreach ( $room['spectators'] as &$s ) {
			if ( $s['playerToken'] === $player_token ) {
				$from_name       = $s['nickname'];
				$s['lastSeenAt'] = $now;
				break;
			}
		}
		unset( $s );

		$unready_names = array();
		foreach ( $room['players'] as $p ) {
			if ( empty( $p['ready'] ) ) {
				$unready_names[] = $p['nickname'];
			}
		}

		$msg = '🔔 ' . $from_name . ' đang gõ bàn gọi anh em!';
		if ( 'WAITING' === $room['status'] && ! empty( $unready_names ) ) {
			$msg = '🔔 ' . $from_name . ' gõ bàn nhắc [' . implode( ', ', $unready_names ) . '] bấm Sẵn sàng!';
		} elseif ( 'PLAYING' === $room['status'] ) {
			foreach ( $room['players'] as $p ) {
				if ( $p['playerToken'] === $room['currentTurnToken'] ) {
					$msg = '🔔 ' . $from_name . ' gõ bàn giục [' . $p['nickname'] . '] đánh bài lẹ!';
					break;
				}
			}
		}

		$room['lastNudgeAt'] = $now;
		self::add_log( $room, $msg );
		$event = self::push_event(
			$room,
			array(
				'type'         => 'NUDGE',
				'fromNickname' => $from_name,
				'message'      => $msg,
			)
		);
		self::bump_version( $room );

		return array(
			'ok'    => true,
			'event' => $event,
		);
	}

	/**
	 * Gửi tin nhắn chat / icon cảm xúc / câu cà khịa nhanh trong phòng.
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người gửi.
	 * @param string               $message      Nội dung tin nhắn.
	 * @param string               $voice_text   Câu thoại phát âm thanh (nếu chọn câu cà khịa nhanh).
	 * @return array<string, mixed>
	 */
	public static function add_chat_message( array &$room, $player_token, $message, $voice_text = '', $audio_clip = '' ) {
		$now         = time();
		$sender_name = '';

		foreach ( $room['players'] as &$p ) {
			if ( $p['playerToken'] === $player_token ) {
				$sender_name     = $p['nickname'];
				$p['lastSeenAt'] = $now;
				break;
			}
		}
		unset( $p );

		if ( '' === $sender_name ) {
			foreach ( $room['spectators'] as &$s ) {
				if ( $s['playerToken'] === $player_token ) {
					$sender_name     = $s['nickname'];
					$s['lastSeenAt'] = $now;
					break;
				}
			}
			unset( $s );
		}

		if ( '' === $sender_name ) {
			return array(
				'ok'    => false,
				'error' => 'Bạn cần ở trong bàn để gửi tin nhắn chat',
			);
		}

		$clean_text  = self::sanitize_label( $message, 120, '' );
		$clean_voice = self::sanitize_label( $voice_text, 80, '' );
		$clean_clip  = preg_replace( '/[^a-zA-Z0-9_.-]/', '', (string) $audio_clip );
		if ( '' === $clean_text ) {
			return array(
				'ok'    => false,
				'error' => 'Vui lòng nhập nội dung tin nhắn',
			);
		}

		if ( ! isset( $room['chats'] ) || ! is_array( $room['chats'] ) ) {
			$room['chats'] = array();
		}

		$chat_id    = isset( $room['nextEventId'] ) ? (int) $room['nextEventId'] : $now;
		$chat_entry = array(
			'id'          => $chat_id,
			'playerToken' => $player_token,
			'nickname'    => $sender_name,
			'text'        => $clean_text,
			'voiceText'   => $clean_voice,
			'audioClip'   => $clean_clip,
			'timeLabel'   => gmdate( 'H:i', $now + 7 * 3600 ),
		);

		$room['chats'][] = $chat_entry;
		if ( count( $room['chats'] ) > 35 ) {
			$room['chats'] = array_values( array_slice( $room['chats'], -35 ) );
		}

		self::push_event(
			$room,
			array(
				'type' => 'CHAT_MESSAGE',
				'chat' => $chat_entry,
			)
		);
		self::bump_version( $room );

		return array(
			'ok'   => true,
			'chat' => $chat_entry,
		);
	}

	/**
	 * Chọn câu nói cà khịa / hiệu ứng giọng nói Miền Nam vui nhộn theo ngữ cảnh bàn bài.
	 *
	 * @param bool                 $is_chop             Có phải chặt Heo/Hàng không.
	 * @param bool                 $is_counter_3x       Có phải A -> B -> A ăn miếng trả miếng 3 nhịp không.
	 * @param bool                 $is_follow_up_strike Có phải A đánh -> B đè -> A bỏ qua -> B đánh tiếp không.
	 * @param bool                 $player_finished     Người đánh vừa hết bài.
	 * @param int|null             $finish_order        Thứ hạng vừa về.
	 * @param int                  $remaining_count     Số lá bài còn lại trên tay.
	 * @param array<string, mixed> $classified          Bộ bài vừa đánh.
	 * @return array<string, string>|null
	 */
	private static function pick_play_banter(
		$is_chop,
		$is_counter_3x,
		$is_follow_up_strike,
		$player_finished,
		$finish_order,
		$remaining_count,
		array $classified
	) {
		// 1. Chặt Heo / Đôi Heo / Đè Hàng (Giọng Miền Nam).
		if ( $is_chop ) {
			$lines = array(
				array(
					'kind'        => 'CHOP_PIG',
					'audioClip'   => 'chop_1.mp3',
					'voiceText'   => 'Chặt heo đẹp nè, rụng nụ luôn nghen bưởi!',
					'displayText' => '💥 Chặt Heo đẹp nè! Rụng nụ luôn nghen bưởi!',
				),
				array(
					'kind'        => 'CHOP_PIG',
					'audioClip'   => 'chop_2.mp3',
					'voiceText'   => 'Chặt đẹp nè! Cháy túi rồi bưởi ơi!',
					'displayText' => '🔥 Chặt đẹp nè! Cháy túi rồi bưởi ơi!',
				),
			);
			return $lines[ random_int( 0, count( $lines ) - 1 ) ];
		}

		// 2. A đánh -> B đè -> A đè ngược lại B (3 lần ăn miếng trả miếng liên tiếp).
		if ( $is_counter_3x ) {
			$lines = array(
				array(
					'kind'        => 'COUNTER_3X',
					'audioClip'   => 'counter_1.mp3',
					'voiceText'   => 'Mầy hả bưởi! Đè lại liền nè!',
					'displayText' => '🍋 Mày hả bưởi! Đè lại liền nèèè!',
				),
				array(
					'kind'        => 'COUNTER_3X',
					'audioClip'   => 'counter_2.mp3',
					'voiceText'   => 'Đỡ giùm cái coi! Mầy hả bưởi!',
					'displayText' => '🔥 Đỡ giùm cái coi! Mày hả bưởi!',
				),
				array(
					'kind'        => 'COUNTER_3X',
					'audioClip'   => 'counter_3.mp3',
					'voiceText'   => 'Chạy đâu cho thoát hả bưởi!',
					'displayText' => '😏 Chạy đâu cho thoát hả bưởi!',
				),
			);
			return $lines[ random_int( 0, count( $lines ) - 1 ) ];
		}

		// 3. A đánh -> B đè -> A bỏ qua -> B đánh tiếp ("Này thì!").
		if ( $is_follow_up_strike ) {
			$lines = array(
				array(
					'kind'        => 'FOLLOW_UP_STRIKE',
					'audioClip'   => 'followup_1.mp3',
					'voiceText'   => 'Này thì! Cướp cái là tới công chuyện luôn nè!',
					'displayText' => '⚡ Này thì! Cướp cái là tới công chuyện luôn nè!',
				),
				array(
					'kind'        => 'FOLLOW_UP_STRIKE',
					'audioClip'   => 'followup_2.mp3',
					'voiceText'   => 'Này thì! Nhường là tui hốt luôn đó nghen!',
					'displayText' => '😎 Này thì! Nhường là tui hốt luôn đó nghen!',
				),
			);
			return $lines[ random_int( 0, count( $lines ) - 1 ) ];
		}

		// 4. Về Nhất (Hết bài đầu tiên).
		if ( $player_finished && 1 === (int) $finish_order ) {
			return array(
				'kind'        => 'WIN_FIRST',
				'audioClip'   => 'win_1.mp3',
				'voiceText'   => 'Về nhất rồi nghen! Xin nhẹ cái top một!',
				'displayText' => '🏆 Về nhất rồi nghen! Xin nhẹ cái Top 1!',
			);
		}

		// 5. Báo cháy: chỉ còn đúng 1 lá bài trên tay.
		if ( 1 === (int) $remaining_count ) {
			return array(
				'kind'        => 'LAST_CARD',
				'audioClip'   => 'lastcard_1.mp3',
				'voiceText'   => 'Báo cháy nghen! Còn đúng một lá thôi đó!',
				'displayText' => '🚨 Báo cháy nghen! Còn đúng 1 lá thôi đó!',
			);
		}

		// 6. Ra Heo hoặc Đôi Heo dọa làng.
		if ( isset( $classified['highCard']['rankValue'] ) && 12 === (int) $classified['highCard']['rankValue'] ) {
			return array(
				'kind'        => 'PIG_PLAYED',
				'audioClip'   => 'pig_1.mp3',
				'voiceText'   => 'Heo xuất chuồng nè bà con! Ai có hàng thì nhào vô!',
				'displayText' => '🐷 Heo xuất chuồng nè bà con! Ai có hàng thì nhào vô!',
			);
		}

		return null;
	}

	/**
	 * Người chơi chủ động rời bàn.
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người rời.
	 * @return array<string, mixed>
	 */
	public static function leave_room( array &$room, $player_token ) {
		// Kiểm tra khán giả.
		foreach ( $room['spectators'] as $idx => $s ) {
			if ( $s['playerToken'] === $player_token ) {
				array_splice( $room['spectators'], $idx, 1 );
				$room['spectators'] = array_values( $room['spectators'] );
				self::bump_version( $room );
				return array(
					'ok'          => true,
					'roomId'      => $room['roomId'],
					'roomDeleted' => false,
				);
			}
		}

		// Kiểm tra người chơi.
		$p_idx = -1;
		foreach ( $room['players'] as $idx => $p ) {
			if ( $p['playerToken'] === $player_token ) {
				$p_idx = $idx;
				break;
			}
		}
		if ( -1 === $p_idx ) {
			return array(
				'ok'          => false,
				'roomDeleted' => false,
			);
		}

		$leaving_player  = $room['players'][ $p_idx ];
		array_splice( $room['players'], $p_idx, 1 );
		$room['players'] = array_values( $room['players'] );

		self::add_log( $room, '🚪 ' . $leaving_player['nickname'] . ' đã rời bàn.' );

		if ( empty( $room['players'] ) ) {
			return array(
				'ok'          => true,
				'roomId'      => $room['roomId'],
				'roomDeleted' => true,
			);
		}

		// Chuyển quyền Chủ phòng nếu Chủ phòng rời.
		if ( $room['hostToken'] === $player_token ) {
			$room['hostToken'] = $room['players'][0]['playerToken'];
			self::add_log( $room, '👑 ' . $room['players'][0]['nickname'] . ' trở thành Chủ phòng mới.' );
		}

		if ( 'COUNTDOWN' === $room['status'] ) {
			$room['status']         = 'WAITING';
			$room['countdownEndAt'] = null;
			self::push_event(
				$room,
				array(
					'type'    => 'COUNTDOWN_CANCELLED',
					'message' => '⏸️ Đã dừng đếm ngược do ' . $leaving_player['nickname'] . ' rời bàn.',
				)
			);
		} elseif ( 'PLAYING' === $room['status'] ) {
			$active_indices = array();
			foreach ( $room['players'] as $idx => $p ) {
				if ( ! empty( $p['hand'] ) ) {
					$active_indices[] = $idx;
				}
			}

			if ( count( $room['players'] ) < 2 || count( $active_indices ) <= 1 ) {
				$last_idx = ! empty( $active_indices ) ? $active_indices[0] : 0;
				self::finalize_round( $room, $last_idx );
			} elseif ( $room['currentTurnToken'] === $player_token ) {
				$from_idx    = ( $p_idx - 1 + count( $room['players'] ) ) % count( $room['players'] );
				$next_player = self::find_next_turn_player( $room, $from_idx );
				if ( null !== $next_player ) {
					$room['currentTurnToken'] = $next_player['playerToken'];
				} else {
					self::reset_trick_for_new_round( $room, $from_idx, null );
				}
			}
		}

		self::bump_version( $room );

		return array(
			'ok'          => true,
			'roomId'      => $room['roomId'],
			'roomDeleted' => false,
		);
	}

	/**
	 * Cập nhật nhịp tim (heartbeat) cho người chơi để hiện chấm Xanh/Đỏ mà không spam ghi DB.
	 *
	 * @param array<string, mixed> $room         Trạng thái phòng.
	 * @param string               $player_token Token người xem.
	 * @param int                  $min_interval Chỉ cập nhật nếu cách lần trước >= N giây.
	 * @return bool True nếu có thay đổi cần lưu DB.
	 */
	public static function touch_heartbeat( array &$room, $player_token, $min_interval = 5 ) {
		if ( '' === $player_token ) {
			return false;
		}
		$now = time();

		foreach ( $room['players'] as &$p ) {
			if ( $p['playerToken'] === $player_token ) {
				$diff = $now - (int) $p['lastSeenAt'];
				if ( $diff >= $min_interval ) {
					$was_offline     = $diff > self::ONLINE_TIMEOUT_SECONDS;
					$p['lastSeenAt'] = $now;
					if ( $was_offline ) {
						self::bump_version( $room );
					}
					return true;
				}
				return false;
			}
		}
		unset( $p );

		foreach ( $room['spectators'] as &$s ) {
			if ( $s['playerToken'] === $player_token ) {
				$diff = $now - (int) $s['lastSeenAt'];
				if ( $diff >= $min_interval ) {
					$was_offline     = $diff > self::ONLINE_TIMEOUT_SECONDS;
					$s['lastSeenAt'] = $now;
					if ( $was_offline ) {
						self::bump_version( $room );
					}
					return true;
				}
				return false;
			}
		}
		unset( $s );

		return false;
	}

	/**
	 * Tạo payload trạng thái cá nhân hóa cho 1 người chơi (ẩn bài đối thủ).
	 *
	 * @param array<string, mixed> $room           Trạng thái phòng.
	 * @param string               $viewer_token   Token người xem.
	 * @param int                  $since_event_id ID sự kiện gần nhất client đã xử lý.
	 * @return array<string, mixed>
	 */
	public static function build_client_state( array $room, $viewer_token, $since_event_id = 0 ) {
		$now        = time();
		$readiness  = self::evaluate_readiness( $room );
		$me         = null;
		$is_spec    = false;
		$players_js = array();

		foreach ( $room['players'] as $p ) {
			if ( $p['playerToken'] === $viewer_token ) {
				$me = $p;
			}
			$online       = ( $now - (int) $p['lastSeenAt'] ) <= self::ONLINE_TIMEOUT_SECONDS;
			$players_js[] = array(
				'playerToken'   => $p['playerToken'],
				'nickname'      => $p['nickname'],
				'seatIndex'     => (int) $p['seatIndex'],
				'isHost'        => ( $p['playerToken'] === $room['hostToken'] ),
				'ready'         => ! empty( $p['ready'] ),
				'online'        => $online,
				'cardCount'     => count( $p['hand'] ),
				'passedInRound' => ! empty( $p['passedInRound'] ),
				'finishOrder'   => $p['finishOrder'],
				'score'         => (int) $p['score'],
			);
		}

		$spectators_js = array();
		foreach ( $room['spectators'] as $s ) {
			if ( null === $me && $s['playerToken'] === $viewer_token ) {
				$is_spec = true;
			}
			$spectators_js[] = array(
				'playerToken' => $s['playerToken'],
				'nickname'    => $s['nickname'],
				'online'      => ( $now - (int) $s['lastSeenAt'] ) <= self::ONLINE_TIMEOUT_SECONDS,
			);
		}

		$countdown_seconds = null;
		if ( 'COUNTDOWN' === $room['status'] && ! empty( $room['countdownEndAt'] ) ) {
			$countdown_seconds = max( 1, (int) ceil( (float) $room['countdownEndAt'] - microtime( true ) ) );
		}

		$new_events      = array();
		$latest_event_id = 0;
		foreach ( $room['events'] as $ev ) {
			$eid = (int) $ev['id'];
			if ( $eid > $latest_event_id ) {
				$latest_event_id = $eid;
			}
			if ( $eid > (int) $since_event_id ) {
				$new_events[] = $ev;
			}
		}

		return array(
			'roomId'                 => $room['roomId'],
			'roomName'               => $room['roomName'],
			'hostToken'              => $room['hostToken'],
			'status'                 => $room['status'],
			'countdownSeconds'       => $countdown_seconds,
			'roundNumber'            => (int) $room['roundNumber'],
			'currentTurnToken'       => $room['currentTurnToken'],
			'requiredFirstCardId'    => $room['requiredFirstCardId'],
			'requiredFirstCardLabel' => $room['requiredFirstCardLabel'],
			'currentTrick'           => $room['currentTrick'],
			'tableHistory'           => array_values( $room['tableHistory'] ),
			'rankings'               => array_values( $room['rankings'] ),
			'logs'                   => array_values( array_slice( $room['logs'], -15 ) ),
			'chats'                  => isset( $room['chats'] ) && is_array( $room['chats'] ) ? array_values( array_slice( $room['chats'], -35 ) ) : array(),
			'readiness'              => $readiness,
			'myRole'                 => null !== $me ? 'PLAYER' : ( $is_spec ? 'SPECTATOR' : 'VISITOR' ),
			'myHand'                 => null !== $me ? array_values( $me['hand'] ) : array(),
			'players'                => $players_js,
			'spectators'             => $spectators_js,
			'version'                => (int) $room['version'],
			'latestEventId'          => $latest_event_id,
			'newEvents'              => $new_events,
		);
	}

	/**
	 * Tạo dòng tóm tắt phòng cho Sảnh chờ (Live Lobby).
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return array<string, mixed>
	 */
	public static function build_lobby_item( array $room ) {
		$host_nick = 'Ẩn danh';
		foreach ( $room['players'] as $p ) {
			if ( $p['playerToken'] === $room['hostToken'] ) {
				$host_nick = $p['nickname'];
				break;
			}
		}
		if ( 'Ẩn danh' === $host_nick && ! empty( $room['players'][0]['nickname'] ) ) {
			$host_nick = $room['players'][0]['nickname'];
		}

		return array(
			'roomId'         => $room['roomId'],
			'roomName'       => $room['roomName'],
			'hostNickname'   => $host_nick,
			'playerCount'    => count( $room['players'] ),
			'maxPlayers'     => 4,
			'spectatorCount' => count( $room['spectators'] ),
			'status'         => $room['status'],
			'roundNumber'    => (int) $room['roundNumber'],
		);
	}

	/**
	 * Tìm người chơi tiếp theo còn bài và chưa bỏ lượt.
	 *
	 * @param array<string, mixed> $room       Trạng thái phòng.
	 * @param int                  $from_index Vị trí hiện tại.
	 * @return array<string, mixed>|null
	 */
	private static function find_next_turn_player( array $room, $from_index ) {
		$count = count( $room['players'] );
		if ( 0 === $count ) {
			return null;
		}
		for ( $step = 1; $step <= $count; $step++ ) {
			$idx       = ( $from_index + $step ) % $count;
			$candidate = $room['players'][ $idx ];
			if ( ! empty( $candidate['hand'] ) && empty( $candidate['passedInRound'] ) ) {
				return $candidate;
			}
		}
		return null;
	}

	/**
	 * Mở vòng đánh mới (reset trick và cờ passedInRound).
	 *
	 * @param array<string, mixed>      $room             Trạng thái phòng.
	 * @param int                       $owner_seat_idx   Vị trí người thắng vòng.
	 * @param array<string, mixed>|null $owner_with_cards Người thắng vòng nếu còn bài.
	 * @return void
	 */
	private static function reset_trick_for_new_round( array &$room, $owner_seat_idx, $owner_with_cards = null ) {
		$room['currentTrick'] = null;
		$room['tableHistory'] = array();
		$room['trickPlayers'] = array();
		foreach ( $room['players'] as &$p ) {
			$p['passedInRound'] = false;
		}
		unset( $p );

		if ( null !== $owner_with_cards && ! empty( $owner_with_cards['hand'] ) ) {
			$room['currentTurnToken'] = $owner_with_cards['playerToken'];
			self::add_log( $room, '🔄 Vòng mới! ' . $owner_with_cards['nickname'] . ' được quyền ra bài tự do.' );
			return;
		}

		$next_starter = self::find_next_turn_player( $room, $owner_seat_idx );
		if ( null !== $next_starter ) {
			$room['currentTurnToken'] = $next_starter['playerToken'];
			self::add_log( $room, '🔄 Vòng mới! ' . $next_starter['nickname'] . ' được quyền ra bài tự do.' );
		}
	}

	/**
	 * Tổng kết ván, tính điểm và xếp khán giả vào ghế cho ván sau.
	 *
	 * @param array<string, mixed> $room                Trạng thái phòng.
	 * @param int|null             $last_remaining_idx  Vị trí người cuối cùng còn bài.
	 * @return void
	 */
	private static function finalize_round( array &$room, $last_remaining_idx ) {
		if ( null !== $last_remaining_idx && isset( $room['players'][ $last_remaining_idx ] ) ) {
			if ( null === $room['players'][ $last_remaining_idx ]['finishOrder'] ) {
				$room['finishCounter']                                 = (int) $room['finishCounter'] + 1;
				$room['players'][ $last_remaining_idx ]['finishOrder'] = $room['finishCounter'];
			}
		}

		$total     = count( $room['players'] );
		$title_map = array(
			2 => array( 'Nhất', 'Bét' ),
			3 => array( 'Nhất', 'Nhì', 'Bét' ),
			4 => array( 'Nhất', 'Nhì', 'Ba', 'Bét' ),
		);
		$score_map = array(
			2 => array( 10, -10 ),
			3 => array( 15, 5, -20 ),
			4 => array( 20, 10, -10, -20 ),
		);

		$titles = isset( $title_map[ $total ] ) ? $title_map[ $total ] : array( 'Nhất', 'Nhì', 'Ba', 'Bét' );
		$deltas = isset( $score_map[ $total ] ) ? $score_map[ $total ] : array( 20, 10, -10, -20 );

		// Sắp xếp theo finishOrder để tính điểm mà không làm đảo seatIndex của $room['players'].
		$order_indices = array_keys( $room['players'] );
		usort(
			$order_indices,
			function ( $i, $j ) use ( $room ) {
				$fi = null !== $room['players'][ $i ]['finishOrder'] ? (int) $room['players'][ $i ]['finishOrder'] : 99;
				$fj = null !== $room['players'][ $j ]['finishOrder'] ? (int) $room['players'][ $j ]['finishOrder'] : 99;
				return $fi - $fj;
			}
		);

		$rankings = array();
		foreach ( $order_indices as $place_idx => $p_idx ) {
			$delta                                  = isset( $deltas[ $place_idx ] ) ? (int) $deltas[ $place_idx ] : 0;
			$room['players'][ $p_idx ]['score']     = (int) $room['players'][ $p_idx ]['score'] + $delta;
			$p                                      = $room['players'][ $p_idx ];
			$rankings[]                             = array(
				'playerToken'    => $p['playerToken'],
				'nickname'       => $p['nickname'],
				'place'          => $place_idx + 1,
				'rankTitle'      => isset( $titles[ $place_idx ] ) ? $titles[ $place_idx ] : 'Hạng ' . ( $place_idx + 1 ),
				'scoreDelta'     => $delta,
				'totalScore'     => (int) $p['score'],
				'remainingCards' => count( $p['hand'] ),
			);
		}
		$room['rankings'] = $rankings;

		if ( ! empty( $rankings ) ) {
			$room['lastWinnerToken'] = $rankings[0]['playerToken'];
			self::add_log(
				$room,
				'🏁 Kết thúc ván #' . $room['roundNumber'] . '! Nhất: ' . $rankings[0]['nickname'] . '. Bấm Sẵn sàng để chơi ván tiếp theo!'
			);
			self::push_event(
				$room,
				array(
					'type'     => 'GAME_ENDED',
					'rankings' => $rankings,
					'message'  => '🏆 Kết thúc ván! Nhất: ' . $rankings[0]['nickname'],
				)
			);
		}

		// Đưa phòng về trạng thái WAITING.
		$room['status']                 = 'WAITING';
		$room['countdownEndAt']         = null;
		$room['currentTurnToken']       = null;
		$room['currentTrick']           = null;
		$room['requiredFirstCardId']    = null;
		$room['requiredFirstCardLabel'] = null;

		foreach ( $room['players'] as &$p ) {
			$p['ready']         = false;
			$p['passedInRound'] = false;
		}
		unset( $p );

		// Nếu bàn còn ghế trống (< 4) và có khán giả -> xếp vào ghế cho ván mới.
		while ( count( $room['players'] ) < 4 && ! empty( $room['spectators'] ) ) {
			$spec        = array_shift( $room['spectators'] );
			$taken_seats = array();
			foreach ( $room['players'] as $p ) {
				$taken_seats[ (int) $p['seatIndex'] ] = true;
			}
			$seat_index = 0;
			while ( isset( $taken_seats[ $seat_index ] ) ) {
				$seat_index++;
			}
			$room['players'][] = array(
				'playerToken'   => $spec['playerToken'],
				'nickname'      => $spec['nickname'],
				'seatIndex'     => $seat_index,
				'ready'         => false,
				'lastSeenAt'    => $spec['lastSeenAt'],
				'hand'          => array(),
				'passedInRound' => false,
				'finishOrder'   => null,
				'score'         => 0,
			);
			usort(
				$room['players'],
				function ( $a, $b ) {
					return (int) $a['seatIndex'] - (int) $b['seatIndex'];
				}
			);
			$room['players'] = array_values( $room['players'] );
			self::add_log( $room, '🪑 Khán giả ' . $spec['nickname'] . ' đã được xếp vào ghế chơi ván mới!' );
		}
		$room['spectators'] = array_values( $room['spectators'] );
	}
}
