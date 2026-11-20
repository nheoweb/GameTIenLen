import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { createGameServer } from '../src/server.js';

function connectClient(port) {
  return new Promise((resolve) => {
    const client = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    client.on('connect', () => resolve(client));
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}

describe('Real-time Server & Socket.IO Flow (src/server.js)', () => {
  let gameServer;
  let port;
  let clients = [];

  beforeEach(async () => {
    gameServer = createGameServer({ countdownSeconds: 1, tickIntervalMs: 120 });
    await new Promise((resolve) => {
      gameServer.httpServer.listen(0, () => {
        port = gameServer.httpServer.address().port;
        resolve();
      });
    });
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) {
      if (c.connected) c.disconnect();
    }
    await gameServer.close();
  });

  it('serves frontend static files (index.html, style.css, app.js, audio.js) and /api/network-info', async () => {
    const indexRes = await fetch(`http://localhost:${port}/`);
    assert.equal(indexRes.status, 200);
    const html = await indexRes.text();
    assert.ok(html.includes('Tiến Lên Miền Nam'));

    const audioRes = await fetch(`http://localhost:${port}/js/audio.js`);
    assert.equal(audioRes.status, 200);

    const netRes = await fetch(`http://localhost:${port}/api/network-info`);
    assert.equal(netRes.status, 200);
    const netJson = await netRes.json();
    assert.equal(netJson.port, port);
  });

  it('broadcasts ROOM_FULL_4 alert when 4th player joins and auto-starts countdown when all 4 click Ready', async () => {
    const c1 = await connectClient(port);
    const c2 = await connectClient(port);
    const c3 = await connectClient(port);
    const c4 = await connectClient(port);
    clients.push(c1, c2, c3, c4);

    const alertsOnC1 = [];
    c1.on('room:alert', (alert) => alertsOnC1.push(alert));

    const createRes = await emitAck(c1, 'room:create', {
      playerToken: 't1',
      nickname: 'Host1',
      roomName: 'Bàn Test 4 Người',
    });
    assert.equal(createRes.ok, true);
    const roomId = createRes.roomId;

    await emitAck(c2, 'room:join', { roomId, playerToken: 't2', nickname: 'P2' });
    await emitAck(c3, 'room:join', { roomId, playerToken: 't3', nickname: 'P3' });
    await emitAck(c4, 'room:join', { roomId, playerToken: 't4', nickname: 'P4' });

    // Verify ROOM_FULL_4 alert was emitted to players in the room
    assert.ok(
      alertsOnC1.some((a) => a.type === 'ROOM_FULL_4'),
      'Expected ROOM_FULL_4 audio alert when 4th player joined'
    );

    // Wait for game start alert after all 4 click Ready
    const gameStartedPromise = new Promise((resolve) => {
      c1.on('room:alert', (alert) => {
        if (alert.type === 'GAME_STARTED') resolve(alert);
      });
    });

    await emitAck(c1, 'room:ready', { roomId, playerToken: 't1', ready: true });
    await emitAck(c2, 'room:ready', { roomId, playerToken: 't2', ready: true });
    await emitAck(c3, 'room:ready', { roomId, playerToken: 't3', ready: true });
    await emitAck(c4, 'room:ready', { roomId, playerToken: 't4', ready: true });

    const startAlert = await gameStartedPromise;
    assert.equal(startAlert.type, 'GAME_STARTED');
  });

  it('allows Host to manually start a 2-player game once both players are Ready (Cách 1)', async () => {
    const c1 = await connectClient(port);
    const c2 = await connectClient(port);
    clients.push(c1, c2);

    const { roomId } = await emitAck(c1, 'room:create', {
      playerToken: 'h1',
      nickname: 'Host',
    });
    await emitAck(c2, 'room:join', { roomId, playerToken: 'g2', nickname: 'Guest' });

    // Host tries starting before Ready -> rejected
    const earlyStart = await emitAck(c1, 'room:start', { roomId, playerToken: 'h1' });
    assert.equal(earlyStart.ok, false);

    await emitAck(c1, 'room:ready', { roomId, playerToken: 'h1', ready: true });
    await emitAck(c2, 'room:ready', { roomId, playerToken: 'g2', ready: true });

    const gameStartedPromise = new Promise((resolve) => {
      c2.on('room:alert', (alert) => {
        if (alert.type === 'GAME_STARTED') resolve(alert);
      });
    });

    const hostStart = await emitAck(c1, 'room:start', { roomId, playerToken: 'h1' });
    assert.equal(hostStart.ok, true);

    const alert = await gameStartedPromise;
    assert.equal(alert.type, 'GAME_STARTED');
  });

  it('broadcasts NUDGE sound alert mentioning unready players when someone clicks Gõ bàn', async () => {
    const c1 = await connectClient(port);
    const c2 = await connectClient(port);
    clients.push(c1, c2);

    const { roomId } = await emitAck(c1, 'room:create', {
      playerToken: 'h1',
      nickname: 'Minh',
    });
    await emitAck(c2, 'room:join', { roomId, playerToken: 'g2', nickname: 'Tuấn' });
    await emitAck(c1, 'room:ready', { roomId, playerToken: 'h1', ready: true });

    const nudgePromise = new Promise((resolve) => {
      c2.on('room:alert', (alert) => {
        if (alert.type === 'NUDGE') resolve(alert);
      });
    });

    const res = await emitAck(c1, 'room:nudge', { roomId, playerToken: 'h1' });
    assert.equal(res.ok, true);

    const nudgeAlert = await nudgePromise;
    assert.equal(nudgeAlert.type, 'NUDGE');
    assert.ok(nudgeAlert.message.includes('Tuấn'));
  });
});
