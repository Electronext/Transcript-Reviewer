(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeetingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MANIFEST_SCHEMA = "atrain-meeting-manifest";
  const MANIFEST_SCHEMA_VERSION = 1;
  const PROCESSING_SCHEMA = "atrain-meeting-processing-input";
  const PROCESSING_SCHEMA_VERSION = 1;

  function cleanText(value) {
    return String(value == null ? "" : value).trim();
  }

  function requireId(value, label) {
    const id = cleanText(value);
    if (!id) throw new Error(`${label} is required.`);
    return id;
  }

  function unique(values, label) {
    const seen = new Set();
    values.forEach((value) => {
      if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
      seen.add(value);
    });
  }

  function normaliseStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(cleanText).filter(Boolean);
  }

  function normalizeManifest(input) {
    if (!input || typeof input !== "object") throw new Error("Meeting manifest must be an object.");
    const meeting = input.meeting || {};
    const recordings = Array.isArray(input.recordings) ? input.recordings : [];
    if (!recordings.length) throw new Error("Meeting manifest must contain at least one recording.");

    const normalized = {
      schema: MANIFEST_SCHEMA,
      schema_version: MANIFEST_SCHEMA_VERSION,
      meeting: {
        id: requireId(meeting.id, "Meeting id"),
        title: cleanText(meeting.title) || requireId(meeting.id, "Meeting id"),
        date: cleanText(meeting.date) || null,
        status: cleanText(meeting.status) || "review",
        assigned_reviewer_ids: normaliseStringArray(meeting.assigned_reviewer_ids)
      },
      recordings: recordings.map((recording, index) => ({
        id: requireId(recording.id, `Recording ${index + 1} id`),
        order: Number.isFinite(Number(recording.order)) ? Number(recording.order) : index + 1,
        label: cleanText(recording.label) || `Part ${index + 1}`,
        project_id: cleanText(recording.project_id) || null,
        source_ref: cleanText(recording.source_ref) || null,
        audio_ref: cleanText(recording.audio_ref) || null,
        transcript_ref: cleanText(recording.transcript_ref) || null
      })),
      people: Array.isArray(input.people) ? input.people.map((person, index) => ({
        id: requireId(person.id, `Person ${index + 1} id`),
        name: cleanText(person.name) || requireId(person.id, `Person ${index + 1} id`),
        aliases: normaliseStringArray(person.aliases),
        roles: normaliseStringArray(person.roles)
      })) : [],
      speaker_mappings: Array.isArray(input.speaker_mappings)
        ? input.speaker_mappings.map((mapping, index) => ({
          recording_id: requireId(mapping.recording_id, `Speaker mapping ${index + 1} recording_id`),
          speaker_id: requireId(mapping.speaker_id, `Speaker mapping ${index + 1} speaker_id`),
          person_id: cleanText(mapping.person_id) || null
        }))
        : [],
      context: input.context && typeof input.context === "object"
        ? JSON.parse(JSON.stringify(input.context))
        : {}
    };

    unique(normalized.recordings.map((recording) => recording.id), "recording id");
    unique(normalized.recordings.map((recording) => recording.order), "recording order");
    unique(normalized.people.map((person) => person.id), "person id");

    const recordingIds = new Set(normalized.recordings.map((recording) => recording.id));
    const personIds = new Set(normalized.people.map((person) => person.id));
    normalized.speaker_mappings.forEach((mapping) => {
      if (!recordingIds.has(mapping.recording_id)) {
        throw new Error(`Speaker mapping references unknown recording: ${mapping.recording_id}`);
      }
      if (mapping.person_id && !personIds.has(mapping.person_id)) {
        throw new Error(`Speaker mapping references unknown person: ${mapping.person_id}`);
      }
    });

    unique(
      normalized.speaker_mappings.map((mapping) => `${mapping.recording_id}\u0000${mapping.speaker_id}`),
      "recording/speaker mapping"
    );

    normalized.recordings.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return normalized;
  }

  function buildSingleRecordingManifest(project, options) {
    if (!project || !Array.isArray(project.segments)) throw new Error("A normalized transcript project is required.");
    const opts = options || {};
    const recordingId = requireId(opts.recordingId || "recording-1", "Recording id");
    const projectId = cleanText(project.projectId) || recordingId;
    const meetingId = requireId(opts.meetingId || `meeting-${projectId}`, "Meeting id");
    return normalizeManifest({
      meeting: {
        id: meetingId,
        title: opts.title || projectId,
        date: opts.date || null,
        status: opts.status || "review",
        assigned_reviewer_ids: opts.assignedReviewerIds || []
      },
      recordings: [{
        id: recordingId,
        order: 1,
        label: opts.recordingLabel || "Part 1",
        project_id: projectId,
        source_ref: opts.sourceRef || null,
        audio_ref: opts.audioRef || null,
        transcript_ref: opts.transcriptRef || null
      }],
      people: opts.people || [],
      speaker_mappings: opts.speakerMappings || [],
      context: opts.context || {}
    });
  }

  function processingRef(recordingId, segmentId) {
    return `${String(recordingId)}:${String(segmentId)}`;
  }

  function personIndex(manifest) {
    return new Map(manifest.people.map((person) => [person.id, person]));
  }

  function mappingIndex(manifest) {
    return new Map(manifest.speaker_mappings.map((mapping) => [
      `${mapping.recording_id}\u0000${mapping.speaker_id}`,
      mapping.person_id
    ]));
  }

  function speakerDisplayName(project, speakerId) {
    return project.speakers?.[speakerId]?.name || String(speakerId || "Unassigned");
  }

  function buildMeetingProcessingPayload(manifestInput, recordingProjects) {
    const manifest = normalizeManifest(manifestInput);
    const projects = recordingProjects instanceof Map
      ? recordingProjects
      : new Map(Object.entries(recordingProjects || {}));
    const people = personIndex(manifest);
    const mappings = mappingIndex(manifest);

    const recordings = manifest.recordings.map((recording) => {
      const project = projects.get(recording.id);
      if (!project || !Array.isArray(project.segments)) {
        throw new Error(`Missing normalized transcript project for recording ${recording.id}.`);
      }

      const speakers = (project.speakerOrder || Object.keys(project.speakers || {})).map((speakerId) => {
        const personId = mappings.get(`${recording.id}\u0000${speakerId}`) || null;
        const person = personId ? people.get(personId) : null;
        return {
          recording_speaker_id: String(speakerId),
          display_name: speakerDisplayName(project, speakerId),
          person_id: personId,
          person_name: person?.name || null
        };
      });

      const segments = project.segments.map((segment) => {
        const localSpeakerId = String(segment.speakerId == null ? "" : segment.speakerId);
        const personId = mappings.get(`${recording.id}\u0000${localSpeakerId}`) || null;
        const person = personId ? people.get(personId) : null;
        const note = cleanText(project.stageNotes?.[String(segment.id)]);
        return {
          ref: processingRef(recording.id, segment.id),
          recording_id: recording.id,
          segment_id: segment.id,
          start_seconds: Number(segment.start) || 0,
          end_seconds: Number(segment.end) || Number(segment.start) || 0,
          text: cleanText(segment.text),
          speaker: {
            recording_speaker_id: localSpeakerId || null,
            display_name: speakerDisplayName(project, localSpeakerId),
            person_id: personId,
            person_name: person?.name || null
          },
          reviewed: Boolean(segment.reviewed),
          paragraph_break_before: Boolean(segment.paragraphBreakBefore),
          excluded_from_output: Boolean(segment.excludedFromOutput),
          reviewer_note: note || null
        };
      });

      return {
        id: recording.id,
        order: recording.order,
        label: recording.label,
        project_id: recording.project_id || project.projectId || null,
        speakers,
        segments
      };
    });

    return {
      schema: PROCESSING_SCHEMA,
      schema_version: PROCESSING_SCHEMA_VERSION,
      meeting: JSON.parse(JSON.stringify(manifest.meeting)),
      context: JSON.parse(JSON.stringify(manifest.context || {})),
      people: JSON.parse(JSON.stringify(manifest.people)),
      recordings
    };
  }

  return {
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
    PROCESSING_SCHEMA,
    PROCESSING_SCHEMA_VERSION,
    normalizeManifest,
    buildSingleRecordingManifest,
    processingRef,
    buildMeetingProcessingPayload
  };
});
