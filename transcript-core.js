(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TranscriptCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UNASSIGNED = "__UNASSIGNED__";
  const PALETTE = [
    "#276c9a", "#9b4f6d", "#287868", "#ad6a2f", "#6555a5",
    "#50752e", "#a34848", "#356c78", "#8a5b2e", "#6a647d"
  ];

  function cleanText(text) {
    return String(text == null ? "" : text).trim();
  }

  function sourceTitle(projectId) {
    return `Transcription for ${projectId || "aTrain project"}`;
  }

  function pad(value, length) {
    return String(value).padStart(length, "0");
  }

  function formatClock(seconds, includeMillis) {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const wholeSeconds = Math.floor(safe % 60);
    const base = `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}`;
    if (!includeMillis) return base;
    const millis = Math.round((safe - Math.floor(safe)) * 1000);
    return `${base},${pad(Math.min(millis, 999), 3)}`;
  }

  function normalizeProject(raw, projectId) {
    if (!raw || !Array.isArray(raw.segments)) {
      throw new Error("transcription.json does not contain a segments array.");
    }

    const reviewer = raw.reviewer && typeof raw.reviewer === "object" ? raw.reviewer : {};
    const savedSpeakers = reviewer.speakers && typeof reviewer.speakers === "object"
      ? reviewer.speakers : {};
    const reviewedIds = new Set(Array.isArray(reviewer.reviewed_segment_ids)
      ? reviewer.reviewed_segment_ids.map(String) : []);
    const paragraphBreakIds = new Set(Array.isArray(reviewer.paragraph_break_segment_ids)
      ? reviewer.paragraph_break_segment_ids.map(String) : []);
    const excludedIds = new Set(Array.isArray(reviewer.excluded_segment_ids)
      ? reviewer.excluded_segment_ids.map(String) : []);
    const ids = [];

    raw.segments.forEach((segment) => {
      const id = segment.speaker == null || segment.speaker === ""
        ? UNASSIGNED : String(segment.speaker);
      if (!ids.includes(id)) ids.push(id);
    });

    Object.keys(savedSpeakers).forEach((id) => {
      if (!ids.includes(id)) ids.push(id);
    });

    const speakers = {};
    ids.forEach((id, index) => {
      const saved = savedSpeakers[id] || {};
      speakers[id] = {
        id,
        name: saved.name || (id === UNASSIGNED ? "Unassigned" : id),
        color: saved.color || PALETTE[index % PALETTE.length]
      };
    });

    const segments = raw.segments.map((segment, index) => {
      const id = segment.id == null ? index + 1 : segment.id;
      return {
        source: segment,
        id,
        start: Number(segment.start) || 0,
        end: Number(segment.end) || Number(segment.start) || 0,
        text: cleanText(segment.text),
        speakerId: segment.speaker == null || segment.speaker === ""
          ? UNASSIGNED : String(segment.speaker),
        reviewed: reviewedIds.has(String(id)),
        paragraphBreakBefore: paragraphBreakIds.has(String(id)),
        excludedFromOutput: excludedIds.has(String(id)),
        changed: false
      };
    });

    if (segments.length) segments[0].paragraphBreakBefore = false;

    return {
      raw,
      projectId: projectId || reviewer.project_id || "aTrain project",
      segments,
      speakers,
      speakerOrder: ids
    };
  }

  function speakerName(project, speakerId) {
    return project.speakers[speakerId]?.name || (speakerId === UNASSIGNED ? "Unassigned" : speakerId);
  }

  function includedSegments(project) {
    return project.segments.filter((segment) => !segment.excludedFromOutput);
  }

  function buildCorrectedJson(project, options) {
    const copy = JSON.parse(JSON.stringify(project.raw));
    const segmentById = new Map(project.segments.map((segment) => [String(segment.id), segment]));

    copy.segments.forEach((sourceSegment, index) => {
      const id = String(sourceSegment.id == null ? index + 1 : sourceSegment.id);
      const edited = segmentById.get(id);
      if (!edited) return;
      sourceSegment.text = edited.text ? ` ${cleanText(edited.text)}` : "";
      sourceSegment.speaker = edited.speakerId === UNASSIGNED ? null : edited.speakerId;
      if (Array.isArray(sourceSegment.words)) {
        sourceSegment.words.forEach((word) => {
          word.speaker = edited.speakerId === UNASSIGNED ? null : edited.speakerId;
        });
      }
    });

    const speakers = {};
    project.speakerOrder.forEach((id) => {
      speakers[id] = {
        name: speakerName(project, id),
        color: project.speakers[id].color
      };
    });

    copy.reviewer = {
      ...(copy.reviewer && typeof copy.reviewer === "object" ? copy.reviewer : {}),
      schema: "atrain-transcript-reviewer",
      schema_version: 3,
      project_id: project.projectId,
      updated_at: options?.updatedAt || new Date().toISOString(),
      speakers,
      reviewed_segment_ids: project.segments.filter((segment) => segment.reviewed).map((segment) => segment.id),
      paragraph_break_segment_ids: project.segments
        .filter((segment, index) => index > 0 && segment.paragraphBreakBefore)
        .map((segment) => segment.id),
      excluded_segment_ids: project.segments
        .filter((segment) => segment.excludedFromOutput)
        .map((segment) => segment.id),
      srt_includes_speakers: options?.speakerInSrt !== false,
      note: "Segment text and speaker fields are canonical. Paragraph boundaries and output exclusions are reversible reviewer metadata. Excluded segments remain in the canonical transcript for provenance and later processing, but are omitted from human-facing transcript exports. Original word timings are retained; word-level text is not reconstructed after textual corrections."
    };
    return copy;
  }

  function buildSrt(project, includeSpeakers) {
    return includedSegments(project).map((segment, index) => {
      const name = speakerName(project, segment.speakerId);
      const text = cleanText(segment.text);
      const rendered = includeSpeakers ? `${name}: ${text}` : text;
      return [
        index + 1,
        `${formatClock(segment.start, true)} --> ${formatClock(segment.end, true)}`,
        rendered
      ].join("\n");
    }).join("\n\n") + "\n";
  }

  function groupedBlocks(project, withTimestamps, maxqda) {
    const blocks = [];
    let current = null;
    let previousSourceIndex = -2;
    includedSegments(project).forEach((segment) => {
      const sourceIndex = project.segments.indexOf(segment);
      const name = speakerName(project, segment.speakerId);
      const forcedBreak = sourceIndex > 0 && segment.paragraphBreakBefore;
      const discontinuity = sourceIndex !== previousSourceIndex + 1;
      if (!current || current.name !== name || forcedBreak || discontinuity) {
        current = { name, lines: [] };
        blocks.push(current);
      }
      const text = cleanText(segment.text);
      if (withTimestamps) current.lines.push(`[${formatClock(segment.start, false)}] - ${text}`);
      else current.lines.push(text);
      previousSourceIndex = sourceIndex;
    });

    return blocks.map((block) => {
      const body = maxqda ? block.lines.join(" ") : block.lines.join("\n");
      return `${block.name}\n${body}`;
    }).join("\n\n");
  }

  function buildPlainTranscript(project) {
    return `${sourceTitle(project.projectId)}\n\n${groupedBlocks(project, false, false)}\n`;
  }

  function buildTimestampTranscript(project) {
    return `${sourceTitle(project.projectId)}\n\n${groupedBlocks(project, true, false)}\n`;
  }

  function buildMaxqdaTranscript(project) {
    return `${sourceTitle(project.projectId)}\n\n${groupedBlocks(project, true, true)}\n`;
  }

  function buildMarkdownTranscript(project) {
    const blocks = [];
    let current = null;
    let previousSourceIndex = -2;
    includedSegments(project).forEach((segment) => {
      const sourceIndex = project.segments.indexOf(segment);
      const name = speakerName(project, segment.speakerId);
      const forcedBreak = sourceIndex > 0 && segment.paragraphBreakBefore;
      const discontinuity = sourceIndex !== previousSourceIndex + 1;
      if (!current || current.name !== name || forcedBreak || discontinuity) {
        current = { name, rows: [] };
        blocks.push(current);
      }
      current.rows.push(`**[${formatClock(segment.start, false)}]** ${cleanText(segment.text)}`);
      previousSourceIndex = sourceIndex;
    });
    return [
      `# ${sourceTitle(project.projectId)}`,
      "",
      ...blocks.flatMap((block) => [`## ${block.name}`, "", block.rows.join(" "), ""])
    ].join("\n").trimEnd() + "\n";
  }

  function makeExports(project, options) {
    return {
      "transcription.json": JSON.stringify(buildCorrectedJson(project, options), null, 2) + "\n",
      "transcription.srt": buildSrt(project, options?.speakerInSrt !== false),
      "transcription.txt": buildPlainTranscript(project),
      "transcription_timestamps.txt": buildTimestampTranscript(project),
      "transcription_maxqda.txt": buildMaxqdaTranscript(project),
      "transcription_reviewed.md": buildMarkdownTranscript(project)
    };
  }

  return {
    UNASSIGNED,
    PALETTE,
    cleanText,
    formatClock,
    normalizeProject,
    speakerName,
    includedSegments,
    buildCorrectedJson,
    buildSrt,
    buildPlainTranscript,
    buildTimestampTranscript,
    buildMaxqdaTranscript,
    buildMarkdownTranscript,
    makeExports
  };
});
