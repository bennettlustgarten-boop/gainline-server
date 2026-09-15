// Multer's fileFilter only sees the client-supplied MIME type header, which
// is trivial to spoof — a renamed .html or .svg file can claim to be
// "image/png". SVG in particular can carry <script>, making a disguised
// upload a stored-XSS vector once served back to other users. This checks
// the actual leading bytes of an uploaded image against known magic numbers
// as a second, harder-to-fake gate.
const IMAGE_SIGNATURES = [
  { bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG
  { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF87a / GIF89a
  { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF container (WEBP is RIFF....WEBP)
];

function isRecognizedImage(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return IMAGE_SIGNATURES.some(({ bytes }) => bytes.every((b, i) => buffer[i] === b));
}

module.exports = { isRecognizedImage };
