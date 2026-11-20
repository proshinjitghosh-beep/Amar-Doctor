import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEmergencyRedFlag, emergencyReply } from '../src/utils/triage.js';

test('detects English emergency phrases', () => {
  assert.equal(hasEmergencyRedFlag('I have severe chest pain'), true);
});

test('detects Bangla emergency phrases', () => {
  assert.equal(hasEmergencyRedFlag('আমার শ্বাসকষ্ট হচ্ছে'), true);
});

test('detects a Bangla emergency phrase with a severity word in it', () => {
  // "বুকে প্রচণ্ড ব্যথা" is how a serious complaint is usually written, and
  // it is not a substring of "বুকে ব্যথা".
  assert.equal(hasEmergencyRedFlag('বুকে প্রচণ্ড ব্যথা হচ্ছে'), true);
  assert.equal(hasEmergencyRedFlag('বুকে তীব্র ব্যথা'), true);
  assert.equal(hasEmergencyRedFlag('বুকে ভয়ানক চাপ বুকে দিতেছে'), true);
  assert.equal(hasEmergencyRedFlag('বুকব্যথা হচ্ছে'), true);
});

test('detects other Bangla emergency phrases with qualifiers', () => {
  assert.equal(hasEmergencyRedFlag('তীব্র শ্বাসকষ্ট হচ্ছে'), true);
  assert.equal(hasEmergencyRedFlag('দম বন্ধ হয়ে যাচ্ছে'), true);
  assert.equal(hasEmergencyRedFlag('প্রচুর রক্তপাত হচ্ছে'), true);
  assert.equal(hasEmergencyRedFlag('মুখ বাঁকা হয়ে গেছে'), true);
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
