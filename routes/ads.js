const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { listAds, upsertAd, removeAd, getUser, getClientIds, getReviews } = require("../db");
const { tierForCoach, adsIncluded } = require("../lib/tiers");
const { uid } = require("../lib/uid");
const { isRecognizedImage } = require("../lib/fileSignature");
const { requireRole } = require("../middleware/auth");

// Ad media is genuinely public (it's shown to any client browsing "Find a
// Coach"), so — unlike check-in videos/photos — these files are served
// straight off disk via express.static in server.js, no auth check needed.
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "ads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The client-supplied mimetype is trivially spoofable, so this is also
// gated on a fixed extension allowlist — and, for images, on the file's
// actual magic bytes below — rather than trusting the mimetype alone.
// SVG is deliberately excluded even though browsers treat it as an image:
// it can carry <script> and would be a stored-XSS vector once served back
// to other users' browsers.
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uid()}${path.extname(file.originalname).slice(0, 10).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 75 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = file.mimetype.startsWith("image/") && IMAGE_EXTS.has(ext);
    const isVideo = file.mimetype.startsWith("video/") && VIDEO_EXTS.has(ext);
    if (!isImage && !isVideo) {
      return cb(new Error("Ad media must be a JPG, PNG, GIF, WEBP photo or an MP4, MOV, WEBM video"));
    }
    cb(null, true);
  },
});

router.get("/", (req, res) => {
  const ads = listAds()
    .map((ad) => {
      const coach = getUser(ad.coachId);
      if (!coach || !adsIncluded(coach)) return null;
      const count = getClientIds(ad.coachId).length;
      const tier = tierForCoach(coach);
      const reviews = getReviews(ad.coachId);
      const avgRating = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.stars, 0) / reviews.length) * 10) / 10 : null;
      return {
        coachId: ad.coachId,
        caption: ad.caption,
        mediaNote: ad.mediaNote,
        mediaFile: ad.mediaFile || null,
        mediaType: ad.mediaType || null,
        postedAt: ad.postedAt,
        coachName: coach.name,
        coachUsername: coach.username,
        atCap: count >= tier.max,
        spotsLeft: tier.max === Infinity ? null : Math.max(tier.max - count, 0),
        avgRating,
        reviewCount: reviews.length,
      };
    })
    .filter(Boolean);
  res.json({ ads });
});

router.post(
  "/",
  requireRole("coach"),
  (req, res, next) => {
    upload.single("media")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  (req, res) => {
    if (!adsIncluded(req.user)) {
      return res.status(402).json({ error: "Subscribe to the advertising add-on before posting an ad" });
    }
    const { caption, mediaNote } = req.body;
    if (!caption?.trim()) return res.status(400).json({ error: "caption is required" });

    if (req.file && req.file.mimetype.startsWith("image/")) {
      const head = Buffer.alloc(12);
      const fd = fs.openSync(req.file.path, "r");
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
      if (!isRecognizedImage(head)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "That file doesn't look like a real image" });
      }
    }

    const existing = listAds().find((a) => a.coachId === req.user.id);
    const payload = {
      caption: caption.trim(),
      mediaNote: (mediaNote || "").trim(),
      mediaFile: existing?.mediaFile || null,
      mediaType: existing?.mediaType || null,
    };
    if (req.file) {
      payload.mediaFile = req.file.filename;
      payload.mediaType = req.file.mimetype.startsWith("video/") ? "video" : "image";
      if (existing?.mediaFile) {
        fs.unlink(path.join(UPLOAD_DIR, existing.mediaFile), () => {});
      }
    }

    upsertAd(req.user.id, payload);
    res.json({ ok: true });
  }
);

router.delete("/", requireRole("coach"), (req, res) => {
  const existing = listAds().find((a) => a.coachId === req.user.id);
  if (existing?.mediaFile) {
    fs.unlink(path.join(UPLOAD_DIR, existing.mediaFile), () => {});
  }
  removeAd(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
