export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

export const SUITS = [
  { code: 'S', symbol: '♠', name: 'Bích', color: 'black', suitValue: 0 },
  { code: 'C', symbol: '♣', name: 'Chuồn', color: 'black', suitValue: 1 },
  { code: 'D', symbol: '♦', name: 'Rô', color: 'red', suitValue: 2 },
  { code: 'H', symbol: '♥', name: 'Cơ', color: 'red', suitValue: 3 },
];

const CARD_MAP = new Map();

for (let r = 0; r < RANKS.length; r++) {
  const rank = RANKS[r];
  for (let s = 0; s < SUITS.length; s++) {
    const suit = SUITS[s];
    const id = `${rank}${suit.code}`;
    const card = Object.freeze({
      id,
      rank,
      rankValue: r,
      suit: suit.code,
      suitSymbol: suit.symbol,
      suitName: suit.name,
      color: suit.color,
      suitValue: suit.suitValue,
      power: r * 4 + suit.suitValue,
      label: `${rank}${suit.symbol}`,
    });
    CARD_MAP.set(id, card);
  }
}

export function makeCard(id) {
  const card = CARD_MAP.get(String(id).toUpperCase());
  if (!card) {
    throw new Error(`Invalid card id: ${id}`);
  }
  return { ...card };
}

export function createDeck() {
  return Array.from(CARD_MAP.values(), (c) => ({ ...c }));
}

export function shuffleDeck(deck = createDeck()) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortCards(cards) {
  return [...cards].sort((a, b) => a.power - b.power);
}

export function dealHands(playerCount, customDeck = null) {
  if (playerCount < 2 || playerCount > 4) {
    throw new Error('Số người chơi phải từ 2 đến 4');
  }
  const deck = customDeck ? [...customDeck] : shuffleDeck();
  const hands = Array.from({ length: playerCount }, () => []);

  for (let i = 0; i < 13; i++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p].push(deck[i * playerCount + p]);
    }
  }

  const sortedHands = hands.map((h) => sortCards(h));

  // Tìm người giữ lá bài nhỏ nhất trên bàn (dùng cho ván đầu tiên)
  let lowestCard = null;
  let lowestHolderIndex = 0;
  sortedHands.forEach((hand, idx) => {
    if (hand.length > 0) {
      if (!lowestCard || hand[0].power < lowestCard.power) {
        lowestCard = hand[0];
        lowestHolderIndex = idx;
      }
    }
  });

  return {
    hands: sortedHands,
    lowestCard,
    lowestHolderIndex,
  };
}
