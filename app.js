"use strict";

const Core = window.TranscriptCore;
const AUDIO_EXTENSIONS = [".m4a", ".mp3", ".wav", ".flac", ".ogg", ".aac", ".mp4"];
const AUDIO_LOOKUP_TIMEOUT_MS = 1500;
const LOOKUP_TIMED_OUT = Symbol("lookup timed out");
const RECENT_DB_NAME = "atrain-transcript-reviewer";
const RECENT_DB_VERSION = 1;
const RECENT_STORE_NAME = "recent-projects";
const MAX_RECENT_PROJECTS = 8;
const OUTPUT_NAMES = [
  "transcription.json",
  "transcription.srt",
  "transcription.txt",
  "transcription_timestamps.txt",
  "transcription_maxqda.txt",
  "transcription_reviewed.md"
];

const state = {
  directory: null,
  project: null,
  audioUrl: null,
  audioFile: null,
  dirty: false,
  activeId: null,
  originals: {},
  backupCreated: false,
  saving: false,
  recentKey: null,
  recentProjects: []
};

const $ = (id) => document.getElementById(id);
const elements = {
  openFolderButton: $("openFolderButton"),
  welcomeOpenButton: $("welcomeOpenButton"),
  recentProjectsButton: $("recentProjectsButton"),
  welcomeRecent: $("welcomeRecent"),
  welcomeRecentList: $("welcomeRecentList"),
  recentProjectsDialog: $("recentProjectsDialog"),
  dialogRecentList: $("dialogRecentList"),
  noRecentProjects: $("noRecentProjects"),
  saveButton: $("saveButton"),
  welcomePanel: $("welcomePanel"),
  workspace: $("workspace"),
  projectPath: $("projectPath"),
  projectTitle: $("projectTitle"),
  audioPlayer: $("audioPlayer"),
  audioMissing: $("audioMissing"),
  chooseAudioButton: $("chooseAudioButton"),
  backButton: $("backButton"),
  playButton: $("playButton"),
  forwardButton: $("forwardButton"),
  speedSelect: $("speedSelect"),
  followPlayback: $("followPlayback"),
  timeDisplay: $("timeDisplay"),
  searchInput: $("searchInput"),
  speakerFilter: $("speakerFilter"),
  reviewFilter: $("reviewFilter"),
  reviewCount: $("reviewCount"),
  progressBar: $("progressBar"),
  speakerList: $("speakerList"),
  addSpeakerButton: $("addSpeakerButton"),
  toggleSpeakerPanelButton: $("toggleSpeakerPanelButton"),
  contentGrid: document.querySelector(".content-grid"),
  speakerInSrt: $("speakerInSrt"),
  segmentList: $("segmentList"),
  emptyFilterMessage: $("emptyFilterMessage"),
  dirtyDot: $("dirtyDot"),
  saveStatus: $("saveStatus"),
  messageDialog: $("messageDialog"),
  dialogTitle: $("dialogTitle"),
  dialogMessage: $("dialogMessage")
};

function openRecentDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("Recent-project storage is unavailable in this browser."));
      return;
    }
    const request = window.indexedDB.open(RECENT_DB_NAME, RECENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECENT_STORE_NAME)) {
        database.createObjectStore(RECENT_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open recent-project storage."));
  });
}

async function recentStoreRequest(mode, operation) {
  const database = await openRecentDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(RECENT_STORE_NAME, mode);
      const store = transaction.objectStore(RECENT_STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Recent-project storage failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Recent-project storage was interrupted."));
    });
  } finally {
    database.close();
  }
}

async function getRecentProjects() {
  const projects = await recentStoreRequest("readonly", (store) => store.getAll());
  return projects.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
}

async function deleteRecentProject(key) {
  await recentStoreRequest("readwrite", (store) => store.delete(key));
}

function makeRecentKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `recent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function rememberRecentProject(directory, projectId, audioHandle = undefined) {
  let projects = [];
  try {
    projects = await getRecentProjects();
  } catch (_) {
    return null;
  }

  let existing = null;
  for (const project of projects) {
    try {
      if (await project.directoryHandle.isSameEntry(directory)) {
        existing = project;
        break;
      }
    } catch (_) {
      // A stale handle simply behaves as a different entry.
    }
  }

  const record = {
    key: existing?.key || makeRecentKey(),
    name: directory.name,
    projectId,
    lastOpened: Date.now(),
    directoryHandle: directory,
    audioHandle: audioHandle === undefined ? (existing?.audioHandle || null) : audioHandle
  };
  await recentStoreRequest("readwrite", (store) => store.put(record));

  const updated = await getRecentProjects();
  for (const stale of updated.slice(MAX_RECENT_PROJECTS)) {
    await deleteRecentProject(stale.key);
  }
  await refreshRecentProjects();
  return record.key;
}

async function updateRecentAudioHandle(audioHandle) {
  if (!state.recentKey) return;
  try {
    const record = await recentStoreRequest("readonly", (store) => store.get(state.recentKey));
    if (!record) return;
    record.audioHandle = audioHandle;
    record.lastOpened = Date.now();
    await recentStoreRequest("readwrite", (store) => store.put(record));
    await refreshRecentProjects();
  } catch (_) {
    // Remembering external audio is a convenience, never a loading blocker.
  }
}

function formatRecentDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function makeRecentProjectRow(project) {
  const row = document.createElement("div");
  row.className = "recent-item";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "recent-open";
  const name = document.createElement("span");
  name.className = "recent-name";
  name.textContent = project.projectId || project.name;
  const meta = document.createElement("span");
  meta.className = "recent-meta";
  meta.textContent = `${project.name} · ${formatRecentDate(project.lastOpened)}`;
  open.append(name, meta);
  open.addEventListener("click", () => openRecentProject(project));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "recent-remove";
  remove.textContent = "×";
  remove.title = `Remove ${project.projectId || project.name} from recent transcripts`;
  remove.setAttribute("aria-label", remove.title);
  remove.addEventListener("click", async () => {
    await deleteRecentProject(project.key);
    if (state.recentKey === project.key) state.recentKey = null;
    await refreshRecentProjects();
  });

  row.append(open, remove);
  return row;
}

function renderRecentProjects() {
  elements.welcomeRecentList.replaceChildren();
  elements.dialogRecentList.replaceChildren();
  state.recentProjects.forEach((project) => {
    elements.welcomeRecentList.append(makeRecentProjectRow(project));
    elements.dialogRecentList.append(makeRecentProjectRow(project));
  });
  const hasRecent = state.recentProjects.length > 0;
  elements.welcomeRecent.classList.toggle("hidden", !hasRecent);
  elements.recentProjectsButton.classList.toggle("hidden", !hasRecent);
  elements.noRecentProjects.classList.toggle("hidden", hasRecent);
}

async function refreshRecentProjects() {
  try {
    state.recentProjects = await getRecentProjects();
  } catch (_) {
    state.recentProjects = [];
  }
  renderRecentProjects();
}

function showMessage(title, message) {
  elements.dialogTitle.textContent = title;
  elements.dialogMessage.textContent = message;
  if (typeof elements.messageDialog.showModal === "function") {
    elements.messageDialog.showModal();
  } else {
    alert(`${title}\n\n${message}`);
  }
}

function setDirty(dirty, message) {
  state.dirty = dirty;
  elements.dirtyDot.classList.toggle("unsaved", dirty);
  elements.dirtyDot.classList.toggle("saved", !dirty && Boolean(state.project));
  elements.saveStatus.textContent = message || (dirty ? "Unsaved changes" : "All changes saved");
  elements.saveButton.disabled = !state.project || state.saving;
}

async function readTextFile(directory, name, required, originals) {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    const text = await file.text();
    originals[name] = text;
    return text;
  } catch (error) {
    if (required) throw new Error(`Could not read ${name}. Make sure you selected the aTrain output folder itself.`);
    return null;
  }
}

async function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(LOOKUP_TIMED_OUT), timeoutMs);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timeoutId);
  return result;
}

async function findAudio(directory, metadataText) {
  let metadataFilename = "";
  if (metadataText) {
    const match = metadataText.match(/^filename:\s*(.+)$/mi);
    if (match) metadataFilename = match[1].trim();
  }

  if (metadataFilename) {
    try {
      const handle = await withTimeout(
        directory.getFileHandle(metadataFilename),
        AUDIO_LOOKUP_TIMEOUT_MS
      );
      if (handle === LOOKUP_TIMED_OUT) return null;
      return handle;
    } catch (_) {
      // Continue to scan the chosen folder.
    }
  }

  // Some browser/filesystem combinations can leave directory iteration pending
  // indefinitely when no matching media exists. Bound every request so a slow
  // or empty scan can never prevent the transcript itself from opening.
  const iterator = directory.entries()[Symbol.asyncIterator]();
  while (true) {
    const item = await withTimeout(iterator.next(), AUDIO_LOOKUP_TIMEOUT_MS);
    if (item === LOOKUP_TIMED_OUT) {
      if (typeof iterator.return === "function") {
        try {
          Promise.resolve(iterator.return()).catch(() => {});
        } catch (_) {
          // Best-effort cleanup only.
        }
      }
      return null;
    }
    if (item.done) return null;
    const [name, handle] = item.value;
    if (handle.kind === "file" && AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
      return handle;
    }
  }
}

function setAudioFile(file) {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = file || null;
  state.audioUrl = file ? URL.createObjectURL(file) : null;
  elements.audioPlayer.classList.toggle("hidden", !file);
  elements.audioMissing.classList.toggle("hidden", Boolean(file));
  elements.audioPlayer.removeAttribute("src");
  if (file) elements.audioPlayer.src = state.audioUrl;
  elements.audioPlayer.load();
}

async function chooseAudioFile() {
  if (!window.showOpenFilePicker) {
    showMessage("Browser not supported", "Please choose the recording in Microsoft Edge or Google Chrome.");
    return false;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Audio recordings",
        accept: {
          "audio/*": AUDIO_EXTENSIONS,
          "video/mp4": [".mp4"]
        }
      }]
    });
    const file = await handle.getFile();
    setAudioFile(file);
    elements.projectTitle.title = `Audio: ${file.name}`;
    await updateRecentAudioHandle(handle);
    return true;
  } catch (error) {
    if (error.name !== "AbortError") showMessage("Could not open audio", error.message);
    return false;
  }
}

function projectIdFromMetadata(metadataText, directoryName) {
  const match = metadataText?.match(/^file_id:\s*(.+)$/mi);
  return match ? match[1].trim() : directoryName;
}

async function openProject() {
  if (!window.showDirectoryPicker) {
    showMessage(
      "Browser not supported",
      "Please open this reviewer in a current version of Microsoft Edge or Google Chrome. The folder-saving feature is not available in this browser."
    );
    return;
  }

  if (state.dirty && !confirm("Open another folder and discard unsaved changes?")) return;

  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    await loadProject(directory, null);
  } catch (error) {
    if (error.name !== "AbortError") showMessage("Could not open project", error.message);
  }
}

async function ensurePermission(handle, mode) {
  const options = { mode };
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission(options);
    if (current === "granted") return true;
  }
  if (typeof handle.requestPermission !== "function") return false;
  return (await handle.requestPermission(options)) === "granted";
}

async function fileFromRememberedAudio(record) {
  const handle = record?.audioHandle;
  if (!handle) return null;
  try {
    const permitted = await ensurePermission(handle, "read");
    return permitted ? await handle.getFile() : null;
  } catch (_) {
    return null;
  }
}

async function loadProject(directory, recentRecord) {
  const permission = await ensurePermission(directory, "readwrite");
  if (!permission) throw new Error("Read/write access to the folder was not granted.");

  const originals = {};
  const jsonText = await readTextFile(directory, "transcription.json", true, originals);
  const metadataText = await readTextFile(directory, "metadata.txt", false, originals);
  for (const name of OUTPUT_NAMES.filter((name) => name !== "transcription.json")) {
    await readTextFile(directory, name, false, originals);
  }

  const raw = JSON.parse(jsonText);
  const projectId = projectIdFromMetadata(metadataText, directory.name);
  const project = Core.normalizeProject(raw, projectId);
  const audioHandle = await findAudio(directory, metadataText);
  let audioFile = audioHandle ? await audioHandle.getFile() : null;
  if (!audioFile) audioFile = await fileFromRememberedAudio(recentRecord);

  state.directory = directory;
  state.project = project;
  state.originals = originals;
  state.backupCreated = false;
  state.activeId = null;
  state.recentKey = recentRecord?.key || null;
  setAudioFile(audioFile);
  elements.projectPath.textContent = directory.name;
  elements.projectTitle.textContent = projectId;
  elements.projectTitle.title = audioFile ? `Audio: ${audioFile.name}` : "No audio selected";
  elements.speakerInSrt.checked = raw.reviewer?.srt_includes_speakers !== false;

  renderAll();
  elements.welcomePanel.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  setDirty(false, "Loaded — no unsaved changes");

  try {
    state.recentKey = await rememberRecentProject(
      directory,
      projectId,
      audioHandle ? null : (recentRecord?.audioHandle || undefined)
    );
  } catch (_) {
    // Recent-project storage is optional.
  }

  if (!audioFile) {
    showMessage(
      "Recording not found",
      "The transcript is open. Use “Choose audio file” to locate its recording elsewhere on this computer."
    );
  }
}

async function openRecentProject(record) {
  if (state.dirty && !confirm("Open another folder and discard unsaved changes?")) return;
  if (elements.recentProjectsDialog.open) elements.recentProjectsDialog.close();
  try {
    await loadProject(record.directoryHandle, record);
  } catch (error) {
    if (error.name === "AbortError") return;
    showMessage(
      "Could not reopen transcript",
      `${error.message}\n\nThe folder may have moved, or access may need to be granted again. You can still use “Open aTrain folder” to locate it.`
    );
  }
}

function renderAll() {
  renderSpeakers();
  renderSpeakerFilter();
  renderSegments();
  updateProgress();
}

function renderSpeakers() {
  elements.speakerList.replaceChildren();
  state.project.speakerOrder.forEach((id) => {
    const speaker = state.project.speakers[id];
    const row = document.createElement("div");
    row.className = "speaker-row";

    const swatch = document.createElement("span");
    swatch.className = "speaker-swatch";
    swatch.style.backgroundColor = speaker.color;

    const input = document.createElement("input");
    input.className = "speaker-name";
    input.type = "text";
    input.value = speaker.name;
    input.setAttribute("aria-label", `Display name for ${id}`);
    input.addEventListener("input", () => {
      speaker.name = input.value.trim() || id;
      updateSpeakerLabels(id);
      setDirty(true);
    });

    const sourceId = document.createElement("span");
    sourceId.className = "speaker-id";
    sourceId.textContent = id === Core.UNASSIGNED ? "No aTrain speaker assigned" : id;

    row.append(swatch, input, sourceId);
    elements.speakerList.append(row);
  });
}

function renderSpeakerFilter() {
  const previous = elements.speakerFilter.value;
  elements.speakerFilter.replaceChildren(new Option("All speakers", ""));
  state.project.speakerOrder.forEach((id) => {
    elements.speakerFilter.add(new Option(Core.speakerName(state.project, id), id));
  });
  if (state.project.speakers[previous]) elements.speakerFilter.value = previous;
}

function speakerOptions(selectedId) {
  const fragment = document.createDocumentFragment();
  state.project.speakerOrder.forEach((id) => {
    fragment.append(new Option(Core.speakerName(state.project, id), id, false, id === selectedId));
  });
  return fragment;
}

function fitTextarea(textarea) {
  textarea.style.height = "0";
  textarea.style.height = `${Math.max(32, textarea.scrollHeight)}px`;
}

function fitAllTextareas() {
  const textareas = Array.from(document.querySelectorAll(".segment-text"));

  // Avoid alternating a style write and a layout read for every passage.
  // With a complete transcript, that repeatedly recalculated the height of
  // the entire growing page and could make Chromium report it unresponsive.
  textareas.forEach((textarea) => {
    textarea.style.height = "0";
  });
  const heights = textareas.map((textarea) => Math.max(32, textarea.scrollHeight));
  textareas.forEach((textarea, index) => {
    textarea.style.height = `${heights[index]}px`;
  });
}

function renderSegments() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const speakerFilter = elements.speakerFilter.value;
  const reviewFilter = elements.reviewFilter.value;
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;
  let previousVisibleSpeaker = null;

  state.project.segments.forEach((segment, index) => {
    const name = Core.speakerName(state.project, segment.speakerId);
    const matchesQuery = !query || segment.text.toLocaleLowerCase().includes(query)
      || name.toLocaleLowerCase().includes(query);
    const matchesSpeaker = !speakerFilter || segment.speakerId === speakerFilter;
    const matchesReview = !reviewFilter
      || (reviewFilter === "reviewed" && segment.reviewed)
      || (reviewFilter === "unreviewed" && !segment.reviewed);
    if (!matchesQuery || !matchesSpeaker || !matchesReview) return;

    visibleCount += 1;
    const card = document.createElement("article");
    card.className = "segment";
    card.dataset.segmentId = String(segment.id);
    card.title = `Passage ${index + 1}`;
    card.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId]?.color || "#657786");
    if (segment.changed) card.classList.add("changed");
    if (segment.id === state.activeId) card.classList.add("active");
    if (previousVisibleSpeaker !== null && previousVisibleSpeaker !== segment.speakerId) {
      card.classList.add("speaker-break");
    }
    previousVisibleSpeaker = segment.speakerId;

    const meta = document.createElement("div");
    meta.className = "segment-meta";
    const timestamp = document.createElement("button");
    timestamp.className = "timestamp";
    timestamp.type = "button";
    timestamp.textContent = Core.formatClock(segment.start, false);
    timestamp.title = "Play from this passage";
    timestamp.addEventListener("click", () => playFrom(segment.start));
    const number = document.createElement("span");
    number.className = "segment-number";
    number.textContent = `Passage ${index + 1}`;
    meta.append(timestamp, number);

    const editor = document.createElement("div");
    editor.className = "segment-editor";
    const select = document.createElement("select");
    select.className = "segment-speaker";
    select.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId]?.color || "#657786");
    select.dataset.speakerSelect = "true";
    select.append(speakerOptions(segment.speakerId));
    select.addEventListener("change", () => {
      segment.speakerId = select.value;
      segment.changed = true;
      card.classList.add("changed");
      card.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId].color);
      select.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId].color);
      setDirty(true);
      updateProgress();
      renderSegments();
    });
    const textarea = document.createElement("textarea");
    textarea.className = "segment-text";
    textarea.value = segment.text;
    textarea.spellcheck = true;
    textarea.addEventListener("input", () => {
      segment.text = textarea.value;
      segment.changed = true;
      card.classList.add("changed");
      fitTextarea(textarea);
      setDirty(true);
    });
    textarea.addEventListener("focus", () => setActiveSegment(segment.id, false));
    editor.append(select, textarea);

    const review = document.createElement("label");
    review.className = "review-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = segment.reviewed;
    checkbox.title = "Mark passage reviewed";
    checkbox.addEventListener("change", () => {
      segment.reviewed = checkbox.checked;
      segment.changed = true;
      card.classList.add("changed");
      setDirty(true);
      updateProgress();
      if (elements.reviewFilter.value) renderSegments();
    });
    review.append(checkbox, document.createTextNode("Reviewed"));

    card.append(meta, editor, review);
    fragment.append(card);
  });

  elements.segmentList.replaceChildren(fragment);
  elements.emptyFilterMessage.classList.toggle("hidden", visibleCount !== 0);
  requestAnimationFrame(fitAllTextareas);
}

function updateSpeakerLabels(id) {
  renderSpeakerFilter();
  document.querySelectorAll("[data-speaker-select]").forEach((select) => {
    const current = select.value;
    Array.from(select.options).forEach((option) => {
      if (option.value === id) option.textContent = Core.speakerName(state.project, id);
    });
    select.value = current;
  });
}

function addSpeaker() {
  const existingNumbers = state.project.speakerOrder
    .map((id) => /^SPEAKER_(\d+)$/.exec(id))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const next = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 0;
  const id = `SPEAKER_${String(next).padStart(2, "0")}`;
  state.project.speakers[id] = {
    id,
    name: `Speaker ${next + 1}`,
    color: Core.PALETTE[state.project.speakerOrder.length % Core.PALETTE.length]
  };
  state.project.speakerOrder.push(id);
  renderSpeakers();
  renderSpeakerFilter();
  renderSegments();
  setDirty(true);
}

function toggleSpeakerPanel() {
  const collapsed = elements.contentGrid.classList.toggle("speakers-collapsed");
  elements.toggleSpeakerPanelButton.setAttribute("aria-expanded", String(!collapsed));
  elements.toggleSpeakerPanelButton.title = collapsed
    ? "Expand speakers panel"
    : "Collapse speakers panel";
  try {
    localStorage.setItem("atrain-reviewer-speakers-collapsed", collapsed ? "1" : "0");
  } catch (_) {
    // The layout preference is optional.
  }
  setTimeout(fitAllTextareas, 180);
}

function updateProgress() {
  const total = state.project.segments.length;
  const reviewed = state.project.segments.filter((segment) => segment.reviewed).length;
  elements.reviewCount.textContent = `${reviewed} / ${total} reviewed`;
  elements.progressBar.style.width = total ? `${(reviewed / total) * 100}%` : "0%";
}

function playFrom(seconds) {
  elements.audioPlayer.currentTime = Math.max(0, seconds);
  elements.audioPlayer.play().catch(() => {});
}

function setActiveSegment(id, scroll) {
  if (state.activeId === id) return;
  const previous = document.querySelector(".segment.active");
  if (previous) previous.classList.remove("active");
  state.activeId = id;
  const card = document.querySelector(`.segment[data-segment-id="${CSS.escape(String(id))}"]`);
  if (card) {
    card.classList.add("active");
    if (scroll && elements.followPlayback.checked) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function syncPlayback() {
  if (!state.project) return;
  const current = elements.audioPlayer.currentTime;
  let active = null;
  for (const segment of state.project.segments) {
    if (current >= segment.start && current <= segment.end + 0.15) {
      active = segment;
      break;
    }
    if (segment.start <= current) active = segment;
    if (segment.start > current) break;
  }
  if (active) setActiveSegment(active.id, true);
  elements.timeDisplay.textContent =
    `${shortClock(current)} / ${shortClock(elements.audioPlayer.duration)}`;
}

function shortClock(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function writeText(directory, name, text) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function backupFolderName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `Transcript Reviewer Backup ${stamp}`;
}

async function createBackup() {
  if (state.backupCreated) return;
  const backup = await state.directory.getDirectoryHandle(backupFolderName(), { create: true });
  for (const [name, text] of Object.entries(state.originals)) {
    if (text != null) await writeText(backup, name, text);
  }
  state.backupCreated = true;
}

async function saveProject() {
  if (!state.project || state.saving) return;
  state.saving = true;
  elements.saveButton.disabled = true;
  elements.saveStatus.textContent = "Saving…";
  try {
    const permission = await state.directory.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("Write access to the project folder was not granted.");
    await createBackup();
    const outputs = Core.makeExports(state.project, {
      speakerInSrt: elements.speakerInSrt.checked,
      updatedAt: new Date().toISOString()
    });
    for (const [name, text] of Object.entries(outputs)) {
      await writeText(state.directory, name, text);
    }
    state.project.raw = JSON.parse(outputs["transcription.json"]);
    state.project.segments.forEach((segment) => { segment.changed = false; });
    setDirty(false, "Saved JSON and all transcript exports");
    renderSegments();
  } catch (error) {
    setDirty(true, "Save failed");
    showMessage("Could not save changes", error.message);
  } finally {
    state.saving = false;
    elements.saveButton.disabled = !state.project;
  }
}

function onGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject();
    return;
  }
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (event.code === "Space" && !editing) {
    event.preventDefault();
    if (elements.audioPlayer.paused) elements.audioPlayer.play();
    else elements.audioPlayer.pause();
  }
}

elements.openFolderButton.addEventListener("click", openProject);
elements.welcomeOpenButton.addEventListener("click", openProject);
elements.recentProjectsButton.addEventListener("click", () => {
  if (typeof elements.recentProjectsDialog.showModal === "function") {
    elements.recentProjectsDialog.showModal();
  }
});
elements.saveButton.addEventListener("click", saveProject);
elements.addSpeakerButton.addEventListener("click", addSpeaker);
elements.toggleSpeakerPanelButton.addEventListener("click", toggleSpeakerPanel);
elements.chooseAudioButton.addEventListener("click", chooseAudioFile);
elements.backButton.addEventListener("click", () => {
  elements.audioPlayer.currentTime = Math.max(0, elements.audioPlayer.currentTime - 5);
});
elements.forwardButton.addEventListener("click", () => {
  elements.audioPlayer.currentTime = Math.min(
    elements.audioPlayer.duration || Infinity,
    elements.audioPlayer.currentTime + 5
  );
});
elements.playButton.addEventListener("click", () => {
  if (elements.audioPlayer.paused) elements.audioPlayer.play();
  else elements.audioPlayer.pause();
});
elements.speedSelect.addEventListener("change", () => {
  elements.audioPlayer.playbackRate = Number(elements.speedSelect.value);
});
elements.audioPlayer.addEventListener("play", () => { elements.playButton.textContent = "Pause"; });
elements.audioPlayer.addEventListener("pause", () => { elements.playButton.textContent = "Play"; });
elements.audioPlayer.addEventListener("timeupdate", syncPlayback);
elements.audioPlayer.addEventListener("loadedmetadata", syncPlayback);
elements.searchInput.addEventListener("input", renderSegments);
elements.speakerFilter.addEventListener("change", renderSegments);
elements.reviewFilter.addEventListener("change", renderSegments);
elements.speakerInSrt.addEventListener("change", () => setDirty(true));
window.addEventListener("keydown", onGlobalKeydown);
window.addEventListener("resize", () => requestAnimationFrame(fitAllTextareas));
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

try {
  if (localStorage.getItem("atrain-reviewer-speakers-collapsed") === "1") {
    elements.contentGrid.classList.add("speakers-collapsed");
    elements.toggleSpeakerPanelButton.setAttribute("aria-expanded", "false");
    elements.toggleSpeakerPanelButton.title = "Expand speakers panel";
  }
} catch (_) {
  // The layout preference is optional.
}

refreshRecentProjects();
