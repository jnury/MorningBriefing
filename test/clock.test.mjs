import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zurichDate } from '../lib/clock.mjs';

test('formats a date in Europe/Zurich as YYYY-MM-DD', () => {
  // 2026-06-09T03:30:00Z is 05:30 in Zurich (CEST, +02:00) -> still the 9th
  assert.equal(zurichDate(new Date('2026-06-09T03:30:00Z')), '2026-06-09');
});

test('handles day rollover relative to UTC', () => {
  // 2026-06-08T23:30:00Z is 01:30 on the 9th in Zurich
  assert.equal(zurichDate(new Date('2026-06-08T23:30:00Z')), '2026-06-09');
});
