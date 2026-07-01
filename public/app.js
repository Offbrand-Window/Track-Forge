const state = {
  jobId: "",
  sourceName: ""
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  fileInput: $("#fileInput"),
  uploadLabel: $("#uploadLabel"),
  urlForm: $("#urlForm"),
  audioUrl: $("#audioUrl"),
  rightsConfirmed: $("#rightsConfirmed"),
  mediaToolForm: $("#mediaToolForm"),
  mediaToolUrl: $("#mediaToolUrl"),
  rightsBasis: $("#rightsBasis"),
  mediaToolRightsConfirmed: $("#mediaToolRightsConfirmed"),
  sourceStatus: $("#sourceStatus"),
  coverPreview: $("#coverPreview"),
  artPlaceholder: $("#artPlaceholder"),
  tagForm: $("#tagForm"),
  exportButton: $("#exportButton"),
  downloadPanel: $("#downloadPanel"),
  downloadLink: $("#downloadLink"),
  metadataButton: $("#metadataButton"),
  metadataUrl: $("#metadataUrl"),
  quitButton: $("#quitButton"),
  fields: {
    title: $("#title"),
    artist: $("#artist"),
    album: $("#album"),
    year: $("#year"),
    track: $("#track"),
    genre: $("#genre"),
    artworkUrl: $("#artworkUrl"),
    comments: $("#comments")
  }
};

elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("audio", file);
  setBusy(true, "Uploading source...");

  try {
    const job = await api("/api/import/upload", { method: "POST", body: form });
    setSource(job);
    elements.uploadLabel.textContent = file.name;
    toast("Audio source ready.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

elements.urlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Importing URL...");

  try {
    const job = await api("/api/import/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: elements.audioUrl.value,
        rightsConfirmed: elements.rightsConfirmed.checked
      })
    });
    setSource(job);
    toast("Direct audio imported.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

elements.mediaToolForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Fetching with yt-dlp...");

  try {
    const job = await api("/api/import/ytdlp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: elements.mediaToolUrl.value,
        rightsBasis: elements.rightsBasis.value,
        rightsConfirmed: elements.mediaToolRightsConfirmed.checked
      })
    });
    setSource(job);
    toast("Media audio source ready.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

elements.metadataButton.addEventListener("click", async () => {
  if (!elements.metadataUrl.value.trim()) return;
  setBusy(true, "Scraping metadata...");

  try {
    const data = await api("/api/metadata-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: elements.metadataUrl.value })
    });
    applyMetadata(data);
    toast("Metadata applied.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

elements.fields.artworkUrl.addEventListener("input", () => updateCover(elements.fields.artworkUrl.value));

elements.quitButton.addEventListener("click", async () => {
  elements.quitButton.disabled = true;
  toast("Shutting down Track Forge...");

  try {
    await fetch("/api/shutdown", { method: "POST" });
  } catch {
    // The server may close before the browser finishes reading the response.
  }

  document.body.classList.add("shutdown");
  toast("Track Forge has quit. You can close this tab.");
});

elements.tagForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.jobId) {
    toast("Add an MP3 source first.", true);
    return;
  }

  setBusy(true, "Writing ID3 tags...");

  try {
    const payload = {
      jobId: state.jobId,
      ...Object.fromEntries(Object.entries(elements.fields).map(([key, input]) => [key, input.value]))
    };
    const data = await api("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    elements.downloadLink.href = data.downloadUrl;
    elements.downloadLink.download = data.filename;
    elements.downloadLink.textContent = `Download ${data.filename}`;
    elements.downloadPanel.hidden = false;
    toast("Tagged MP3 is ready.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

function applyMetadata(result) {
  for (const key of ["title", "artist", "album", "year", "track", "genre", "artworkUrl"]) {
    if (result[key]) elements.fields[key].value = result[key];
  }
  updateCover(result.artworkUrl);
}

function setSource(job) {
  state.jobId = job.jobId;
  state.sourceName = job.originalName;
  elements.sourceStatus.textContent = job.originalName || "Audio source ready";
  elements.exportButton.disabled = false;
}

function updateCover(url) {
  if (!url) {
    elements.coverPreview.removeAttribute("src");
    elements.coverPreview.hidden = true;
    elements.artPlaceholder.hidden = false;
    return;
  }
  elements.coverPreview.src = url;
  elements.coverPreview.hidden = false;
  elements.artPlaceholder.hidden = true;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function setBusy(isBusy, label = "") {
  document.body.classList.toggle("busy", isBusy);
  if (label) toast(label);
}

let toastTimer;
function toast(message, isError = false) {
  clearTimeout(toastTimer);
  const toastElement = $("#toast");
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.add("visible");
  toastTimer = setTimeout(() => toastElement.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
