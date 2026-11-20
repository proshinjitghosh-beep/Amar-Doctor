
/**
 * A severity word that Bangla puts between the body part and the symptom:
 * "বুকে প্রচণ্ড ব্যথা", "তীব্র ব্যথা", "ভয়ানক ব্যথা". Matching only the literal
 * phrase "বুকে ব্যথা" missed every sentence where the patient (or the
 * patient's family) qualified the pain, which is exactly how a serious
 * complaint is usually written. The qualifier is therefore optional.
 */
const SEVERE = '(?:প্রচণ্ড|তীব্র|ভয়ানক|মারাত্মক|খুব|অনেক|বেশি)?';

const EMERGENCY_PATTERNS = [
  /chest pain|severe chest pressure|can't breathe|cannot breathe|difficulty breathing|shortness of breath/i,
  /unconscious|not responding|seizure|stroke|face droop|slurred speech/i,
  /suicid|self[- ]harm|self harm|overdose|hurt myself|harm myself|kill myself|want to die|end my life|take my own life/i,
  /(heavy|severe|massive|uncontrolled|profuse)\s*bleeding|bleeding heavily/i,
  // বুকে ব্যথা, বুকে প্রচণ্ড ব্যথা, বুকে তীব্র চাপ, বুকব্যথা
  new RegExp(`বুক(?:ে)?\\s*${SEVERE}\\s*(?:ব্যথা|চাপ)`),
  // শ্বাসকষ্ট, শ্বাস কষ্ট, শ্বাস নিতে পারছি না, দম বন্ধ
  /শ্বাস\s*কষ্ট|শ্বাস নিতে পারছি না|শ্বাস নিতে কষ্ট|শ্বাস ফুরিয়ে|দম বন্ধ|ফোঁসা ফাঁপসা|শ্বাস আটকে/i,
  // অজ্ঞান, মূর্চিত, খিঁচুনি/খিচুনি, স্ট্রোক
  /অজ্ঞান|মূর্চিত|খিঁচুনি|খিচুনি|স্ট্রোক|সাড়া দিচ্ছে না/i,
  // পক্ষা দুর্বল, মুখ বাঁকা, কথা বলতে পারছি না
  new RegExp(`(?:পক্ষা|হাত|পা)\\s*${SEVERE}\\s*(?:দুর্বল|লেগে|শক্তি)`),
  /মুখ বাঁকা|কথা বলতে পারছি না|কথা বলা যাচ্ছে না/i,
  // প্রচুর রক্তপাত, রক্তপাত হচ্ছে, রক্ত যাচ্ছে
  new RegExp(`${SEVERE}\\s*রক্তপাত|রক্তপাত হচ্ছে|রক্ত যাচ্ছে|রক্তক্ষরণ`),
  /আত্মহত্যা|আত্মহত্যার|নিজেকে ক্ষতি/i,
];

export function hasEmergencyRedFlag(text = '') {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

export function emergencyReply() {
  return {
    reply: 'আপনার বলা লক্ষণ জরুরি অবস্থার ইঙ্গিত হতে পারে। এখনই স্থানীয় জরুরি সেবা ৯৯৯-এ কল করুন অথবা নিকটস্থ হাসপাতালের জরুরি বিভাগে যান। নিজে গাড়ি চালাবেন না এবং AI উত্তরের জন্য অপেক্ষা করবেন না।',
    sp: null,
    em: true,
  };
}
