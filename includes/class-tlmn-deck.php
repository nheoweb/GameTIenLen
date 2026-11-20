<?php
/**
 * Bộ bài 52 lá và cơ chế xáo / chia bài Tiến Lên Miền Nam.
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TLMN_Deck {

	/** @var string[] */
	const RANKS = array( '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2' );

	/** @var array<int, array<string, mixed>> */
	const SUITS = array(
		array(
			'code'      => 'S',
			'symbol'    => '♠',
			'name'      => 'Bích',
			'color'     => 'black',
			'suitValue' => 0,
		),
		array(
			'code'      => 'C',
			'symbol'    => '♣',
			'name'      => 'Chuồn',
			'color'     => 'black',
			'suitValue' => 1,
		),
		array(
			'code'      => 'D',
			'symbol'    => '♦',
			'name'      => 'Rô',
			'color'     => 'red',
			'suitValue' => 2,
		),
		array(
			'code'      => 'H',
			'symbol'    => '♥',
			'name'      => 'Cơ',
			'color'     => 'red',
			'suitValue' => 3,
		),
	);

	/** @var array<string, array<string, mixed>>|null */
	private static $card_map = null;

	/**
	 * Khởi tạo bảng tra cứu 52 lá bài.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private static function get_card_map() {
		if ( null !== self::$card_map ) {
			return self::$card_map;
		}

		$map = array();
		foreach ( self::RANKS as $r => $rank ) {
			foreach ( self::SUITS as $suit ) {
				$id         = $rank . $suit['code'];
				$map[ $id ] = array(
					'id'         => $id,
					'rank'       => $rank,
					'rankValue'  => $r,
					'suit'       => $suit['code'],
					'suitSymbol' => $suit['symbol'],
					'suitName'   => $suit['name'],
					'color'      => $suit['color'],
					'suitValue'  => $suit['suitValue'],
					'power'      => $r * 4 + $suit['suitValue'],
					'label'      => $rank . $suit['symbol'],
				);
			}
		}

		self::$card_map = $map;
		return self::$card_map;
	}

	/**
	 * Tạo 1 lá bài từ mã (VD: '3S', '2H').
	 *
	 * @param string $id Mã lá bài.
	 * @return array<string, mixed>|null
	 */
	public static function make_card( $id ) {
		$map = self::get_card_map();
		$key = strtoupper( trim( (string) $id ) );
		return isset( $map[ $key ] ) ? $map[ $key ] : null;
	}

	/**
	 * Tạo bộ bài chuẩn 52 lá.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public static function create_deck() {
		return array_values( self::get_card_map() );
	}

	/**
	 * Xáo bộ bài bằng thuật toán Fisher-Yates (dùng random_int bảo mật).
	 *
	 * @param array<int, array<string, mixed>>|null $deck Bộ bài đầu vào.
	 * @return array<int, array<string, mixed>>
	 */
	public static function shuffle_deck( $deck = null ) {
		$copy = is_array( $deck ) ? array_values( $deck ) : self::create_deck();
		$n    = count( $copy );
		for ( $i = $n - 1; $i > 0; $i-- ) {
			$j          = random_int( 0, $i );
			$tmp        = $copy[ $i ];
			$copy[ $i ] = $copy[ $j ];
			$copy[ $j ] = $tmp;
		}
		return $copy;
	}

	/**
	 * Sắp xếp mảng lá bài tăng dần theo sức mạnh (power).
	 *
	 * @param array<int, array<string, mixed>> $cards Danh sách lá bài.
	 * @return array<int, array<string, mixed>>
	 */
	public static function sort_cards( array $cards ) {
		$copy = array_values( $cards );
		usort(
			$copy,
			function ( $a, $b ) {
				return (int) $a['power'] - (int) $b['power'];
			}
		);
		return $copy;
	}

	/**
	 * Chia 13 lá bài cho 2–4 người chơi và tìm người giữ lá nhỏ nhất.
	 *
	 * @param int                                   $player_count Số người chơi (2..4).
	 * @param array<int, array<string, mixed>>|null $custom_deck  Bộ bài tùy chỉnh (nếu có).
	 * @return array<string, mixed>
	 */
	public static function deal_hands( $player_count, $custom_deck = null ) {
		$player_count = (int) $player_count;
		if ( $player_count < 2 || $player_count > 4 ) {
			return array(
				'ok'    => false,
				'error' => 'Số người chơi phải từ 2 đến 4',
			);
		}

		$deck  = is_array( $custom_deck ) ? array_values( $custom_deck ) : self::shuffle_deck();
		$hands = array_fill( 0, $player_count, array() );

		for ( $i = 0; $i < 13; $i++ ) {
			for ( $p = 0; $p < $player_count; $p++ ) {
				$hands[ $p ][] = $deck[ $i * $player_count + $p ];
			}
		}

		$sorted_hands = array();
		foreach ( $hands as $hand ) {
			$sorted_hands[] = self::sort_cards( $hand );
		}

		$lowest_card         = null;
		$lowest_holder_index = 0;
		foreach ( $sorted_hands as $idx => $hand ) {
			if ( ! empty( $hand ) ) {
				if ( null === $lowest_card || (int) $hand[0]['power'] < (int) $lowest_card['power'] ) {
					$lowest_card         = $hand[0];
					$lowest_holder_index = $idx;
				}
			}
		}

		return array(
			'ok'                => true,
			'hands'             => $sorted_hands,
			'lowestCard'        => $lowest_card,
			'lowestHolderIndex' => $lowest_holder_index,
		);
	}
}
