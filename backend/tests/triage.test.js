import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEmergencyRedFlag, emergencyReply } from '../src/utils/triage.js';

test('detects English emergency phrases', () => {
  assert.equal(hasEmergencyRedFlag('I have severe chest pain'), true);
});

test('detects Bangla emergency phrases', () => {
  assert.equal(hasEmergencyRedFlag('আমার শ্বাসকষ্ট হচ্ছে'), true);
});

test('does not flag a routine symptom by keyword alone', () => {
  assert.equal(hasEmergencyRedFlag('I have a mild headache'), false);
});

test('emergency response tells the user to seek urgent care', () => {
  assert.match(emergencyReply().reply, /৯৯৯/);
  assert.equal(emergencyReply().em, 1);
});
