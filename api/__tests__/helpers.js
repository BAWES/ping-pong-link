// Shared helpers for API route tests.
// Creates lightweight req/res objects that mimic Vercel serverless signatures.

export function mockReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    query: {},
    body: null,
    ...overrides,
  };
}

export function mockRes() {
  const res = {};
  res._status = null;
  res._body = null;
  res._headers = {};

  res.setHeader = (name, value) => {
    res._headers[name] = value;
    return res;
  };

  res.status = (code) => {
    res._status = code;
    return {
      json: (data) => {
        res._body = data;
      },
      end: () => {},
    };
  };

  res.json = (data) => {
    res._body = data;
    return res;
  };

  res.end = () => {};

  return res;
}
