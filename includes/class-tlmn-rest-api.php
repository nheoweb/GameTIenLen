<?php
/**
 * WordPress REST API Endpoints cho Game Tiến Lên Miền Nam (chống LiteSpeed Cache).
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TLMN_Rest_Api {

	const API_NAMESPACE = 'tien-len/v1';

	/**
	 * Đăng ký toàn bộ routes REST API.
	 *
	 * @return void
	 */
	public static function register_routes() {
		register_rest_route(
			self::API_NAMESPACE,
			'/lobby',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'handle_lobby' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_create_room' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/join',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_join_room' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'handle_get_room' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/ready',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_ready' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/start',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_start' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/nudge',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_nudge' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/leave',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_leave' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/play',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_play' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/pass',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_pass' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/rooms/(?P<room_id>\d{4})/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_chat' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Tạo WP_REST_Response kèm header chống cache (quan trọng cho Hostinger LiteSpeed Cache).
	 *
	 * @param array<string, mixed> $data   Dữ liệu JSON.
	 * @param int                  $status HTTP status code.
	 * @return WP_REST_Response
	 */
	private static function json_response( array $data, $status = 200 ) {
		$response = new WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Expires', '0' );
		$response->header( 'X-LiteSpeed-Cache-Control', 'no-cache' );
		return $response;
	}

	/**
	 * Đọc body JSON hoặc tham số request.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array<string, mixed>
	 */
	private static function get_payload( WP_REST_Request $request ) {
		$json = $request->get_json_params();
		if ( is_array( $json ) && ! empty( $json ) ) {
			return $json;
		}
		$params = $request->get_params();
		return is_array( $params ) ? $params : array();
	}

	/**
	 * GET /lobby — Danh sách các phòng đang mở.
	 *
	 * @return WP_REST_Response
	 */
	public static function handle_lobby() {
		$rooms = TLMN_Storage::get_all_rooms();
		$list  = array();
		foreach ( $rooms as $room ) {
			$list[] = TLMN_Room_Manager::build_lobby_item( $room );
		}

		return self::json_response(
			array(
				'ok'    => true,
				'rooms' => $list,
			)
		);
	}

	/**
	 * POST /rooms — Tạo bàn mới.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_create_room( WP_REST_Request $request ) {
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$nickname     = isset( $payload['nickname'] ) ? trim( (string) $payload['nickname'] ) : '';
		$room_name    = isset( $payload['roomName'] ) ? (string) $payload['roomName'] : '';

		if ( strlen( $player_token ) < 4 || '' === $nickname ) {
			return self::json_response(
				array(
					'ok'    => false,
					'error' => 'Vui lòng nhập Tên hiển thị (Nickname)',
				)
			);
		}

		TLMN_Storage::leave_other_rooms_by_token( $player_token );

		$room_id = TLMN_Storage::generate_unique_room_id();
		$room    = TLMN_Room_Manager::create_room_state( $room_id, $player_token, $nickname, $room_name );
		$saved   = TLMN_Storage::save_room( $room );

		if ( ! $saved ) {
			return self::json_response(
				array(
					'ok'    => false,
					'error' => 'Không thể lưu phòng mới vào cơ sở dữ liệu',
				),
				500
			);
		}

		return self::json_response(
			array(
				'ok'     => true,
				'roomId' => $room_id,
				'state'  => TLMN_Room_Manager::build_client_state( $room, $player_token, 0 ),
			)
		);
	}

	/**
	 * POST /rooms/join — Vào bàn bằng mã 4 số hoặc kết nối lại (F5).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_join_room( WP_REST_Request $request ) {
		$payload      = self::get_payload( $request );
		$room_id      = isset( $payload['roomId'] ) ? trim( (string) $payload['roomId'] ) : '';
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$nickname     = isset( $payload['nickname'] ) ? trim( (string) $payload['nickname'] ) : '';

		if ( ! preg_match( '/^\d{4}$/', $room_id ) ) {
			return self::json_response(
				array(
					'ok'    => false,
					'error' => 'Mã phòng không hợp lệ (gồm 4 chữ số)',
				)
			);
		}
		if ( strlen( $player_token ) < 4 || '' === $nickname ) {
			return self::json_response(
				array(
					'ok'    => false,
					'error' => 'Thiếu thông tin người chơi',
				)
			);
		}

		TLMN_Storage::leave_other_rooms_by_token( $player_token, $room_id );

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $nickname ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng #' . $room_id,
					);
				}

				TLMN_Room_Manager::check_countdown_completion( $room );
				$join_res = TLMN_Room_Manager::join_room( $room, $player_token, $nickname );
				if ( empty( $join_res['ok'] ) ) {
					return $join_res;
				}

				TLMN_Storage::save_room( $room );
				$state = TLMN_Room_Manager::build_client_state( $room, $player_token, 0 );

				return array(
					'ok'             => true,
					'roomId'         => $room_id,
					'role'           => $join_res['role'],
					'reconnected'    => $join_res['reconnected'],
					'joinAlertType'  => $join_res['joinAlertType'],
					'immediateAlert' => isset( $join_res['immediateAlert'] ) ? $join_res['immediateAlert'] : null,
					'state'          => $state,
				);
			}
		);

		return self::json_response( $result );
	}

	/**
	 * GET /rooms/{room_id} — Smart Polling trạng thái phòng.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_get_room( WP_REST_Request $request ) {
		$room_id        = (string) $request->get_param( 'room_id' );
		$player_token   = TLMN_Room_Manager::sanitize_token( $request->get_param( 'token' ) );
		$client_version = (int) $request->get_param( 'version' );
		$since_event_id = (int) $request->get_param( 'sinceEventId' );
		$do_heartbeat   = ( '1' === (string) $request->get_param( 'hb' ) );

		$meta = TLMN_Storage::get_room_meta( $room_id );
		if ( ! $meta ) {
			return self::json_response(
				array(
					'ok'      => false,
					'deleted' => true,
					'error'   => 'Phòng đã đóng hoặc không tồn tại',
				)
			);
		}

		// Nhánh siêu nhẹ: nếu bàn không đếm ngược, version không đổi và chưa tới nhịp heartbeat -> trả ngay!
		if (
			'COUNTDOWN' !== $meta['status'] &&
			$client_version > 0 &&
			(int) $meta['version'] === $client_version &&
			! $do_heartbeat
		) {
			return self::json_response(
				array(
					'ok'        => true,
					'unchanged' => true,
					'version'   => (int) $meta['version'],
				)
			);
		}

		// Nếu đang đếm ngược hoặc cần cập nhật heartbeat -> xử lý an toàn trong lock.
		if ( 'COUNTDOWN' === $meta['status'] || $do_heartbeat ) {
			$response_data = TLMN_Storage::with_room_lock(
				$room_id,
				function () use ( $room_id, $player_token, $since_event_id ) {
					$room = TLMN_Storage::get_room( $room_id );
					if ( ! $room ) {
						return array(
							'ok'      => false,
							'deleted' => true,
							'error'   => 'Phòng đã đóng hoặc không tồn tại',
						);
					}

					$dirty = false;
					if ( TLMN_Room_Manager::check_countdown_completion( $room ) ) {
						$dirty = true;
					}
					if ( TLMN_Room_Manager::touch_heartbeat( $room, $player_token, 4 ) ) {
						$dirty = true;
					}
					if ( $dirty ) {
						TLMN_Storage::save_room( $room );
					}

					return array(
						'ok'        => true,
						'unchanged' => false,
						'state'     => TLMN_Room_Manager::build_client_state( $room, $player_token, $since_event_id ),
					);
				}
			);

			return self::json_response( $response_data );
		}

		// Version đã đổi (không đếm ngược, không cần ghi DB) -> chỉ đọc thẳng.
		$room = TLMN_Storage::get_room( $room_id );
		if ( ! $room ) {
			return self::json_response(
				array(
					'ok'      => false,
					'deleted' => true,
					'error'   => 'Phòng đã đóng hoặc không tồn tại',
				)
			);
		}

		return self::json_response(
			array(
				'ok'        => true,
				'unchanged' => false,
				'state'     => TLMN_Room_Manager::build_client_state( $room, $player_token, $since_event_id ),
			)
		);
	}

	/**
	 * POST /rooms/{room_id}/ready — Bật/tắt Sẵn sàng.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_ready( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$ready        = ! empty( $payload['ready'] );
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $ready, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				TLMN_Room_Manager::check_countdown_completion( $room );
				$res = TLMN_Room_Manager::set_player_ready( $room, $player_token, $ready );
				if ( empty( $res['ok'] ) ) {
					return $res;
				}

				TLMN_Storage::save_room( $room );
				$res['state'] = TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev );
				return $res;
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/start — Chủ phòng bấm bắt đầu chia bài.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_start( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				$check = TLMN_Room_Manager::can_host_start_game( $room, $player_token );
				if ( empty( $check['allowed'] ) ) {
					return array(
						'ok'    => false,
						'error' => $check['reason'],
					);
				}

				TLMN_Room_Manager::start_countdown( $room, TLMN_Room_Manager::COUNTDOWN_SECONDS );
				TLMN_Storage::save_room( $room );

				return array(
					'ok'    => true,
					'state' => TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev ),
				);
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/nudge — Gõ bàn gọi bạn.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_nudge( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				$res = TLMN_Room_Manager::nudge_room( $room, $player_token );
				if ( empty( $res['ok'] ) ) {
					return $res;
				}

				TLMN_Storage::save_room( $room );
				$res['state'] = TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev );
				return $res;
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/leave — Rời bàn về sảnh.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_leave( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'          => true,
						'roomDeleted' => true,
					);
				}

				$res = TLMN_Room_Manager::leave_room( $room, $player_token );
				if ( ! empty( $res['roomDeleted'] ) ) {
					TLMN_Storage::delete_room( $room_id );
				} elseif ( ! empty( $res['ok'] ) ) {
					TLMN_Storage::save_room( $room );
				}

				return array(
					'ok'          => true,
					'roomDeleted' => ! empty( $res['roomDeleted'] ),
				);
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/play — Đánh bài.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_play( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$card_ids     = isset( $payload['cardIds'] ) && is_array( $payload['cardIds'] ) ? $payload['cardIds'] : array();
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $card_ids, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				$res = TLMN_Room_Manager::play_cards( $room, $player_token, $card_ids );
				if ( empty( $res['ok'] ) ) {
					return $res;
				}

				TLMN_Storage::save_room( $room );
				$res['state'] = TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev );
				return $res;
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/pass — Bỏ lượt.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_pass( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				$res = TLMN_Room_Manager::pass_turn( $room, $player_token );
				if ( empty( $res['ok'] ) ) {
					return $res;
				}

				TLMN_Storage::save_room( $room );
				$res['state'] = TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev );
				return $res;
			}
		);

		return self::json_response( $result );
	}

	/**
	 * POST /rooms/{room_id}/chat — Gửi tin nhắn chat / icon cảm xúc / cà khịa nhanh.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_chat( WP_REST_Request $request ) {
		$room_id      = (string) $request->get_param( 'room_id' );
		$payload      = self::get_payload( $request );
		$player_token = TLMN_Room_Manager::sanitize_token( isset( $payload['playerToken'] ) ? $payload['playerToken'] : '' );
		$message      = isset( $payload['message'] ) ? (string) $payload['message'] : '';
		$voice_text   = isset( $payload['voiceText'] ) ? (string) $payload['voiceText'] : '';
		$audio_clip   = isset( $payload['audioClip'] ) ? (string) $payload['audioClip'] : '';
		$since_ev     = isset( $payload['sinceEventId'] ) ? (int) $payload['sinceEventId'] : 0;

		$result = TLMN_Storage::with_room_lock(
			$room_id,
			function () use ( $room_id, $player_token, $message, $voice_text, $audio_clip, $since_ev ) {
				$room = TLMN_Storage::get_room( $room_id );
				if ( ! $room ) {
					return array(
						'ok'    => false,
						'error' => 'Không tìm thấy phòng',
					);
				}

				$res = TLMN_Room_Manager::add_chat_message( $room, $player_token, $message, $voice_text, $audio_clip );
				if ( empty( $res['ok'] ) ) {
					return $res;
				}

				TLMN_Storage::save_room( $room );
				$res['state'] = TLMN_Room_Manager::build_client_state( $room, $player_token, $since_ev );
				return $res;
			}
		);

		return self::json_response( $result );
	}
}
