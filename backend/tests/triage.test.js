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
  // `em` is normalised to a boolean across the triage and AI paths.
  assert.equal(emergencyReply().em, true);
});

test('detects self-harm and bleeding red flags', () => {
  assert.equal(hasEmergencyRedFlag('I want to hurt myself'), true);
  assert.equal(hasEmergencyRedFlag('আমার আত্মহত্যার ভাবনা হচ্ছে'), true);
  assert.equal(hasEmergencyRedFlag('I have severe bleeding'), true);
});
