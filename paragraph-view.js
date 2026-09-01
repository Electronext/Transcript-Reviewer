"use strict";

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

function speakerParagraphPosition(speakerId) {
  const starts = paragraphStartsForSpeaker(speakerId);
  const total = starts.length;
  if (!total) return { current: 0, total: 0 };
  const activeIndex = activeSourceIndex();
  if (activeIndex < 0) return { current: 0, total };
  const current = starts.filter((segment) => segmentSourceIndex(segment) <= activeIndex).length;
  return { current, total };
}

function updateSpeakerJumpStatuses() {
  document.querySelectorAll(".speaker-jump-status[data-speaker-id]").forEach((status) => {
    const position = speakerParagraphPosition(status.dataset.speakerId);
    status.textContent = `${position.current} of ${position.total}`;
  });
}

function revealSegment(segment) {
  if (!segment) return;
  let token = document.querySelector(`.segment[data-segment-id="${CSS.escape(String(segment.id))}"]`);
  if (!token) {
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
  updateSpeakerJumpStatuses();
}

function jumpToFirstSpeakerParagraph(speakerId) {
  revealSegment(paragraphStartsForSpeaker(speakerId)[0]);
}

function jumpToNextSpeakerParagraph(speakerId) {
  const starts = paragraphStartsForSpeaker(speakerId);
  if (!starts.length) return;
  const activeIndex = activeSourceIndex();
  revealSegment(starts.find((segment) => segmentSourceIndex(segment) > activeIndex) || starts[0]);
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
    const status = document.createElement("span");
    status.className = "speaker-jump-status";
    status.dataset.speakerId = id;
    const position = speakerParagraphPosition(id);
    status.textContent = `${position.current} of ${position.total}`;
    navigation.append(
      speakerNavButton("‹", `Previous ${speaker.name} paragraph`, () => jumpToPreviousSpeakerParagraph(id)),
      speakerNavButton("First", `First ${speaker.name} paragraph`, () => jumpToFirstSpeakerParagraph(id)),
      speakerNavButton("›", `Next ${speaker.name} paragraph`, () => jumpToNextSpeakerParagraph(id)),
      status
    );
    row.append(swatch, input, sourceId, navigation);
    elements.speakerList.append(row);
  });
}

function closePassageMenu() {
  document.querySelectorAll(".passage-context-menu").forEach((menu) => menu.remove());
}

function positionPopup(menu, x, y) {
  const margin = 8;
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - rect.width - margin));
  const top = Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "visible";
}

function openPassageMenu(segment, x, y) {
  closePassageMenu();
  setActiveSegment(segment.id, false);
  updateSpeakerJumpStatuses();

  const menu = document.createElement("div");
  menu.className = "passage-context-menu";
  menu.setAttribute("role", "menu");

  const heading = document.createElement("div");
  heading.className = "context-menu-heading";
  heading.textContent = `Passage · ${Core.formatClock(segment.start, false)}`;

  const speakerLabel = document.createElement("label");
  speakerLabel.className = "context-menu-row";
  speakerLabel.append(document.createTextNode("Speaker"));
  const speaker = makeSpeakerSelect(segment.speakerId, (speakerId) => {
    segment.speakerId = speakerId;
    markSegmentChanged(segment);
    closePassageMenu();
    renderParagraphs();
    renderParagraphSpeakers();
  }, "context-speaker-select");
  speakerLabel.append(speaker);

  const reviewedLabel = document.createElement("label");
  reviewedLabel.className = "context-menu-check";
  const reviewed = document.createElement("input");
  reviewed.type = "checkbox";
  reviewed.checked = segment.reviewed;
  reviewed.addEventListener("change", () => {
    segment.reviewed = reviewed.checked;
    markSegmentChanged(segment);
    closePassageMenu();
    renderParagraphs();
  });
  reviewedLabel.append(reviewed, document.createTextNode("Passage reviewed"));

  menu.append(heading, speakerLabel, reviewedLabel);

  const index = segmentSourceIndex(segment);
  const previous = index > 0 ? state.project.segments[index - 1] : null;
  if (segment.paragraphBreakBefore && previous && previous.speakerId === segment.speakerId) {
    const join = document.createElement("button");
    join.type = "button";
    join.className = "context-menu-action";
    join.textContent = "Join previous paragraph";
    join.addEventListener("click", () => {
      segment.paragraphBreakBefore = false;
      markSegmentChanged(segment);
      closePassageMenu();
      renderParagraphs();
      renderParagraphSpeakers();
    });
    menu.append(join);
  }

  positionPopup(menu, x, y);
}

function makeSegmentToken(segment) {
  const token = document.createElement("span");
  token.className = "segment paragraph-segment";
  token.dataset.segmentId = String(segment.id);
  token.style.setProperty("--speaker-color", state.project.speakers[segment.speakerId]?.color || "#657786");
  if (segment.changed) token.classList.add("changed");
  if (segment.reviewed) token.classList.add("reviewed");
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

  const split = document.createElement("button");
  split.type = "button";
  split.className = "paragraph-split-button";
  split.textContent = "↵";
  split.title = "Start a new paragraph here";
  split.setAttribute("aria-label", split.title);
  const index = segmentSourceIndex(segment);
  const previous = index > 0 ? state.project.segments[index - 1] : null;
  const alreadyStartsParagraph = !previous
    || previous.speakerId !== segment.speakerId
    || segment.paragraphBreakBefore;
  split.disabled = alreadyStartsParagraph;
  split.addEventListener("click", (event) => {
    event.stopPropagation();
    if (split.disabled) return;
    segment.paragraphBreakBefore = true;
    markSegmentChanged(segment);
    renderParagraphs();
    renderParagraphSpeakers();
  });
  tools.append(timestamp, split);

  const text = document.createElement("span");
  text.className = "segment-inline-text";
  text.contentEditable = "true";
  text.spellcheck = true;
  text.textContent = segment.text;
  text.setAttribute("role", "textbox");
  text.setAttribute("aria-label", `Editable transcript passage at ${Core.formatClock(segment.start, false)}`);
  text.addEventListener("focus", () => {
    setActiveSegment(segment.id, false);
    updateSpeakerJumpStatuses();
  });
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

  token.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openPassageMenu(segment, event.clientX, event.clientY);
  });

  token.append(tools, text);
  return token;
}

function makeParagraph(paragraph) {
  const article = document.createElement("article");
  article.className = "transcript-paragraph";
  article.style.setProperty("--speaker-color", state.project.speakers[paragraph.speakerId]?.color || "#657786");
  const anchorSegment = paragraph.segments[0];
  const fullyExcluded = paragraph.segments.every((segment) => segment.excludedFromOutput);
  const reviewedCount = paragraph.segments.filter((segment) => segment.reviewed).length;
  const fullyReviewed = reviewedCount === paragraph.segments.length;
  if (fullyExcluded) article.classList.add("excluded-from-output");
  if (fullyReviewed) article.classList.add("reviewed-paragraph");
  else if (reviewedCount) article.classList.add("partly-reviewed-paragraph");

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
    renderParagraphs();
    renderParagraphSpeakers();
  }, "paragraph-speaker");
  speaker.title = "Change the speaker for this whole paragraph";

  const actions = document.createElement("div");
  actions.className = "paragraph-actions";

  const excludeButton = document.createElement("button");
  excludeButton.type = "button";
  excludeButton.className = "paragraph-action-button";
  excludeButton.textContent = fullyExcluded ? "Restore to output" : "Hide from output";
  excludeButton.title = fullyExcluded
    ? "Include this paragraph in human-facing transcript and final outputs again."
    : "Keep this paragraph for provenance and later-stage context, but exclude it from human-facing transcript and final outputs.";
  excludeButton.addEventListener("click", () => {
    paragraph.segments.forEach((segment) => {
      segment.excludedFromOutput = !fullyExcluded;
      segment.changed = true;
    });
    setDirty(true);
    renderParagraphs();
  });

  const noteButton = document.createElement("button");
  noteButton.type = "button";
  noteButton.className = "paragraph-action-button";
  const anchorKey = String(anchorSegment.id);
  const existingNote = state.project.stageNotes?.[anchorKey] || "";
  noteButton.textContent = existingNote ? "Edit note" : "Add note";
  noteButton.title = "Add context or instructions for the next processing stage. This note is never part of the transcript or final output.";

  const reviewButton = document.createElement("button");
  reviewButton.type = "button";
  reviewButton.className = `paragraph-action-button paragraph-review-button${fullyReviewed ? " reviewed" : ""}`;
  reviewButton.textContent = fullyReviewed
    ? "Reviewed ✓"
    : reviewedCount
      ? `Review ${reviewedCount}/${paragraph.segments.length}`
      : "Review";
  reviewButton.title = fullyReviewed
    ? "Mark this paragraph unreviewed."
    : "Mark every passage in this paragraph reviewed.";
  reviewButton.addEventListener("click", () => {
    const nextReviewed = !fullyReviewed;
    paragraph.segments.forEach((segment) => {
      segment.reviewed = nextReviewed;
      segment.changed = true;
    });
    setDirty(true);
    updateProgress();
    renderParagraphs();
  });

  actions.append(excludeButton, noteButton, reviewButton);
  heading.append(swatch, speaker, actions);

  const noteEditor = document.createElement("div");
  noteEditor.className = `paragraph-note${existingNote ? "" : " hidden"}`;
  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Next-stage note / instruction";
  const noteInput = document.createElement("textarea");
  noteInput.rows = 2;
  noteInput.placeholder = "Extra context or instruction for the next processing stage…";
  noteInput.value = existingNote;
  noteInput.addEventListener("input", () => {
    if (!state.project.stageNotes) state.project.stageNotes = {};
    state.project.stageNotes[anchorKey] = noteInput.value;
    noteButton.textContent = Core.cleanText(noteInput.value) ? "Edit note" : "Add note";
    setDirty(true);
  });
  const noteHint = document.createElement("span");
  noteHint.textContent = "Context only — not included in transcript or final output.";
  noteLabel.append(noteInput, noteHint);
  noteEditor.append(noteLabel);
  noteButton.addEventListener("click", () => {
    noteEditor.classList.toggle("hidden");
    if (!noteEditor.classList.contains("hidden")) noteInput.focus();
  });

  const body = document.createElement("div");
  body.className = "paragraph-body";
  paragraph.segments.forEach((segment) => body.append(makeSegmentToken(segment), document.createTextNode(" ")));

  article.append(heading, noteEditor, body);
  return article;
}

function renderParagraphs() {
  if (!state.project) return;
  closePassageMenu();
  const visible = state.project.segments.filter(segmentMatchesCurrentFilters);
  const paragraphs = makeParagraphs(visible);
  const fragment = document.createDocumentFragment();
  paragraphs.forEach((paragraph) => fragment.append(makeParagraph(paragraph)));
  elements.segmentList.replaceChildren(fragment);
  elements.emptyFilterMessage.classList.toggle("hidden", visible.length !== 0);
}

const baseSetActiveSegment = setActiveSegment;
setActiveSegment = function (id, scroll) {
  baseSetActiveSegment(id, scroll);
  updateSpeakerJumpStatuses();
};

renderSegments = renderParagraphs;
renderSpeakers = renderParagraphSpeakers;
fitTextarea = () => {};
fitAllTextareas = () => {};

elements.searchInput.addEventListener("input", renderParagraphs);
elements.speakerFilter.addEventListener("change", renderParagraphs);
elements.reviewFilter.addEventListener("change", renderParagraphs);

// The legacy application used Space as a global play/pause shortcut. The
// paragraph editor uses ordinary contenteditable text, so Space must remain a
// normal editing key. Capture it before the legacy handler; do not prevent the
// browser's default action, so spaces insert normally wherever focus is.
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") event.stopImmediatePropagation();
}, true);

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".passage-context-menu")) closePassageMenu();
});
window.addEventListener("resize", closePassageMenu);
window.addEventListener("scroll", closePassageMenu, true);

if (state.project) {
  renderParagraphSpeakers();
  renderParagraphs();
  updateSpeakerJumpStatuses();
}
