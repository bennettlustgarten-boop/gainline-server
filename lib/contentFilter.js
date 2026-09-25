// Minimal filter for objectionable text in content other users can see
// (coach ad captions, public reviews) — App Store guideline 1.2 asks for "a
// method for filtering objectionable material". Deliberately conservative:
// slurs, explicit sexual content, and self-harm/violence directed at a
// person. Ordinary profanity is NOT blocked (coaches and clients talk like
// people), and private messages aren't filtered here — those are covered by
// the report/block tools instead. Everything else that slips through is
// handled by reports landing in the admin dashboard.

const PATTERNS = [
  /\bn+[i!]+g+[e3]+r+s?\b/,
  /\bn+[i!]+g+[a@]+s?\b/,
  /\bf+[a@]+g+[o0]*t*s?\b/,
  /\bk+[i!]+k+[e3]+s?\b/,
  /\btr+[a@]+nn+(y|ie)s?\b/,
  /\bch+[i!]+nks?\b/,
  /\bsp+[i!]+cs?\b/,
  /\br+[e3]+t+[a@]+r+d+(ed|s)?\b/,
  /\bp+[o0]+r+n+(o|ography)?\b/,
  /\bxxx\b/,
  /\bblow\s*jobs?\b/,
  /\bonly\s*fans\b/,
  /\bnudes?\b/,
  /\bescort\s+service/,
  /\bkill\s+(your|ur)\s*self\b/,
  /\bk+y+s\b/,
];

// Undo the usual character swaps ("n1gg3r", "p0rn", "$hit") before matching.
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[$]/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s");
}

function isObjectionable(text) {
  const normalized = normalize(text);
  return PATTERNS.some((re) => re.test(normalized));
}

const REJECTION_MESSAGE = "That contains language that isn't allowed on Gainline. Please reword it and try again.";

module.exports = { isObjectionable, REJECTION_MESSAGE };
