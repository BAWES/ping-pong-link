import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReq, mockRes } from './helpers.js';

// Mock the ably module before importing the handler
vi.mock('ably', () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const MockChannel = vi.fn(() => ({ publish }));
  const MockChannels = { get: vi.fn(() => new MockChannel()) };
  const MockRest = vi.fn(() => ({ channels: MockChannels }));

  return {
    default: { Rest: MockRest },
    __mocks: { MockRest, MockChannels, MockChannel, publish },
  };
});

import AblyMock from 'ably';
const { MockRest, MockChannels, publish } = AblyMock.__mocks;

describe('api/publish.js', () => {
  let handler;

  beforeEach(async () => {
    vi.stubEnv('ABLY_API_KEY', 'test-key');
    // Re-import to get fresh handler with stubbed env
    const mod = await import('../publish.js');
    handler = mod.default;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 405 for non-POST methods', async () => {
    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body).toEqual({ error: 'POST only' });
  });

  it('handles OPTIONS preflight', async () => {
    const req = mockReq({ method: 'OPTIONS' });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('returns 500 when ABLY_API_KEY is missing', async () => {
    vi.stubEnv('ABLY_API_KEY', '');
    const mod = await import('../publish.js?update=' + Date.now());
    const h = mod.default;
    const req = mockReq();
    const res = mockRes();
    await h(req, res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'ABLY_API_KEY not configured' });
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = mockReq({ body: 'not-json' });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 400 when required fields are missing', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Missing required fields' });
  });

  it('returns 400 when action is not ping or pong', async () => {
    const req = mockReq({
      body: { roomCode: 'R1', action: 'invalid', seat: 0, name: 'A', emoji: 'X' },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toEqual({ error: 'Action must be ping or pong' });
  });

  it('returns 409 when turn order is violated', async () => {
    const req = mockReq({
      body: {
        roomCode: 'R1', action: 'pong', seat: 0, name: 'A', emoji: 'X',
        expectedNext: 'ping',
      },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(409);
    expect(res._body.error).toContain('Expected ping, got pong');
  });

  it('publishes a valid move and returns 200', async () => {
    const body = {
      roomCode: 'R1', action: 'ping', seat: 0, name: 'Alice', emoji: '🏓',
      text: 'hello', expectedNext: 'ping',
    };
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.event.action).toBe('ping');
    expect(res._body.event.name).toBe('Alice');

    // Verify Ably was called correctly
    expect(MockRest).toHaveBeenCalledWith('test-key');
    expect(MockChannels.get).toHaveBeenCalledWith('pingpong:R1');
    expect(publish).toHaveBeenCalledWith('move', expect.objectContaining({
      type: 'move',
      action: 'ping',
      seat: 0,
      name: 'Alice',
    }));
  });

  it('accepts stringified JSON body', async () => {
    const body = JSON.stringify({
      roomCode: 'R2', action: 'pong', seat: 1, name: 'Bob', emoji: '🎾',
      expectedNext: 'pong',
    });
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('sanitizes name to 32 chars, emoji to 2 chars, text to 1000 chars', async () => {
    const body = {
      roomCode: 'R1', action: 'ping', seat: 0,
      name: 'A'.repeat(100),
      emoji: '🏓'.repeat(10),
      text: 'B'.repeat(2000),
      expectedNext: 'ping',
    };
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.event.name.length).toBe(32);
    expect(res._body.event.emoji.length).toBe(2);
    expect(res._body.event.text.length).toBe(1000);
  });

  it('returns 500 when Ably publish fails', async () => {
    publish.mockRejectedValueOnce(new Error('Ably error'));
    const body = {
      roomCode: 'R1', action: 'ping', seat: 0, name: 'A', emoji: 'X',
      expectedNext: 'ping',
    };
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Ably error');
  });
});
