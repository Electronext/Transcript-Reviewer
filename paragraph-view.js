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

function paragraphStartsForSpeaker(speakerId) {
  if (!state.project) return [];
  return state.project.segments.filter((segment, index, segments) => {
    if (segment.speakerId !== speakerId) return false;
    if (index === 0) return true;
    const previous = segments[index - 1];
    return previous.speakerId !== speakerId || Boolean(segment.paragraphBreakBefore);
  });
}

function segmentSourceIndex(segment) {
  return state.project.segments.findIndex((item) => String(item.id) === String(segment.id));
}

function activeSourceIndex() {
  if (state.activeId == null) return -1;
  return state.project.segments.findIndex((segment) => String(segment.id) === String(state.activeId));
}

function revealSegment(segment) {
  if (!segment) return;

  let token = document.querySelector(`.segment[data-segment-id="${CSS.escape(String(segment.id))}"]`);
  if (!token) {
    // Speaker navigation should reveal the contribution in conversational
    // context rather than leave it hidden by an unrelated filter.
    elements.searchInput.value = "";
    elements.speakerFilter.value = "";
    elements.reviewFilter.value = "";
    renderParagraphs();
    token = document.querySelector(`.segment[data-segment-id="${CSS.escape(String(segment.id))}"]`);
  }

  state.activeId = segment.id;
  document.querySelectorAll(".paragraph-segment.active").forEach((item) => item.classList.remove("active"));
  if (!token) return;
  token.classList.add("active");
  (token.closest(".transcript-paragraph") || token).scrollIntoView({ behavior: "smooth", block: "center" });
}

function jumpToFirstSpeakerParagraph(speakerId) {
  revealSegment(paragraphStartsForSpeaker(speakerId)[0]);
}

function jumpToNextSpeakerParagraph(speakerId) {
  const starts = paragraphStartsForSpeaker(speakerId);
  if (!starts.length) return;
  const activeIndex = activeSourceIndex();
  const target = starts.find((segment) => segmentSourceIndex(segment) > activeIndex) || starts[0];
  revealSegment(target);
}

function jumpToPreviousSpeakerParagraph(speakerId) {
  const starts = paragraphStartsForSpeaker(speakerId);
  if (!starts.length) return;
  const activeIndex = activeSourceIndex();
  let target = starts[starts.length - 1];
  if (activeIndex >= 0) {
    const earlier = starts.filter((segment) => segmentSourceIndex(segment) < activeIndex);
    if (earlier.length) target = earlier[earlier.length - 1];
  }
  revealSegment(target);
}

function speakerNavButton(label, title, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "speaker-jump-button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", handler);
  return button;
}

function renderParagraphSpeakers() {
  elements.speakerList.replaceChildren();
  state.project.speakerOrder.forEach((id) => {
    const speaker = state.project.speakers[id];
    const row = document.createElement("div");
    row.className = "speaker-row paragraph-speaker-row";

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
      renderParagraphs();
      setDirty(true);
    });

    const sourceId = document.createElement("span");
    sourceId.className = "speaker-id";
    sourceId.textContent = id === Core.UNASSIGNED ? "No aTrain speaker assigned" : id;

    const navigation = document.createElement("div");
    navigation.className = "speaker-jump-controls";
    navigation.append(
      speakerNavButton("‹", `Previous ${speaker.name} paragraph`, () => jumpToPreviousSpeakerParagraph(id)),
      speakerNavButton("First", `First ${speaker.name} paragraph`, () => jumpToFirstSpeakerParagraph(id)),
      speakerNavButton("›", `Next ${speaker.name} paragraph`, () => jumpToNextSpeakerParagraph(id))
    );

    row.append(swatch, input, sourceId, navigation);
    elements.speakerList.append(row);
  });
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

  const tools = document.createElement("span");
  tools.className = "segment-tools";

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

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "segment-menu-button";
  menu.textContent = "⋯";
  menu.title = "Segment options";
  menu.setAttribute("aria-label", `Options for segment at ${Core.formatClock(segment.start, false)}`);
  menu.setAttribute("aria-expanded", "false");
  tools.append(timestamp, menu);

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

  token.append(tools, text);
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

// Replace the legacy passage-card presentation while retaining app.js file,
// audio and persistence behaviour.
renderSegments = renderParagraphs;
renderSpeakers = renderParagraphSpeakers;
fitTextarea = () => {};
fitAllTextareas = () => {};

// app.js registered filter listeners before this layer loaded, so add a final
// render after those legacy handlers. The paragraph view is therefore the DOM
// state left visible to the user.
elements.searchInput.addEventListener("input", renderParagraphs);
elements.speakerFilter.addEventListener("change", renderParagraphs);
elements.reviewFilter.addEventListener("change", renderParagraphs);

// If this script is introduced while a project is already open, redraw it.
if (state.project) {
  renderParagraphSpeakers();
  renderParagraphs();
}
