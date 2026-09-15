const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const {
  addCheckinTemplate,
  getCheckinTemplates,
  addCheckinSubmission,
  getCheckinSubmissions,
  getCoachIdForClient,
  getClientIds,
} = require("../db");
const { uid } = require("../lib/uid");
const { isRecognizedImage } = require("../lib/fileSignature");
const { DATA_DIR } = require("../lib/dataDir");
const { requireAuth, requireRole } = require("../middleware/auth");

const POSE_KEYS = ["front", "side", "back"];
const MAX_POSES_PER_KEY = 6;

const UPLOAD_DIR = path.join(DATA_DIR, "uploads", "checkins");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The client-supplied mimetype is trivially spoofable, so uploads are also
// gated on a fixed extension allowlist — and pose photos on the file's
// actual magic bytes below — rather than trusting the mimetype alone. SVG
// is deliberately excluded even though browsers treat it as an image: it
// can carry <script>, which would be a stored-XSS vector once served back
// to the client or their coach.
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function sanitizePosing(posing) {
  const out = {};
  for (const key of POSE_KEYS) {
    const n = Math.round(Number(posing?.[key]) || 0);
    out[key] = Math.min(Math.max(n, 0), MAX_POSES_PER_KEY);
  }
  return out;
}

// Templates saved before multi-video support only have the old boolean
// requireVideo — treat that as "1 video" so old templates keep working.
function sanitizeVideoCount(template) {
  if (template && typeof template.videoCount !== "undefined") {
    return Math.min(Math.max(Math.round(Number(template.videoCount) || 0), 0), MAX_POSES_PER_KEY);
  }
  return template?.requireVideo ? 1 : 0;
}

// Filenames are prefixed with the client's id so the media-serving route can
// check ownership without a separate lookup table. "--" (not "_") separates
// it from the random suffix, since client ids themselves contain
// underscores (e.g. "client_ab12cd34").
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).toLowerCase();
    cb(null, `${req.user.id}--${uid()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 75 * 1024 * 1024, files: MAX_POSES_PER_KEY + MAX_POSES_PER_KEY * POSE_KEYS.length },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "video") {
      if (!file.mimetype.startsWith("video/") || !VIDEO_EXTS.has(ext)) {
        return cb(new Error("The form-check upload must be an MP4, MOV, or WEBM video"));
      }
    } else if (file.fieldname === "photos") {
      if (!file.mimetype.startsWith("image/") || !IMAGE_EXTS.has(ext)) {
        return cb(new Error("Pose uploads must be JPG, PNG, GIF, or WEBP images"));
      }
    } else {
      return cb(new Error("Unexpected file field"));
    }
    cb(null, true);
  },
});

router.post("/templates", requireRole("coach"), (req, res) => {
  const { title, fields, videoCount, posing, clientId } = req.body;
  if (!title?.trim() || !Array.isArray(fields) || fields.some((f) => !f.label?.trim())) {
    return res.status(400).json({ error: "Title and labeled fields are required" });
  }
  if (clientId && !getClientIds(req.user.id).includes(clientId)) {
    return res.status(400).json({ error: "That's not one of your clients" });
  }
  const template = {
    id: uid("tmpl_"),
    title: title.trim(),
    fields: fields.map((f) => ({ id: f.id || uid("f_"), kind: f.kind === "text" ? "text" : "scale", label: f.label.trim() })),
    videoCount: Math.min(Math.max(Math.round(Number(videoCount) || 0), 0), MAX_POSES_PER_KEY), // how many form-check videos this template asks for
    posing: sanitizePosing(posing), // { front, side, back } — number of photos requested per pose
    clientId: clientId || null, // null = sent to every client; otherwise just this one
    createdAt: Date.now(),
  };
  res.json({ templates: addCheckinTemplate(req.user.id, template) });
});

router.get("/templates", requireAuth, (req, res) => {
  const coachId = req.user.role === "coach" ? req.user.id : getCoachIdForClient(req.user.id);
  if (!coachId) return res.json({ templates: [] });
  // Old templates (saved before posing photos / multi-video existed) won't
  // have these fields — default them so the client form always has
  // something sensible to render.
  let templates = getCheckinTemplates(coachId).map((t) => ({ ...t, posing: sanitizePosing(t.posing), videoCount: sanitizeVideoCount(t) }));
  // A client should only ever see broadcast templates (clientId: null) and
  // ones sent specifically to them — never ones aimed at a different client.
  if (req.user.role === "client") {
    templates = templates.filter((t) => !t.clientId || t.clientId === req.user.id);
  }
  res.json({ templates });
});

router.post(
  "/submissions",
  requireRole("client"),
  (req, res, next) => {
    upload.fields([{ name: "video", maxCount: MAX_POSES_PER_KEY }, { name: "photos", maxCount: MAX_POSES_PER_KEY * POSE_KEYS.length }])(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  (req, res) => {
    try {
      const { title, weight, answers, photoMeta } = req.body;
      const parsedAnswers = typeof answers === "string" ? JSON.parse(answers) : answers || [];
      const parsedPhotoMeta = typeof photoMeta === "string" ? JSON.parse(photoMeta) : photoMeta || []; // [{pose: "front"|"side"|"back"}, ...] same order as uploaded photo files

      const photoFiles = req.files?.photos || [];
      const allUploaded = [...photoFiles, ...(req.files?.video || [])];
      for (const f of photoFiles) {
        const head = Buffer.alloc(12);
        const fd = fs.openSync(f.path, "r");
        fs.readSync(fd, head, 0, 12, 0);
        fs.closeSync(fd);
        if (!isRecognizedImage(head)) {
          allUploaded.forEach((u) => fs.unlink(u.path, () => {}));
          return res.status(400).json({ error: "One of those photos doesn't look like a real image" });
        }
      }
      const photos = photoFiles.map((f, i) => ({ pose: parsedPhotoMeta[i]?.pose || "front", file: f.filename }));

      const submission = {
        id: uid("chk_"),
        title: title || "Check-in",
        weight: weight || "",
        videoFiles: (req.files?.video || []).map((f) => f.filename),
        photos,
        answers: parsedAnswers,
        createdAt: Date.now(),
      };
      res.json({ submissions: addCheckinSubmission(req.user.id, submission) });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "Invalid submission" });
    }
  }
);

router.get("/submissions/:clientId", requireAuth, (req, res) => {
  const { clientId } = req.params;
  const isSelf = req.user.id === clientId;
  const isTheirCoach = req.user.role === "coach" && getCoachIdForClient(clientId) === req.user.id;
  if (!isSelf && !isTheirCoach) return res.status(403).json({ error: "Not allowed" });
  res.json({ submissions: getCheckinSubmissions(clientId) });
});

// Streams a check-in video or pose photo. Not served via express.static —
// only the submitting client or their coach can fetch it, and access is
// checked by the client id encoded as the filename's prefix.
router.get("/media/:filename", requireAuth, (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) return res.status(400).json({ error: "Invalid filename" });
  const ownerClientId = filename.split("--")[0];
  const isSelf = req.user.id === ownerClientId;
  const isTheirCoach = req.user.role === "coach" && getCoachIdForClient(ownerClientId) === req.user.id;
  if (!isSelf && !isTheirCoach) return res.status(403).json({ error: "Not allowed" });

  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
  res.sendFile(filePath);
});

module.exports = router;
