<?php
/**
 * Luật phân loại bộ bài và so sánh / chặt Heo / Hàng trong Tiến Lên Miền Nam.
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TLMN_Rules {

	const TYPE_INVALID        = 'INVALID';
	const TYPE_SINGLE         = 'SINGLE';
	const TYPE_PAIR           = 'PAIR';
	const TYPE_TRIPLE         = 'TRIPLE';
	const TYPE_STRAIGHT       = 'STRAIGHT';
	const TYPE_THREE_PAIRS    = 'THREE_PAIRS';
	const TYPE_FOUR_OF_A_KIND = 'FOUR_OF_A_KIND';
	const TYPE_FOUR_PAIRS     = 'FOUR_PAIRS';

	/**
	 * Phân loại bộ bài Tiến Lên Miền Nam.
	 *
	 * @param array<int, array<string, mixed>> $cards Mảng các đối tượng lá bài.
	 * @return array<string, mixed>
	 */
	public static function classify_hand( $cards ) {
		if ( ! is_array( $cards ) || empty( $cards ) ) {
			return array(
				'valid'  => false,
				'type'   => self::TYPE_INVALID,
				'reason' => 'Chưa chọn bài',
			);
		}

		// Kiểm tra trùng lá bài.
		$seen_ids = array();
		foreach ( $cards as $c ) {
			if ( ! isset( $c['id'] ) ) {
				return array(
					'valid'  => false,
					'type'   => self::TYPE_INVALID,
					'reason' => 'Dữ liệu lá bài không hợp lệ',
				);
			}
			$seen_ids[ $c['id'] ] = true;
		}
		if ( count( $seen_ids ) !== count( $cards ) ) {
			return array(
				'valid'  => false,
				'type'   => self::TYPE_INVALID,
				'reason' => 'Bài chứa lá trùng lặp',
			);
		}

		$sorted    = TLMN_Deck::sort_cards( $cards );
		$len       = count( $sorted );
		$high_card = $sorted[ $len - 1 ];

		// 1. Lá lẻ (SINGLE).
		if ( 1 === $len ) {
			return array(
				'valid'    => true,
				'type'     => self::TYPE_SINGLE,
				'label'    => 'Lá lẻ (' . $high_card['label'] . ')',
				'length'   => 1,
				'highCard' => $high_card,
				'cards'    => $sorted,
			);
		}

		// 2. Đôi (PAIR).
		if ( 2 === $len ) {
			if ( (int) $sorted[0]['rankValue'] === (int) $sorted[1]['rankValue'] ) {
				return array(
					'valid'    => true,
					'type'     => self::TYPE_PAIR,
					'label'    => 'Đôi ' . $high_card['rank'],
					'length'   => 2,
					'highCard' => $high_card,
					'cards'    => $sorted,
				);
			}
			return array(
				'valid'  => false,
				'type'   => self::TYPE_INVALID,
				'reason' => '2 lá không cùng số',
			);
		}

		// 3. Sám cô (TRIPLE).
		if (
			3 === $len &&
			(int) $sorted[0]['rankValue'] === (int) $sorted[1]['rankValue'] &&
			(int) $sorted[1]['rankValue'] === (int) $sorted[2]['rankValue']
		) {
			return array(
				'valid'    => true,
				'type'     => self::TYPE_TRIPLE,
				'label'    => 'Sám cô ' . $high_card['rank'],
				'length'   => 3,
				'highCard' => $high_card,
				'cards'    => $sorted,
			);
		}

		// 4. Tứ quý (FOUR_OF_A_KIND).
		if (
			4 === $len &&
			(int) $sorted[0]['rankValue'] === (int) $sorted[1]['rankValue'] &&
			(int) $sorted[1]['rankValue'] === (int) $sorted[2]['rankValue'] &&
			(int) $sorted[2]['rankValue'] === (int) $sorted[3]['rankValue']
		) {
			return array(
				'valid'    => true,
				'type'     => self::TYPE_FOUR_OF_A_KIND,
				'label'    => 'Tứ quý ' . $high_card['rank'],
				'length'   => 4,
				'highCard' => $high_card,
				'cards'    => $sorted,
			);
		}

		// 5. Đôi thông (3 đôi thông = 6 lá, 4 đôi thông = 8 lá).
		if ( ( 6 === $len || 8 === $len ) && self::is_consecutive_pairs( $sorted ) ) {
			$pair_count = (int) ( $len / 2 );
			$type       = ( 3 === $pair_count ) ? self::TYPE_THREE_PAIRS : self::TYPE_FOUR_PAIRS;
			return array(
				'valid'    => true,
				'type'     => $type,
				'label'    => $pair_count . ' Đôi thông (' . $sorted[0]['rank'] . ' → ' . $high_card['rank'] . ')',
				'length'   => $len,
				'highCard' => $high_card,
				'cards'    => $sorted,
			);
		}

		// 6. Sảnh (STRAIGHT: từ 3 lá liên tiếp trở lên, không chứa Heo '2').
		if ( $len >= 3 && self::is_straight( $sorted ) ) {
			return array(
				'valid'    => true,
				'type'     => self::TYPE_STRAIGHT,
				'label'    => 'Sảnh ' . $len . ' lá (' . $sorted[0]['rank'] . ' → ' . $high_card['label'] . ')',
				'length'   => $len,
				'highCard' => $high_card,
				'cards'    => $sorted,
			);
		}

		return array(
			'valid'  => false,
			'type'   => self::TYPE_INVALID,
			'reason' => 'Bộ bài không hợp lệ theo luật Tiến Lên Miền Nam',
		);
	}

	/**
	 * Kiểm tra sảnh liên tiếp (không chứa 2).
	 *
	 * @param array<int, array<string, mixed>> $sorted Các lá đã sắp xếp.
	 * @return bool
	 */
	private static function is_straight( array $sorted ) {
		foreach ( $sorted as $c ) {
			if ( 12 === (int) $c['rankValue'] ) {
				return false;
			}
		}
		$len = count( $sorted );
		for ( $i = 1; $i < $len; $i++ ) {
			if ( (int) $sorted[ $i ]['rankValue'] !== (int) $sorted[ $i - 1 ]['rankValue'] + 1 ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Kiểm tra đôi thông liên tiếp (không chứa đôi 2).
	 *
	 * @param array<int, array<string, mixed>> $sorted Các lá đã sắp xếp.
	 * @return bool
	 */
	private static function is_consecutive_pairs( array $sorted ) {
		foreach ( $sorted as $c ) {
			if ( 12 === (int) $c['rankValue'] ) {
				return false;
			}
		}
		$pair_count = (int) ( count( $sorted ) / 2 );
		for ( $i = 0; $i < $pair_count; $i++ ) {
			$first  = $sorted[ $i * 2 ];
			$second = $sorted[ $i * 2 + 1 ];
			if ( (int) $first['rankValue'] !== (int) $second['rankValue'] ) {
				return false;
			}
			if ( $i > 0 ) {
				$prev_pair_rank = (int) $sorted[ ( $i - 1 ) * 2 ]['rankValue'];
				if ( (int) $first['rankValue'] !== $prev_pair_rank + 1 ) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Kiểm tra bộ bài mới ($next_hand) có đè/chặt được bộ bài hiện tại trên bàn ($prev_hand) không.
	 *
	 * @param array<string, mixed>|null $prev_hand Bộ bài trên bàn (null nếu mở vòng mới).
	 * @param array<string, mixed>      $next_hand Bộ bài định đánh.
	 * @return array<string, mixed>
	 */
	public static function can_beat( $prev_hand, $next_hand ) {
		if ( ! is_array( $next_hand ) || empty( $next_hand['valid'] ) ) {
			return array(
				'allowed' => false,
				'isChop'  => false,
				'reason'  => isset( $next_hand['reason'] ) ? $next_hand['reason'] : 'Bộ bài không hợp lệ',
			);
		}

		// Bàn đang trống (mở vòng mới).
		if ( empty( $prev_hand ) ) {
			return array(
				'allowed' => true,
				'isChop'  => false,
			);
		}

		$is_prev_single_pig = ( self::TYPE_SINGLE === $prev_hand['type'] && 12 === (int) $prev_hand['highCard']['rankValue'] );
		$is_prev_pair_pig   = ( self::TYPE_PAIR === $prev_hand['type'] && 12 === (int) $prev_hand['highCard']['rankValue'] );

		// 1. Luật chặt đặc biệt bằng 3 Đôi Thông.
		if ( self::TYPE_THREE_PAIRS === $next_hand['type'] ) {
			if ( $is_prev_single_pig ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '🔥 3 Đôi thông chặt Heo!',
				);
			}
			if ( self::TYPE_THREE_PAIRS === $prev_hand['type'] && (int) $next_hand['highCard']['power'] > (int) $prev_hand['highCard']['power'] ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '🔥 Đè 3 Đôi thông lớn hơn!',
				);
			}
			return array(
				'allowed' => false,
				'isChop'  => false,
				'reason'  => '3 đôi thông chỉ chặt được 1 Heo hoặc 3 đôi thông nhỏ hơn',
			);
		}

		// 2. Luật chặt đặc biệt bằng Tứ Quý.
		if ( self::TYPE_FOUR_OF_A_KIND === $next_hand['type'] ) {
			if ( $is_prev_single_pig ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '💥 Tứ quý chặt Heo!',
				);
			}
			if ( $is_prev_pair_pig ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '💥 Tứ quý chặt Đôi Heo!',
				);
			}
			if ( self::TYPE_THREE_PAIRS === $prev_hand['type'] ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '💥 Tứ quý chặt 3 Đôi thông!',
				);
			}
			if ( self::TYPE_FOUR_OF_A_KIND === $prev_hand['type'] && (int) $next_hand['highCard']['power'] > (int) $prev_hand['highCard']['power'] ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '💥 Đè Tứ quý lớn hơn!',
				);
			}
			return array(
				'allowed' => false,
				'isChop'  => false,
				'reason'  => 'Tứ quý chỉ chặt được 1 Heo, Đôi Heo, 3 đôi thông hoặc Tứ quý nhỏ hơn',
			);
		}

		// 3. Luật chặt đặc biệt bằng 4 Đôi Thông.
		if ( self::TYPE_FOUR_PAIRS === $next_hand['type'] ) {
			if (
				$is_prev_single_pig ||
				$is_prev_pair_pig ||
				self::TYPE_THREE_PAIRS === $prev_hand['type'] ||
				self::TYPE_FOUR_OF_A_KIND === $prev_hand['type']
			) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '⚡ 4 Đôi thông chặt Hàng / Heo!',
				);
			}
			if ( self::TYPE_FOUR_PAIRS === $prev_hand['type'] && (int) $next_hand['highCard']['power'] > (int) $prev_hand['highCard']['power'] ) {
				return array(
					'allowed'  => true,
					'isChop'   => true,
					'chopNote' => '⚡ Đè 4 Đôi thông lớn hơn!',
				);
			}
			return array(
				'allowed' => false,
				'isChop'  => false,
				'reason'  => '4 đôi thông chỉ chặt được Heo, Đôi Heo, 3 đôi thông, Tứ quý hoặc 4 đôi thông nhỏ hơn',
			);
		}

		// 4. Đè bài thông thường: phải cùng loại và cùng số lượng lá.
		if ( $next_hand['type'] !== $prev_hand['type'] || (int) $next_hand['length'] !== (int) $prev_hand['length'] ) {
			return array(
				'allowed' => false,
				'isChop'  => false,
				'reason'  => 'Phải đánh bộ bài cùng loại và cùng số lượng lá',
			);
		}

		if ( (int) $next_hand['highCard']['power'] > (int) $prev_hand['highCard']['power'] ) {
			return array(
				'allowed' => true,
				'isChop'  => false,
			);
		}

		return array(
			'allowed' => false,
			'isChop'  => false,
			'reason'  => 'Bộ bài đánh ra phải lớn hơn bài trên bàn',
		);
	}
}
