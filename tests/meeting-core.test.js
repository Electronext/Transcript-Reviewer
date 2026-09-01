"use strict";

const assert = require("assert");
const MeetingCore = require("../meeting-core.js");

function project(projectId, speakerId, segmentId, overrides) {
  return {
    projectId,
    speakerOrder: [speakerId],
    speakers: {
      [speakerId]: { id: speakerId, name: overrides?.speakerName || speakerId }
    },
    stageNotes: overrides?.stageNotes || {},
    segments: [{
      id: segmentId,
      start: overrides?.start ?? 10,
      end: overrides?.end ?? 14,
      text: overrides?.text || "Test segment",
      speakerId,
      reviewed: overrides?.reviewed ?? true,
      paragraphBreakBefore: overrides?.paragraphBreakBefore ?? false,
      excludedFromOutput: overrides?.excludedFromOutput ?? false
    }]
  };
}

(function testMultiRecordingPayloadPreservesProvenance() {
  const manifest = MeetingCore.normalizeManifest({
    meeting: {
      id: "meeting-1",
      title: "Meeting 1",
      assigned_reviewer_ids: []
    },
    recordings: [
      { id: "r1", order: 1, label: "Part 1" },
      { id: "r2", order: 2, label: "Part 2" }
    ],
    people: [{ id: "p1", name: "Same Person" }],
    speaker_mappings: [
      { recording_id: "r1", speaker_id: "SPEAKER_00", person_id: "p1" },
      { recording_id: "r2", speaker_id: "SPEAKER_04", person_id: "p1" }
    ],
    context: { agenda_ref: "context:agenda.docx" }
  });

  const projects = {
    r1: project("aTrain part 1", "SPEAKER_00", 7, {
      speakerName: "Richard",
      text: "First recording",
      stageNotes: { "7": "Use Corps, not core." }
    }),
    r2: project("aTrain part 2", "SPEAKER_04", 7, {
      speakerName: "Richard",
      text: "Second recording",
      excludedFromOutput: true
    })
  };

  const payload = MeetingCore.buildMeetingProcessingPayload(manifest, projects);
  assert.strictEqual(payload.recordings.length, 2);
  assert.strictEqual(payload.recordings[0].segments[0].ref, "r1:7");
  assert.strictEqual(payload.recordings[1].segments[0].ref, "r2:7");
  assert.strictEqual(payload.recordings[0].segments[0].speaker.person_id, "p1");
  assert.strictEqual(payload.recordings[1].segments[0].speaker.person_id, "p1");
  assert.strictEqual(payload.recordings[0].segments[0].reviewer_note, "Use Corps, not core.");
  assert.strictEqual(payload.recordings[1].segments[0].excluded_from_output, true);
  assert.strictEqual(payload.context.agenda_ref, "context:agenda.docx");
})();

(function testExcludedSegmentsAreNotDropped() {
  const manifest = MeetingCore.normalizeManifest({
    meeting: { id: "m", title: "M", assigned_reviewer_ids: [] },
    recordings: [{ id: "r", order: 1, label: "Part 1" }]
  });
  const payload = MeetingCore.buildMeetingProcessingPayload(manifest, {
    r: project("p", "SPEAKER_00", 1, { excludedFromOutput: true })
  });
  assert.strictEqual(payload.recordings[0].segments.length, 1);
  assert.strictEqual(payload.recordings[0].segments[0].excluded_from_output, true);
})();

(function testDuplicateRecordingOrderRejected() {
  assert.throws(() => MeetingCore.normalizeManifest({
    meeting: { id: "m", title: "M", assigned_reviewer_ids: [] },
    recordings: [
      { id: "r1", order: 1, label: "Part 1" },
      { id: "r2", order: 1, label: "Part 2" }
    ]
  }), /Duplicate recording order/);
})();

console.log("meeting-core tests passed");
