import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/game/roomManager.js';
import { makeCard } from '../src/game/deck.js';

describe('RoomManager — Lobby, Room Joining, Cách 1 Ready & Gameplay', () => {
  let manager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  it('creates a room with a 4-digit code and lists it in the live lobby', () => {
    const res = manager.createRoom({
      playerToken: 'tok-host',
      nickname: 'Minh Host',
      socketId: 'sock-1',
      roomName: 'Bàn Phòng IT',
    });

    assert.equal(res.ok, true);
    assert.match(res.roomId, /^\d{4}$/);

    const lobby = manager.getLobbyRooms();
    assert.equal(lobby.length, 1);
    assert.equal(lobby[0].roomId, res.roomId);
    assert.equal(lobby[0].roomName, 'Bàn Phòng IT');
    assert.equal(lobby[0].playerCount, 1);
    assert.equal(lobby[0].maxPlayers, 4);
    assert.equal(lobby[0].hostNickname, 'Minh Host');
  });

  it('triggers ROOM_FULL_4 alert when the 4th player joins', () => {
    const { roomId } = manager.createRoom({
      playerToken: 'p1',
      nickname: 'P1',
      socketId: 's1',
    });

    const j2 = manager.joinRoom({ roomId, playerToken: 'p2', nickname: 'P2', socketId: 's2' });
    assert.equal(j2.ok, true);
    assert.equal(j2.joinAlertType, 'PLAYER_JOINED');

    const j3 = manager.joinRoom({ roomId, playerToken: 'p3', nickname: 'P3', socketId: 's3' });
    assert.equal(j3.ok, true);
    assert.equal(j3.joinAlertType, 'PLAYER_JOINED');

    const j4 = manager.joinRoom({ roomId, playerToken: 'p4', nickname: 'P4', socketId: 's4' });
    assert.equal(j4.ok, true);
    assert.equal(j4.joinAlertType, 'ROOM_FULL_4');
  });

  it('enforces Cách 1 Ready & Start rules for 2-3 players vs 4 players', () => {
    const { roomId } = manager.createRoom({
      playerToken: 'p1',
      nickname: 'Host',
      socketId: 's1',
    });
    manager.joinRoom({ roomId, playerToken: 'p2', nickname: 'Guest2', socketId: 's2' });

    // Only p1 is ready -> Host cannot start yet
    const r1 = manager.setPlayerReady({ roomId, playerToken: 'p1', ready: true });
    assert.equal(r1.ok, true);
    assert.equal(r1.canHostStart, false);
    assert.equal(r1.autoStartCountdown, false);
    assert.equal(manager.canHostStartGame(roomId, 'p1').allowed, false);

    // Both p1 and p2 are ready (2/2 ready, < 4 players) -> Host can start manually, no auto countdown
    const r2 = manager.setPlayerReady({ roomId, playerToken: 'p2', ready: true });
    assert.equal(r2.ok, true);
    assert.equal(r2.canHostStart, true);
    assert.equal(r2.autoStartCountdown, false);
    assert.equal(manager.canHostStartGame(roomId, 'p1').allowed, true);
    // Non-host cannot trigger manual start
    assert.equal(manager.canHostStartGame(roomId, 'p2').allowed, false);

    // Now p3 and p4 join -> 2 unready players exist, so Host can no longer start until all 4 are ready
    manager.joinRoom({ roomId, playerToken: 'p3', nickname: 'Guest3', socketId: 's3' });
    assert.equal(manager.canHostStartGame(roomId, 'p1').allowed, false);

    manager.joinRoom({ roomId, playerToken: 'p4', nickname: 'Guest4', socketId: 's4' });
    const r3 = manager.setPlayerReady({ roomId, playerToken: 'p3', ready: true });
    assert.equal(r3.autoStartCountdown, false);

    // When 4th player clicks Ready -> 4/4 ready -> autoStartCountdown = true!
    const r4 = manager.setPlayerReady({ roomId, playerToken: 'p4', ready: true });
    assert.equal(r4.ok, true);
    assert.equal(r4.autoStartCountdown, true);
    assert.equal(r4.canHostStart, true);
  });

  it('hides opponent cards in getRoomStateForPlayer and supports F5 reconnect via playerToken', () => {
    const { roomId } = manager.createRoom({
      playerToken: 'p1',
      nickname: 'Host',
      socketId: 's1',
    });
    manager.joinRoom({ roomId, playerToken: 'p2', nickname: 'Guest2', socketId: 's2' });
    manager.setPlayerReady({ roomId, playerToken: 'p1', ready: true });
    manager.setPlayerReady({ roomId, playerToken: 'p2', ready: true });

    const startRes = manager.startGame(roomId);
    assert.equal(startRes.ok, true);

    const p1State = manager.getRoomStateForPlayer(roomId, 'p1');
    assert.equal(p1State.myHand.length, 13);

    const opponentInP1State = p1State.players.find((p) => p.playerToken !== 'p1');
    assert.equal(opponentInP1State.cardCount, 13);
    assert.equal(opponentInP1State.hand, undefined);

    // Simulate disconnect and F5 reconnect for p2
    manager.handleDisconnect('s2');
    const afterDisc = manager.getRoomStateForPlayer(roomId, 'p1');
    assert.equal(afterDisc.players.find((p) => p.nickname === 'Guest2').online, false);

    const recon = manager.joinRoom({
      roomId,
      playerToken: 'p2',
      nickname: 'Guest2',
      socketId: 's2-new',
    });
    assert.equal(recon.ok, true);
    assert.equal(recon.reconnected, true);

    const p2State = manager.getRoomStateForPlayer(roomId, 'p2');
    assert.equal(p2State.myHand.length, 13);
    assert.equal(p2State.players.find((p) => p.nickname === 'Guest2').online, true);
  });

  it('plays a complete 2-player game enforcing first-turn lowest card, turn passing, and ranking', () => {
    const { roomId } = manager.createRoom({
      playerToken: 'p1',
      nickname: 'Alice',
      socketId: 's1',
    });
    manager.joinRoom({ roomId, playerToken: 'p2', nickname: 'Bob', socketId: 's2' });
    manager.setPlayerReady({ roomId, playerToken: 'p1', ready: true });
    manager.setPlayerReady({ roomId, playerToken: 'p2', ready: true });

    // Custom deterministic deck where p1 gets 3S.. and p2 gets higher cards
    const customHands = [
      [makeCard('3S'), makeCard('6S')],
      [makeCard('4S'), makeCard('7S')],
    ];
    manager.startGameWithCustomHands(roomId, customHands, '3S', 0);

    // First turn must include lowest card (3S)
    const badFirstPlay = manager.playCards({ roomId, playerToken: 'p1', cardIds: ['6S'] });
    assert.equal(badFirstPlay.ok, false);

    const goodFirstPlay = manager.playCards({ roomId, playerToken: 'p1', cardIds: ['3S'] });
    assert.equal(goodFirstPlay.ok, true);

    // Bob plays 4S over 3S
    const bobPlay = manager.playCards({ roomId, playerToken: 'p2', cardIds: ['4S'] });
    assert.equal(bobPlay.ok, true);

    // Alice beats 4S with 6S and finishes all her cards (1st place!)
    const aliceWin = manager.playCards({ roomId, playerToken: 'p1', cardIds: ['6S'] });
    assert.equal(aliceWin.ok, true);
    assert.equal(aliceWin.gameEnded, true);

    const finalState = manager.getRoomStateForPlayer(roomId, 'p1');
    assert.equal(finalState.status, 'WAITING');
    assert.equal(finalState.rankings.length, 2);
    assert.equal(finalState.rankings[0].nickname, 'Alice');
    assert.equal(finalState.rankings[0].rankTitle, 'Nhất');
    assert.equal(finalState.rankings[1].nickname, 'Bob');
    assert.equal(finalState.rankings[1].rankTitle, 'Bét');
  });
});
