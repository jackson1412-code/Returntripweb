import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source.replaceAll('import.meta.env', '({ DEV: true })'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { loadBookingConfirmation, ApiRequestError } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('confirmation requires the verified session and forwards it with the booking id', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const pricing = {
    source: 'RETURN_TRIP_SUPPORT', originalFare: 1000,
    discountPercentage: 10, discountAmount: 100, finalPrice: 900,
  };
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, '/backend/api/customer/dev/bookingConfirmation/14868');
    assert.equal(options.headers.token, 'test-verified-session');
    return Response.json({ success: true, data: { id: 14868, returnTripPricing: pricing } });
  };
  try {
    await assert.rejects(loadBookingConfirmation(14868, ''), (error) => error.status === 401);
    assert.equal(calls, 0, 'missing sessions must not send a request');
    const result = await loadBookingConfirmation(14868, 'test-verified-session');
    assert.deepEqual(result.returnTripPricing, pricing);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP and JSON authentication failures expose a typed 401 for polling to stop', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 200]) {
      globalThis.fetch = async () => Response.json({
        success: false, code: 401, message: 'Unauthorized', sessionCode: 'SESSION_INVALID',
      }, { status });
      await assert.rejects(loadBookingConfirmation(14868, 'expired-session'), (error) => (
        error instanceof ApiRequestError && error.status === 401 && error.code === 401
      ));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
