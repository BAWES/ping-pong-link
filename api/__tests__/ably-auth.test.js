import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockReq, mockRes } from './helpers.js';

// Mock the ably module
vi.mock('ably', () => {
  const createTokenRequest = vi.fn().mockResolvedValue({
    keyName: 'test-key',
    clientId: 'test-client',
    timestamp: Date.now(),
    nonce: 'abc123',
    mac: 'def456',
    capability: '{}',
  });

  // Use class syntax so `new` works
  const MockRest = vi.fn(function (key) {
    this.key = key;
    this.auth = { createTokenRequest };
  });

  return {
    default: { Rest: MockRest },
    __mocks: { MockRest, createTokenRequest },
  };
});

import * as AblyModule from 'ably';
const { MockRest, createTokenRequest } = AblyModule.__mocks;

describe('api/ably-auth.js', () => {
  let handler;

  beforeEach(async () => {
    vi.stubEnv('ABLY_API_KEY', 'test-key');
    const mod = await import('../ably-auth.js');
    handler = mod.default;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('handles OPTIONS preflight', async () => {
    const req = mockReq({ method: 'OPTIONS' });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('returns 500 when ABLY_API_KEY is not configured', async () => {
    vi.stubEnv('ABLY_API_KEY', '');
    const mod = await import('../ably-auth.js?update=' + Date.now());
    const h = mod.default;
    const req = mockReq({ query: {} });
    const res = mockRes();
    await h(req, res);
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'ABLY_API_KEY not configured' });
  });

  it('mints a token request for the given clientId', async () => {
    const req = mockReq({ query: { clientId: 'player-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body.keyName).toBe('test-key');
    expect(res._body.clientId).toBe('test-client');
    expect(MockRest).toHaveBeenCalledWith('test-key');
    expect(createTokenRequest).toHaveBeenCalledWith({ clientId: 'player-1' });
  });

  it('defaults clientId to "anon" when not provided', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(createTokenRequest).toHaveBeenCalledWith({ clientId: 'anon' });
  });

  it('truncates clientId to 64 characters', async () => {
    const longId = 'x'.repeat(100);
    const req = mockReq({ query: { clientId: longId } });
    const res = mockRes();
    await handler(req, res);

    expect(createTokenRequest).toHaveBeenCalledWith({ clientId: 'x'.repeat(64) });
  });

  it('returns 500 when createTokenRequest fails', async () => {
    createTokenRequest.mockRejectedValueOnce(new Error('Auth service down'));
    const req = mockReq({ query: { clientId: 'player-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBe('Auth service down');
  });
});
