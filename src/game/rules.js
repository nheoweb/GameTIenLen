import { sortCards } from './deck.js';

export const HAND_TYPES = Object.freeze({
  INVALID: 'INVALID',
  SINGLE: 'SINGLE',
  PAIR: 'PAIR',
  TRIPLE: 'TRIPLE',
  STRAIGHT: 'STRAIGHT',
  THREE_PAIRS: 'THREE_PAIRS',
  FOUR_OF_A_KIND: 'FOUR_OF_A_KIND',
  FOUR_PAIRS: 'FOUR_PAIRS',
});

export const HAND_LABELS = Object.freeze({
  SINGLE: 'Lá lẻ',
  PAIR: 'Đôi',
  TRIPLE: 'Sám cô',
  STRAIGHT: 'Sảnh',
  THREE_PAIRS: '3 Đôi thông',
  FOUR_OF_A_KIND: 'Tứ quý',
  FOUR_PAIRS: '4 Đôi thông',
});

/**
 * Phân loại bộ bài Tiến Lên Miền Nam
 * @param {Array} cards Mảng các đối tượng lá bài
 */
export function classifyHand(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, type: HAND_TYPES.INVALID, reason: 'Chưa chọn bài' };
  }

  // Kiểm tra trùng lá bài
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) {
    return { valid: false, type: HAND_TYPES.INVALID, reason: 'Bài chứa lá trùng lặp' };
  }

  const sorted = sortCards(cards);
  const len = sorted.length;
  const highCard = sorted[len - 1];

  // 1. Lá lẻ (SINGLE)
  if (len === 1) {
    return {
      valid: true,
      type: HAND_TYPES.SINGLE,
      label: `${HAND_LABELS.SINGLE} (${highCard.label})`,
      length: 1,
      highCard,
      cards: sorted,
    };
  }

  // 2. Đôi (PAIR)
  if (len === 2) {
    if (sorted[0].rankValue === sorted[1].rankValue) {
      return {
        valid: true,
        type: HAND_TYPES.PAIR,
        label: `Đôi ${highCard.rank}`,
        length: 2,
        highCard,
        cards: sorted,
      };
    }
    return { valid: false, type: HAND_TYPES.INVALID, reason: '2 lá không cùng số' };
  }

  // 3. Sám cô (TRIPLE)
  if (len === 3 && sorted[0].rankValue === sorted[1].rankValue && sorted[1].rankValue === sorted[2].rankValue) {
    return {
      valid: true,
      type: HAND_TYPES.TRIPLE,
      label: `Sám cô ${highCard.rank}`,
      length: 3,
      highCard,
      cards: sorted,
    };
  }

  // 4. Tứ quý (FOUR_OF_A_KIND)
  if (
    len === 4 &&
    sorted[0].rankValue === sorted[1].rankValue &&
    sorted[1].rankValue === sorted[2].rankValue &&
    sorted[2].rankValue === sorted[3].rankValue
  ) {
    return {
      valid: true,
      type: HAND_TYPES.FOUR_OF_A_KIND,
      label: `Tứ quý ${highCard.rank}`,
      length: 4,
      highCard,
      cards: sorted,
    };
  }

  // 5. Đôi thông (3 đôi thông = 6 lá, 4 đôi thông = 8 lá)
  if ((len === 6 || len === 8) && isConsecutivePairs(sorted)) {
    const pairCount = len / 2;
    const type = pairCount === 3 ? HAND_TYPES.THREE_PAIRS : HAND_TYPES.FOUR_PAIRS;
    return {
      valid: true,
      type,
      label: `${pairCount} Đôi thông (${sorted[0].rank} → ${highCard.rank})`,
      length: len,
      highCard,
      cards: sorted,
    };
  }

  // 6. Sảnh (STRAIGHT: từ 3 lá liên tiếp trở lên, không chứa Heo '2')
  if (len >= 3 && isStraight(sorted)) {
    return {
      valid: true,
      type: HAND_TYPES.STRAIGHT,
      label: `Sảnh ${len} lá (${sorted[0].rank} → ${highCard.label})`,
      length: len,
      highCard,
      cards: sorted,
    };
  }

  return {
    valid: false,
    type: HAND_TYPES.INVALID,
    reason: 'Bộ bài không hợp lệ theo luật Tiến Lên Miền Nam',
  };
}

function isStraight(sorted) {
  // Không cho phép lá 2 (rankValue === 12) nằm trong sảnh
  if (sorted.some((c) => c.rankValue === 12)) {
    return false;
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].rankValue !== sorted[i - 1].rankValue + 1) {
      return false;
    }
  }
  return true;
}

function isConsecutivePairs(sorted) {
  // Không cho phép đôi 2 (rankValue === 12) nằm trong đôi thông
  if (sorted.some((c) => c.rankValue === 12)) {
    return false;
  }
  const pairCount = sorted.length / 2;
  for (let i = 0; i < pairCount; i++) {
    const first = sorted[i * 2];
    const second = sorted[i * 2 + 1];
    if (first.rankValue !== second.rankValue) {
      return false;
    }
    if (i > 0) {
      const prevPairRank = sorted[(i - 1) * 2].rankValue;
      if (first.rankValue !== prevPairRank + 1) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Kiểm tra bộ bài mới (nextHand) có đè/chặt được bộ bài hiện tại trên bàn (prevHand) không.
 * @param {Object|null} prevHand Kết quả từ classifyHand của lượt trước (hoặc null nếu mở vòng mới)
 * @param {Object} nextHand Kết quả từ classifyHand của lượt đang đánh
 */
export function canBeat(prevHand, nextHand) {
  if (!nextHand || !nextHand.valid) {
    return { allowed: false, isChop: false, reason: nextHand?.reason || 'Bộ bài không hợp lệ' };
  }

  // Bàn đang trống (mở vòng mới)
  if (!prevHand) {
    return { allowed: true, isChop: false };
  }

  const isPrevSinglePig = prevHand.type === HAND_TYPES.SINGLE && prevHand.highCard.rankValue === 12;
  const isPrevPairPig = prevHand.type === HAND_TYPES.PAIR && prevHand.highCard.rankValue === 12;

  // 1. Luật chặt đặc biệt bằng 3 Đôi Thông
  if (nextHand.type === HAND_TYPES.THREE_PAIRS) {
    if (isPrevSinglePig) {
      return { allowed: true, isChop: true, chopNote: '🔥 3 Đôi thông chặt Heo!' };
    }
    if (prevHand.type === HAND_TYPES.THREE_PAIRS && nextHand.highCard.power > prevHand.highCard.power) {
      return { allowed: true, isChop: true, chopNote: '🔥 Đè 3 Đôi thông lớn hơn!' };
    }
    return {
      allowed: false,
      isChop: false,
      reason: '3 đôi thông chỉ chặt được 1 Heo hoặc 3 đôi thông nhỏ hơn',
    };
  }

  // 2. Luật chặt đặc biệt bằng Tứ Quý
  if (nextHand.type === HAND_TYPES.FOUR_OF_A_KIND) {
    if (isPrevSinglePig) {
      return { allowed: true, isChop: true, chopNote: '💥 Tứ quý chặt Heo!' };
    }
    if (isPrevPairPig) {
      return { allowed: true, isChop: true, chopNote: '💥 Tứ quý chặt Đôi Heo!' };
    }
    if (prevHand.type === HAND_TYPES.THREE_PAIRS) {
      return { allowed: true, isChop: true, chopNote: '💥 Tứ quý chặt 3 Đôi thông!' };
    }
    if (prevHand.type === HAND_TYPES.FOUR_OF_A_KIND && nextHand.highCard.power > prevHand.highCard.power) {
      return { allowed: true, isChop: true, chopNote: '💥 Đè Tứ quý lớn hơn!' };
    }
    return {
      allowed: false,
      isChop: false,
      reason: 'Tứ quý chỉ chặt được 1 Heo, Đôi Heo, 3 đôi thông hoặc Tứ quý nhỏ hơn',
    };
  }

  // 3. Luật chặt đặc biệt bằng 4 Đôi Thông
  if (nextHand.type === HAND_TYPES.FOUR_PAIRS) {
    if (
      isPrevSinglePig ||
      isPrevPairPig ||
      prevHand.type === HAND_TYPES.THREE_PAIRS ||
      prevHand.type === HAND_TYPES.FOUR_OF_A_KIND
    ) {
      return { allowed: true, isChop: true, chopNote: '⚡ 4 Đôi thông chặt Hàng / Heo!' };
    }
    if (prevHand.type === HAND_TYPES.FOUR_PAIRS && nextHand.highCard.power > prevHand.highCard.power) {
      return { allowed: true, isChop: true, chopNote: '⚡ Đè 4 Đôi thông lớn hơn!' };
    }
    return {
      allowed: false,
      isChop: false,
      reason: '4 đôi thông chỉ chặt được Heo, Đôi Heo, 3 đôi thông, Tứ quý hoặc 4 đôi thông nhỏ hơn',
    };
  }

  // 4. Đè bài thông thường: phải cùng loại và cùng số lượng lá
  if (nextHand.type !== prevHand.type || nextHand.length !== prevHand.length) {
    return {
      allowed: false,
      isChop: false,
      reason: 'Phải đánh bộ bài cùng loại và cùng số lượng lá',
    };
  }

  if (nextHand.highCard.power > prevHand.highCard.power) {
    return { allowed: true, isChop: false };
  }

  return {
    allowed: false,
    isChop: false,
    reason: 'Bộ bài đánh ra phải lớn hơn bài trên bàn',
  };
}
