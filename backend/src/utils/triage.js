
const EMERGENCY_PATTERNS = [
  /chest pain|severe chest pressure|can't breathe|cannot breathe|difficulty breathing|shortness of breath/i,
  /unconscious|not responding|seizure|stroke|face droop|slurred speech/i,
  /suicid|self[- ]harm|self harm|overdose|hurt myself|harm myself|kill myself|want to die|end my life|take my own life/i,
  /(heavy|severe|massive|uncontrolled|profuse)\s*bleeding|bleeding heavily/i,
  /বুকে ব্যথা|তীব্র বুকের চাপ|শ্বাসকষ্ট|শ্বাস নিতে পারছি না|অজ্ঞান|খিঁচুনি|স্ট্রোক|প্রচুর রক্তপাত/i,
  /আত্মহত্যা|আত্মহত্যার|রক্তক্ষরণ|নিজেকে ক্ষতি/i,
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
