"use strict";

// Paragraph-oriented presentation layer. aTrain segments remain the canonical
// timing/edit units; consecutive segments are simply flowed together for review.

function segmentMatchesCurrentFilters(segment) {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const speakerFilter = elements.speakerFilter.value;
  const reviewFilter = elements.reviewFilter.value;
  const name = Core.speakerName(state.project, segment.speakerId);
  const matchesQuery = !query || segment.text.toLocaleLowerCase().includes(query)
    || name.toLocaleLowerCase().includes(query);
  const matchesSpeaker = !speakerFilter || segment.speakerId === speakerFilter;
  const matchesReview = !reviewFilter
    || (reviewFilter === "reviewed" && segment.reviewed)
    || (reviewFilter === "unreviewed" && !segment.reviewed);
  return matchesQuery && matchesSpeaker && matchesReview;
}

function makeParagraphs(segments) {
  const paragraphs = [];
  let current = null;
  let previousSourceIndex = -2;
  segments.forEach((segment) => {
    const sourceIndex = state.project.segments.indexOf(segment);
    const isAdjacent = sourceIndex === previousSourceIndex + 1;
    const startsNew = !current
      || !isAdjacent
      || current.speakerId !== segment.speakerId
      || segment.paragraphBreakBefore;
    if (startsNew) {
      current = { speakerId: segment.speakerId, segments: [] };
      paragraphs.push(current);
    }
    current.segments.push(segment);
    previousSourceIndex = sourceIndex;
  });
  return paragraphs;
}

function markSegmentChanged(segment) {
  segment.changed = true;
  setDirty(true);
  updateProgress();
}

function makeSpeakerSelect(selectedId, onChange, className) {
  const select = document.createElement("select");
  select.className = className;
  select.dataset.speakerSelect = "true";
  select.append(speakerOptions(selectedId));
  select.value = selectedId;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function makeSegmentControls(segment, token) {
  const controls = document.createElement("span");
  controls.className = "inline-segment-controls hidden";

  const previousIndex = state.project.segments.findIndex((item) => String(item.id) === String(segment.id)) - 1;
  const previous = previousIndex >= 0 ? state.project.segments[previousIndex] : null;

  const speakerLabel = document.createElement("label");
  speakerLabel.textContent = "Speaker ";
  const speaker = makeSpeakerSelect(segment.speakerId, (speakerId) => {
    segment.speakerId = speakerId;
    markSegmentChanged(segment);
    renderSegments();
  }, "inline-speaker-select");
  speakerLabel.append(speaker);

  const paragraphLabel = document.createElement("label");
  paragraphLabel.className = "inline-check";
  const paragraphCheck = document.createElement("input");
  paragraphCheck.type = "checkbox";
  paragraphCheck.checked = Boolean(segment.paragraphBreakBefore);
  const alreadyBrokenBySpeaker = !previous || previous.speakerId !== segment.speakerId;
  paragraphCheck.disabled = alreadyBrokenBySpeaker;
  paragraphCheck.title = !previous
    ? "The first segment always starts the transcript."
    : alreadyBrokenBySpeaker
      ? "A speaker change already starts a new paragraph."
      : "Start a new paragraph before this segment.";
  paragraphCheck.addEventListener("change", () => {
    segment.paragraphBreakBefore = paragraphCheck.checked;
    markSegmentChanged(segment);
    renderSegments();
  });
  paragraphLabel.append(paragraphCheck, document.createTextNode("Start paragraph"));

  const reviewedLabel = document.createElement("label");
  reviewedLabel.className = "inline-check";
  const reviewed = document.createElement("input");
  reviewed.type = "checkbox";
  reviewed.checked = segment.reviewed;
  reviewed.addEventListener("change", () => {
    segment.reviewed = reviewed.checked;
    markSegmentChanged(segment);
    if (elements.reviewFilter.value) renderSegments();
  });
  reviewedLabel.append(reviewed, document.createTextNode("Reviewed"));

  const close = document.createElement("button");
  close.type = "button";
  close.className = "inline-controls-close";
  close.textContent = "×";
  close.title = "Close segment controls";
  close.addEventListener("click", () => controls.classList.add("hidden"));

  controls.append(speakerLabel, paragraphLabel, reviewedLabel, close);
  token.append(controls);
  return controls;
}

function makeSegmentToken(segment) {
  const token = document.createElement("span");
  token.className = "segment paragraph-segment";
  token.dataset.segmentId = String(segment.id);
  token.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId]?.color || "#657786");
  if (segment.changed) token.classList.add("changed");
  if (String(segment.id) === String(state.activeId)) token.classList.add("active");

  const timestamp = document.createElement("button");
  timestamp.type = "button";
  timestamp.className = "audio-anchor";
  timestamp.textContent = "▶";
  timestamp.title = `Play from ${Core.formatClock(segment.start, false)}`;
  timestamp.setAttribute("aria-label", timestamp.title);
  timestamp.addEventListener("click", (event) => {
    event.stopPropagation();
    playFrom(segment.start);
  });

  const text = document.createElement("span");
  text.className = "segment-inline-text";
  text.contentEditable = "true";
  text.spellcheck = true;
  text.textContent = segment.text;
  text.setAttribute("role", "textbox");
  text.setAttribute("aria-label", `Transcript segment at ${Core.formatClock(segment.start, false)}`);
  text.addEventListener("focus", () => setActiveSegment(segment.id, false));
  text.addEventListener("input", () => {
    segment.text = text.textContent;
    markSegmentChanged(segment);
    token.classList.add("changed");
  });
  text.addEventListener("blur", () => {
    const cleaned = Core.cleanText(text.textContent);
    segment.text = cleaned;
    text.textContent = cleaned;
  });

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "segment-menu-button";
  menu.textContent = "⋯";
  menu.title = "Segment options";
  menu.setAttribute("aria-label", `Options for segment at ${Core.formatClock(segment.start, false)}`);
  menu.setAttribute("aria-expanded", "false");

  token.append(timestamp, text, menu);
  const controls = makeSegmentControls(segment, token);
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".inline-segment-controls:not(.hidden)").forEach((panel) => {
      if (panel !== controls) panel.classList.add("hidden");
    });
    controls.classList.toggle("hidden");
    menu.setAttribute("aria-expanded", String(!controls.classList.contains("hidden")));
  });
  return token;
}

function makeParagraph(paragraph) {
  const article = document.createElement("article");
  article.className = "transcript-paragraph";
  article.style.setProperty("--speaker-color", state.project.speakers[paragraph.speakerId]?.color || "#657786");

  const heading = document.createElement("header");
  heading.className = "paragraph-heading";
  const swatch = document.createElement("span");
  swatch.className = "paragraph-speaker-swatch";
  const speaker = makeSpeakerSelect(paragraph.speakerId, (speakerId) => {
    paragraph.segments.forEach((segment) => {
      segment.speakerId = speakerId;
      segment.changed = true;
    });
    setDirty(true);
    updateProgress();
    renderSegments();
  }, "paragraph-speaker");
  speaker.title = "Change the speaker for this whole paragraph";
  heading.append(swatch, speaker);

  const body = document.createElement("div");
  body.className = "paragraph-body";
  paragraph.segments.forEach((segment) => body.append(makeSegmentToken(segment), document.createTextNode(" ")));

  article.append(heading, body);
  return article;
}

function renderParagraphs() {
  if (!state.project) return;
  const visible = state.project.segments.filter(segmentMatchesCurrentFilters);
  const paragraphs = makeParagraphs(visible);
  const fragment = document.createDocumentFragment();
  paragraphs.forEach((paragraph) => fragment.append(makeParagraph(paragraph)));
  elements.segmentList.replaceChildren(fragment);
  elements.emptyFilterMessage.classList.toggle("hidden", visible.length !== 0);
}

// Replace the segment-card renderer used by renderAll(), saves and speaker edits.
renderSegments = renderParagraphs;
fitTextarea = () => {};
fitAllTextareas = () => {};

// app.js registered filter listeners before this layer loaded, so add a final
// render after those legacy handlers. The paragraph view is therefore the DOM
// state left visible to the user.
elements.searchInput.addEventListener("input", renderParagraphs);
elements.speakerFilter.addEventListener("change", renderParagraphs);
elements.reviewFilter.addEventListener("change", renderParagraphs);

// If this script is introduced while a project is already open, redraw it.
if (state.project) renderParagraphs();
