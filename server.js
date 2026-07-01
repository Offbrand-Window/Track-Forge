import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import NodeID3 from "node-id3";
import sanitize from "sanitize-filename";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || "127.0.0.1";
const MEDIA_IMPORT_MAX_SECONDS = Number(process.env.MEDIA_IMPORT_MAX_SECONDS || 1800);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_ROOT = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support")
  : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
const DATA_DIR = process.env.TRACK_FORGE_DATA_DIR || path.join(USER_DATA_ROOT, "Track Forge");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const EXPORT_DIR = path.join(DATA_DIR, "exports");
const PUBLIC_DIR = path.join(ROOT, "public");

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(EXPORT_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 80 * 1024 * 1024 }
});

const jobs = new Map();

app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_req, res) => {
  res.json({ app: "Track Forge", ok: true });
});
app.post("/api/shutdown", (_req, res) => {
  res.json({ ok: true });
  setTimeout(() => {
    server.close(() => process.exit(0));
  }, 250);
});
app.use(express.static(PUBLIC_DIR));

app.post("/api/import/upload", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio file uploaded." });

  const job = createJob({
    sourcePath: req.file.path,
    originalName: req.file.originalname,
    sourceLabel: "Uploaded file"
  });

  res.json(jobPublic(job));
});

app.post("/api/import/url", async (req, res) => {
  const { url, rightsConfirmed } = req.body || {};
  if (!rightsConfirmed) {
    return res.status(400).json({ error: "Confirm you have the right to download and import this audio." });
  }

  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return res.status(400).json({ error: "Enter a valid direct audio URL." });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "Only http/https URLs are supported." });
  }

  const lowerHost = parsed.hostname.toLowerCase();
  const blockedHosts = ["youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com", "spotify.com", "open.spotify.com"];
  if (blockedHosts.some((host) => lowerHost === host || lowerHost.endsWith(`.${host}`))) {
    return res.status(400).json({
      error: "This app accepts direct authorized audio files, not streaming/video pages."
    });
  }

  const head = await fetch(parsed, { method: "HEAD", redirect: "follow" }).catch(() => null);
  const contentType = head?.headers.get("content-type") || "";
  if (contentType && !/^audio\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    return res.status(400).json({ error: `That URL does not look like a direct audio file (${contentType}).` });
  }

  const ext = extensionFromContentType(contentType) || path.extname(parsed.pathname) || ".mp3";
  const id = crypto.randomUUID();
  const filename = `${id}${ext}`;
  const target = path.join(UPLOAD_DIR, filename);

  const response = await fetch(parsed, { redirect: "follow" });
  if (!response.ok || !response.body) {
    return res.status(400).json({ error: `Download failed with status ${response.status}.` });
  }

  await pipeline(response.body, createWriteStream(target));

  const job = createJob({
    id,
    sourcePath: target,
    originalName: sanitize(path.basename(parsed.pathname)) || filename,
    sourceLabel: parsed.hostname
  });

  res.json(jobPublic(job));
});

app.post("/api/import/ytdlp", async (req, res) => {
  const { url, rightsConfirmed, rightsBasis } = req.body || {};
  if (!rightsConfirmed || !isAllowedRightsBasis(rightsBasis)) {
    return res.status(400).json({
      error: "Confirm this source is your work, licensed, public-domain, Creative Commons, or used with permission."
    });
  }

  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return res.status(400).json({ error: "Enter a valid source URL." });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "Only http/https URLs are supported." });
  }

  const lowerHost = parsed.hostname.toLowerCase();
  if (lowerHost === "open.spotify.com" || lowerHost.endsWith(".spotify.com")) {
    return res.status(400).json({ error: "Spotify URLs are not import sources for Local Files." });
  }

  const tools = await resolveMediaTools();
  if (!tools.downloader) {
    return res.status(501).json({
      error: "Install yt-dlp or youtube-dl, or set YTDLP_PATH/YOUTUBE_DL_PATH to the downloader binary."
    });
  }

  if (!tools.ffmpeg) {
    return res.status(501).json({
      error: "Install ffmpeg, or set FFMPEG_PATH to the ffmpeg binary."
    });
  }

  const id = crypto.randomUUID();
  const outputPath = path.join(UPLOAD_DIR, `${id}.mp3`);
  try {
    await importWithYtdlp({
      downloaderPath: tools.downloader,
      ffmpegPath: tools.ffmpeg,
      sourceUrl: parsed.href,
      outputPath
    });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }

  const job = createJob({
    id,
    sourcePath: outputPath,
    originalName: `${sanitize(parsed.hostname) || "media"}-${id}.mp3`,
    sourceLabel: `yt-dlp: ${parsed.hostname}`
  });

  res.json(jobPublic(job));
});

app.post("/api/metadata-source", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "Enter a valid metadata source URL." });
  }

  if (!parsed.hostname.toLowerCase().endsWith("genius.com")) {
    return res.status(400).json({ error: "Metadata scraping currently supports Genius song pages." });
  }

  const response = await fetch(parsed, {
    headers: { "user-agent": "TrackForge/1.0 metadata helper" }
  });
  if (!response.ok) return res.status(400).json({ error: `Genius returned ${response.status}.` });

  const html = await response.text();
  const image =
    extractMeta(html, "property", "og:image") ||
    extractMeta(html, "name", "twitter:image");
  const pageTitle =
    extractMeta(html, "property", "og:title") ||
    extractMeta(html, "name", "twitter:title") ||
    extractTitleTag(html);

  const parsedTags = parseGeniusTitle(pageTitle);

  if (!image && !parsedTags.title && !parsedTags.artist) {
    return res.status(404).json({ error: "No usable metadata found on that Genius page." });
  }

  res.json({
    source: "Genius",
    title: parsedTags.title,
    artist: parsedTags.artist,
    artworkUrl: image
  });
});

app.post("/api/export", async (req, res) => {
  const {
    jobId,
    title,
    artist,
    album,
    year,
    track,
    genre,
    artworkUrl,
    comments
  } = req.body || {};

  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Audio source not found. Upload or import it again." });

  const ext = path.extname(job.originalName || job.sourcePath).toLowerCase() || ".mp3";
  if (ext !== ".mp3") {
    return res.status(400).json({ error: "ID3 export currently supports MP3 files. Convert your source to MP3 first." });
  }

  const safeBase = sanitize(`${artist || "Unknown Artist"} - ${title || "Untitled"}`) || "track";
  const outputPath = path.join(EXPORT_DIR, `${safeBase}-${Date.now()}.mp3`);
  await fs.copyFile(job.sourcePath, outputPath);

  let image;
  if (artworkUrl) {
    image = await fetchArtwork(artworkUrl).catch(() => null);
  }

  const tags = {
    title: cleanTag(title),
    artist: cleanTag(artist),
    album: cleanTag(album),
    year: cleanTag(year),
    trackNumber: cleanTag(track),
    genre: cleanTag(genre),
    comment: {
      language: "eng",
      text: cleanTag(comments) || "Prepared with Track Forge for Spotify Local Files."
    }
  };

  if (image) {
    tags.image = {
      mime: image.mime,
      type: { id: 3, name: "front cover" },
      description: "Cover",
      imageBuffer: image.buffer
    };
  }

  const ok = NodeID3.write(tags, outputPath);
  if (!ok) return res.status(500).json({ error: "Could not write ID3 metadata to the MP3." });

  res.json({
    filename: path.basename(outputPath),
    downloadUrl: `/downloads/${encodeURIComponent(path.basename(outputPath))}`
  });
});

app.get("/downloads/:filename", async (req, res) => {
  const filename = sanitize(req.params.filename);
  const file = path.join(EXPORT_DIR, filename);
  res.download(file, filename);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Track Forge running at http://localhost:${PORT}`);
});

function createJob({ id = crypto.randomUUID(), sourcePath, originalName, sourceLabel }) {
  const job = {
    id,
    sourcePath,
    originalName,
    sourceLabel,
    createdAt: new Date().toISOString()
  };
  jobs.set(id, job);
  return job;
}

function jobPublic(job) {
  return {
    jobId: job.id,
    originalName: job.originalName,
    sourceLabel: job.sourceLabel
  };
}

function isAllowedRightsBasis(value) {
  return ["ownWork", "licensed", "publicDomain", "creativeCommons", "permission"].includes(value);
}

async function resolveMediaTools() {
  const downloader =
    process.env.YTDLP_PATH ||
    process.env.YOUTUBE_DL_PATH ||
    await findExecutable("yt-dlp") ||
    await findExecutable("youtube-dl") ||
    await existingFile(path.join(ROOT, "node_modules", "youtube-dl-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"));

  const ffmpeg =
    process.env.FFMPEG_PATH ||
    await findExecutable("ffmpeg") ||
    await existingFile(path.join(ROOT, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"));

  return { downloader, ffmpeg };
}

async function existingFile(filePath) {
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return "";
  }
}

async function findExecutable(command) {
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", `command -v ${shellQuote(command)}`]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function importWithYtdlp({ downloaderPath, ffmpegPath, sourceUrl, outputPath }) {
  const outputTemplate = outputPath.replace(/\.mp3$/i, ".%(ext)s");
  const args = [
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--ffmpeg-location",
    path.dirname(ffmpegPath),
    "--match-filter",
    `duration <= ${MEDIA_IMPORT_MAX_SECONDS}`,
    "--output",
    outputTemplate
  ];

  if (process.env.YTDLP_NO_CHECK_CERTIFICATE === "1") {
    args.push("--no-check-certificate");
  }

  args.push(sourceUrl);

  await runMediaCommand(downloaderPath, args);

  try {
    await fs.access(outputPath);
  } catch {
    throw new Error("Media import finished, but the expected MP3 output was not created.");
  }
}

function runMediaCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH || "" }
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });

    child.on("error", (error) => {
      reject(new Error(`Could not start media downloader: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(compactCommandError(stderr) || `Media downloader exited with code ${code}.`));
    });
  });
}

function compactCommandError(stderr) {
  const raw = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (/CERTIFICATE_VERIFY_FAILED|certificate verify failed/i.test(raw)) {
    return "yt-dlp could not verify the site certificate. Install/update system certificates, use a system yt-dlp install, or restart with YTDLP_NO_CHECK_CERTIFICATE=1 if you trust the source.";
  }

  if (/Unsupported URL/i.test(raw)) {
    return "yt-dlp does not support that URL. Try a direct audio URL or a supported media page.";
  }

  if (/This video is unavailable/i.test(raw)) {
    return "That media is unavailable to yt-dlp. It may be private, region-limited, removed, or require sign-in.";
  }

  if (/Sign in to confirm|login|cookies/i.test(raw)) {
    return "yt-dlp needs a signed-in browser session or cookies for that source. Use a source that does not require sign-in, or configure cookies manually outside the app.";
  }

  return raw
    .replace(/please report this issue.*$/i, "")
    .replace(/Confirm you are on the latest version.*$/i, "")
    .split(/\s+/)
    .slice(0, 80)
    .join(" ");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function extensionFromContentType(contentType) {
  if (/mpeg|mp3/i.test(contentType)) return ".mp3";
  if (/wav/i.test(contentType)) return ".wav";
  if (/flac/i.test(contentType)) return ".flac";
  if (/aac|mp4|m4a/i.test(contentType)) return ".m4a";
  return "";
}

function cleanTag(value) {
  return String(value || "").trim();
}

async function fetchArtwork(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid artwork URL");

  const response = await fetch(parsed, { redirect: "follow" });
  if (!response.ok) throw new Error("Artwork fetch failed");

  const mime = response.headers.get("content-type") || "image/jpeg";
  if (!/^image\//i.test(mime)) throw new Error("Artwork is not an image");

  const arrayBuffer = await response.arrayBuffer();
  return { mime: mime.split(";")[0], buffer: Buffer.from(arrayBuffer) };
}

function extractMeta(html, attrName, attrValue) {
  const pattern = new RegExp(`<meta[^>]+${attrName}=["']${escapeRegExp(attrValue)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const alternate = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*>`, "i");
  const match = html.match(pattern) || html.match(alternate);
  return match ? decodeHtml(match[1]) : "";
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtml(match[1]) : "";
}

function parseGeniusTitle(pageTitle) {
  const cleaned = pageTitle
    .replace(/\s*\|\s*Genius\s*$/i, "")
    .replace(/\s+Lyrics\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const separator = cleaned.includes(" – ") ? " – " : cleaned.includes(" - ") ? " - " : "";
  if (!separator) return { title: cleaned, artist: "" };

  const [artist, ...titleParts] = cleaned.split(separator);
  return {
    artist: artist.trim(),
    title: titleParts.join(separator).trim()
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}
