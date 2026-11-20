import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, dealHands, makeCard } from '../src/game/deck.js';
import { classifyHand, canBeat, HAND_TYPES } from '../src/game/rules.js';

describe('Deck & Dealing (src/game/deck.js)', () => {
  it('creates a standard 52-card deck with correct power ordering from 3♠ (0) to 2♥ (51)', () => {
    const deck = createDeck();
    assert.equal(deck.length, 52);

    const threeSpade = deck.find((c) => c.id === '3S');
    const twoHeart = deck.find((c) => c.id === '2H');
    assert.equal(threeSpade.power, 0);
    assert.equal(twoHeart.power, 51);
  });

  it('deals 13 sorted cards to each player (2 to 4 players)', () => {
    const { hands } = dealHands(4);
    assert.equal(hands.length, 4);
    for (const hand of hands) {
      assert.equal(hand.length, 13);
      for (let i = 1; i < hand.length; i++) {
        assert.ok(hand[i].power > hand[i - 1].power, 'Hand should be sorted ascending by power');
      }
    }
  });
});

describe('Tiến Lên Miền Nam Hand Classification (src/game/rules.js)', () => {
  it('classifies SINGLE, PAIR, and TRIPLE correctly', () => {
    const single = classifyHand([makeCard('5S')]);
    assert.equal(single.valid, true);
    assert.equal(single.type, HAND_TYPES.SINGLE);
    assert.equal(single.highCard.id, '5S');

    const pair = classifyHand([makeCard('8S'), makeCard('8H')]);
    assert.equal(pair.valid, true);
    assert.equal(pair.type, HAND_TYPES.PAIR);
    assert.equal(pair.highCard.id, '8H');

    const triple = classifyHand([makeCard('KC'), makeCard('KD'), makeCard('KS')]);
    assert.equal(triple.valid, true);
    assert.equal(triple.type, HAND_TYPES.TRIPLE);
    assert.equal(triple.highCard.id, 'KD');
  });

  it('classifies STRAIGHT of length >= 3 and rejects straights containing 2 (Heo)', () => {
    const straight3 = classifyHand([makeCard('3S'), makeCard('4H'), makeCard('5C')]);
    assert.equal(straight3.valid, true);
    assert.equal(straight3.type, HAND_TYPES.STRAIGHT);
    assert.equal(straight3.length, 3);
    assert.equal(straight3.highCard.id, '5C');

    const straightWithAce = classifyHand([makeCard('QD'), makeCard('KS'), makeCard('AH')]);
    assert.equal(straightWithAce.valid, true);
    assert.equal(straightWithAce.type, HAND_TYPES.STRAIGHT);

    const invalidStraightWith2 = classifyHand([makeCard('KS'), makeCard('AH'), makeCard('2C')]);
    assert.equal(invalidStraightWith2.valid, false);
  });

  it('classifies THREE_PAIRS (3 đôi thông), FOUR_OF_A_KIND (Tứ quý), and FOUR_PAIRS (4 đôi thông)', () => {
    const threePairs = classifyHand([
      makeCard('7S'), makeCard('7C'),
      makeCard('8D'), makeCard('8H'),
      makeCard('9S'), makeCard('9D'),
    ]);
    assert.equal(threePairs.valid, true);
    assert.equal(threePairs.type, HAND_TYPES.THREE_PAIRS);
    assert.equal(threePairs.highCard.id, '9D');

    const fourOfAKind = classifyHand([
      makeCard('10S'), makeCard('10C'), makeCard('10D'), makeCard('10H'),
    ]);
    assert.equal(fourOfAKind.valid, true);
    assert.equal(fourOfAKind.type, HAND_TYPES.FOUR_OF_A_KIND);

    const fourPairs = classifyHand([
      makeCard('JS'), makeCard('JC'),
      makeCard('QD'), makeCard('QH'),
      makeCard('KS'), makeCard('KD'),
      makeCard('AC'), makeCard('AH'),
    ]);
    assert.equal(fourPairs.valid, true);
    assert.equal(fourPairs.type, HAND_TYPES.FOUR_PAIRS);
    assert.equal(fourPairs.highCard.id, 'AH');

    // Consecutive pairs cannot include pair of 2s
    const invalidPairsWith2 = classifyHand([
      makeCard('KS'), makeCard('KC'),
      makeCard('AD'), makeCard('AH'),
      makeCard('2S'), makeCard('2D'),
    ]);
    assert.equal(invalidPairsWith2.valid, false);
  });
});

describe('Comparing & Chopping Rules (canBeat)', () => {
  it('allows same-type higher power hands and rejects different length straights', () => {
    const s1 = classifyHand([makeCard('5S')]);
    const s2 = classifyHand([makeCard('5C')]);
    assert.equal(canBeat(s1, s2).allowed, true);
    assert.equal(canBeat(s2, s1).allowed, false);

    const str3 = classifyHand([makeCard('3S'), makeCard('4C'), makeCard('5D')]);
    const str3Higher = classifyHand([makeCard('3H'), makeCard('4D'), makeCard('5H')]);
    const str4 = classifyHand([makeCard('3S'), makeCard('4C'), makeCard('5D'), makeCard('6H')]);

    assert.equal(canBeat(str3, str3Higher).allowed, true);
    assert.equal(canBeat(str3, str4).allowed, false);
  });

  it('enforces Pig & Special Chopping (Chặt Heo / Đôi Heo / Hàng)', () => {
    const singlePig = classifyHand([makeCard('2H')]);
    const pairPig = classifyHand([makeCard('2S'), makeCard('2C')]);
    const normalSingle = classifyHand([makeCard('AH')]);

    const threePairs = classifyHand([
      makeCard('3S'), makeCard('3C'),
      makeCard('4D'), makeCard('4H'),
      makeCard('5S'), makeCard('5D'),
    ]);

    const fourOfAKind = classifyHand([
      makeCard('6S'), makeCard('6C'), makeCard('6D'), makeCard('6H'),
    ]);

    const fourPairs = classifyHand([
      makeCard('7S'), makeCard('7C'),
      makeCard('8D'), makeCard('8H'),
      makeCard('9S'), makeCard('9D'),
      makeCard('10C'), makeCard('10H'),
    ]);

    // 3 đôi thông chặt 1 Heo nhưng không chặt được lá thường hay Đôi Heo
    assert.equal(canBeat(singlePig, threePairs).allowed, true);
    assert.equal(canBeat(singlePig, threePairs).isChop, true);
    assert.equal(canBeat(normalSingle, threePairs).allowed, false);
    assert.equal(canBeat(pairPig, threePairs).allowed, false);

    // Tứ quý chặt 1 Heo, Đôi Heo, và 3 đôi thông
    assert.equal(canBeat(singlePig, fourOfAKind).allowed, true);
    assert.equal(canBeat(pairPig, fourOfAKind).allowed, true);
    assert.equal(canBeat(threePairs, fourOfAKind).allowed, true);

    // 4 đôi thông chặt 1 Heo, Đôi Heo, 3 đôi thông, và Tứ quý
    assert.equal(canBeat(singlePig, fourPairs).allowed, true);
    assert.equal(canBeat(pairPig, fourPairs).allowed, true);
    assert.equal(canBeat(threePairs, fourPairs).allowed, true);
    assert.equal(canBeat(fourOfAKind, fourPairs).allowed, true);
  });
});
