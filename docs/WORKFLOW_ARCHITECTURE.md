# Transcript Reviewer — Workflow and Architecture Plan

Status: design baseline, 2026-09-01

This document records decisions made while redesigning the aTrain Transcript Reviewer and sets constraints for the later AI-assisted and hosted workflow. It is intentionally implementation-oriented: future changes should preserve these principles unless a decision is explicitly revisited.

## 1. Purpose

The system starts with one or more recordings transcribed by aTrain. It should support:

1. human review of the rough transcript and diarisation;
2. conservative AI-assisted transcript checking;
3. human review of AI findings;
4. whole-meeting structured extraction;
5. generation and review of meeting minutes and other final outputs.

The original recording remains the evidential authority. AI and editorial context may help interpret it, but must not create evidence that is not present in the meeting.

## 2. Core data hierarchy

Do not assume that one aTrain folder or one recording equals one meeting.

The intended hierarchy is:

```
Meeting
  ├─ Recording 1
  │    ├─ source audio
  │    ├─ aTrain transcript
  │    └─ recording-level review state
  ├─ Recording 2
  │    └─ ...
  ├─ meeting context / agenda / vocabulary
  ├─ cross-recording speaker identities
  ├─ AI findings and review state
  ├─ structured extraction
  └─ final outputs / minutes
```

A meeting may contain one or many recordings. Recording order must be explicit. Timestamps remain relative to their source recording; later stages must retain a recording identifier as well as the segment timestamp so provenance and audio navigation are unambiguous.

### Recording-level work

Initial speaker assignment, transcript correction, paragraph editing and audio checking can be performed independently on each recording because this matches aTrain's source structure and timing.

### Meeting-level work

Semantic analysis, decisions/actions extraction, agenda reconciliation, summary generation and minutes generation operate over the complete meeting and may consume multiple reviewed recordings together.

Speaker IDs produced independently by aTrain must not be assumed to identify the same person across recordings. The meeting layer must be able to map recording-local speaker IDs to meeting-level people.

## 3. Source integrity and provenance

The original uploaded/source material should remain recoverable and, in hosted mode, should preferably be immutable.

The application should distinguish:

- source audio and source aTrain data;
- human transcript corrections;
- editorial paragraph structure;
- speaker corrections/mappings;
- review state;
- exclusions from final output;
- reviewer notes/instructions;
- AI findings and proposals;
- accepted/rejected AI changes;
- generated structured data and final documents.

Do not destructively delete spoken material merely because it should not appear in a final output.

### Excluded material

A paragraph can be marked `excluded_from_output` (currently persisted at constituent-segment level so the state survives paragraph regrouping).

Excluded material:

- remains in the canonical reviewed transcript/project data;
- remains available for provenance and chronology;
- may be supplied to later AI stages with an explicit exclusion flag;
- must not be promoted into final minutes, decisions, actions or other user-facing final output unless a reviewer explicitly restores it.

The reviewer UI should visually dim excluded material without making it look selected or highlighted.

### Reviewer notes / next-stage instructions

Reviewers may attach non-spoken context or instructions to a paragraph. These are editorial metadata, not transcript content.

They may be supplied to a later processing stage, but must be explicitly identified as reviewer guidance and must never be quoted or rendered as though they were spoken in the meeting. They are not part of normal transcript exports or final minutes.

## 4. Transcript and paragraph model

aTrain segments remain the low-level timing/evidence units. Human-facing paragraphs are an editorial presentation layer.

Paragraph rules:

- a speaker change always starts a new paragraph;
- consecutive segments from the same speaker may be grouped into a paragraph;
- a reviewer may introduce an explicit paragraph break between same-speaker segments;
- changing a segment's speaker should naturally split/merge displayed paragraphs;
- explicit paragraph boundaries are reviewer metadata rather than modifications to aTrain's raw segment schema.

The current reviewer persists explicit starts as `reviewer.paragraph_break_segment_ids`.

Initially, paragraph breaks occur only at existing aTrain segment boundaries. A later enhancement may support splitting inside an aTrain segment, preferably using its word-level timestamps to create a defensible timing boundary.

## 5. Human review UX decisions

The transcript should read as a document rather than thousands of independent cards.

Each underlying timed segment remains identifiable and playable. The current interaction direction is:

- a small play marker seeks to that exact segment start;
- a one-click paragraph-split marker starts a paragraph at that segment;
- right-clicking a passage exposes less-frequent segment operations such as speaker reassignment, individual review state and joining an explicit paragraph break;
- transcript text remains directly editable with a visible caret;
- Space is normal text input, not a global playback shortcut;
- paragraph-level Review marks all constituent passages reviewed;
- paragraphs/passages provide a visible reviewed/partially-reviewed indication;
- paragraph-level actions include Hide/Restore output and Add/Edit note.

Speaker navigation in the Participants panel supports Previous / First / Next paragraph for each speaker and an `m of n` position indicator. Navigation is based on paragraph starts.

## 6. AI transcript-check stage

The first AI stage should not regenerate the transcript wholesale. It should return structured findings/proposed changes tied to stable source identifiers. Python/server code applies only changes accepted by the reviewer.

Suggested finding types include:

- `asr_correction`
- `unclear`
- `speaker_attribution`
- `paragraph_break`
- later: `intra_segment_speaker_change`

A finding should carry enough provenance to navigate directly to the relevant audio, for example recording ID, segment ID, source timestamp, finding type, original/suggested value, confidence, reason and review status.

Speaker changes should not be silently applied. Uncertain transcription should be flagged rather than guessed.

### AI evidence rules

For transcript cleanup and all later stages:

- transcript/audio are primary evidence;
- agenda, vocabulary, known people and reviewer notes are context/hints, not evidence that an event occurred;
- preserve dialect, non-native grammar and code-switching unless there is clear ASR corruption;
- do not translate or stylistically polish during transcript cleanup;
- do not turn a proposal into a decision;
- do not invent names, dates, numbers, owners, deadlines, actions or decisions;
- use explicit uncertainty/nulls where evidence is insufficient;
- diarisation is probabilistic, especially for short interjections;
- the existence of an agenda item is not evidence that it was discussed.

Whole-meeting context is preferred where model/context limits permit, including all recordings in their defined order. If chunking becomes necessary for cost/latency, the design must preserve cross-recording context and provenance rather than treating chunks as independent meetings.

## 7. Later structured extraction and minutes

After transcript checking is reviewed, a meeting-level stage should extract structured information such as:

- topics discussed;
- decisions;
- actions;
- owners;
- dates/deadlines;
- unresolved questions;
- deferred items;
- potentially agenda-item relationships.

The structured representation should be reviewed before or alongside final prose generation. Unsupported fields should be null/absent rather than inferred.

Final minutes are generated from reviewed meeting evidence and structured extraction, not directly from agenda assumptions. Excluded transcript material and non-output reviewer notes must not leak into final prose.

A persistent store (for example SQLite initially, a server database later) may eventually maintain decisions/actions/history across meetings, but this should be downstream of the evidence-preserving meeting model.

## 8. Local and hosted deployment

The application should be portable and centrally deployable. Do not bake the UI or processing model permanently into browser File System Access APIs or a particular local directory layout.

### Local mode

The existing workflow may continue to open an aTrain output directory directly and write compatible corrected exports back to it. This is useful for development and personal/offline use.

### Hosted/VPS mode

Hosted users should not need to understand aTrain directories, filenames, manifests or storage layout.

An administrator/uploader should be able to submit a complete meeting directory/package. Server-side ingestion should discover/associate the relevant recordings, transcripts, agenda/context files and other supported inputs, then expose only the appropriate meeting UI to the assigned reviewer.

The reviewer experience should be approximately:

1. sign in;
2. see assigned meetings;
3. open a meeting;
4. review its recording(s) in order;
5. see progress/status;
6. submit/complete the review.

For a multi-recording meeting, recordings can be presented as Part 1 / Part 2 / etc. The reviewer should not have to navigate the backing filesystem.

The server should retain the uploaded source package intact where practical and store normalized/editorial state separately.

### Service boundary

The planned AI/local helper should be treated as an HTTP application service, not as a localhost-only architectural dependency. During development it can run locally; in production the same logical service can run on the VPS.

In hosted mode the server/service owns:

- authentication and authorization;
- users/reviewer assignments;
- meeting/recording metadata;
- source and derived storage;
- review persistence;
- OpenAI API calls and credentials;
- structured extraction;
- document/final-output generation.

The browser must never receive the OpenAI API key.

The transcript editor should consume a normalized project interface so its editing UI is largely independent of whether data came from a local folder or a hosted API.

## 9. Hosted security/assignment constraints

Meeting recordings and transcripts may be sensitive. Hosted implementation should therefore include, before production use:

- authenticated access;
- meeting-level authorization/assignment checks on every server operation;
- no reliance on hidden UI controls for access control;
- server-side validation of uploaded meeting packages;
- safe filenames/storage paths and protection against archive/path traversal;
- an audit trail for meaningful review/submission changes where appropriate;
- API credentials and secrets only on the server;
- a defined retention/backup policy for source audio, transcripts and generated outputs.

The exact authentication mechanism and roles remain to be selected.

## 10. Suggested normalized meeting manifest

The exact schema is not final, but future implementation should support concepts equivalent to:

```yaml
meeting:
  id: meeting-...
  title: ...
  date: ...
  status: review
  assigned_reviewer_ids: [...]

recordings:
  - id: recording-1
    order: 1
    audio_source: ...
    transcript_source: ...
  - id: recording-2
    order: 2
    audio_source: ...
    transcript_source: ...

context:
  agenda: ...
  vocabulary: ...
  meeting_notes: ...

speaker_identity_map:
  # recording-local speaker IDs -> meeting-level person IDs
  recording-1: {}
  recording-2: {}
```

Hosted storage paths must not become public/user-facing identifiers. Stable logical IDs should be used instead.

## 11. Implementation plan

### Phase A — complete recording-level paragraph reviewer

- validate paragraph-oriented rendering against real aTrain projects;
- refine one-click split, right-click segment controls and paragraph-level review UX;
- validate editing, review filters, speaker navigation and audio-follow behavior;
- validate persistence of paragraph breaks, exclusions and next-stage notes;
- retain backwards compatibility with existing aTrain output projects;
- add targeted tests/refactor the temporary presentation-layer override once UX settles.

### Phase B — establish meeting/recording model before AI integration

- define normalized Meeting and Recording schemas;
- define stable recording + segment identifiers and provenance rules;
- define cross-recording speaker identity mapping;
- define an import/manifest format for one or multiple aTrain recording outputs;
- define normalized storage interface used by both local and hosted modes;
- ensure exclusions, reviewer notes and review state survive ingestion/export.

### Phase C — AI transcript checking

- implement the HTTP processing service;
- use server/environment-managed OpenAI credentials;
- submit complete meeting context where feasible while preserving recording boundaries;
- request structured findings only, not a rewritten transcript;
- build findings review UI with audio navigation and Accept/Edit/Reject;
- preserve raw AI responses/results for provenance/debugging as appropriate.

### Phase D — meeting-level extraction and minutes

- structured decisions/actions/topics extraction across all recordings;
- human review/correction of extracted facts;
- minutes generation from reviewed evidence;
- DOCX and other required exports;
- optional persistent decision/action history.

### Phase E — hosted collaborative deployment

Some Phase E groundwork belongs in Phase B/C so local-only assumptions do not become entrenched.

- meeting-package upload/ingestion;
- authentication and roles;
- reviewer assignment and assigned-meeting dashboard;
- server-side persistence and source-package storage;
- multi-recording reviewer navigation/progress;
- submission/completion workflow;
- audit trail;
- backup/retention and operational deployment on VPS.

## 12. Open design questions

These should be decided when implementation reaches them rather than guessed now:

- exact meeting package/import convention when recordings live in separate aTrain folders;
- whether hosted ingestion accepts directories, ZIP packages, or both;
- exact authentication provider and role model;
- whether one meeting can have multiple simultaneous reviewers and how conflicts are resolved;
- submission/reopen/approval workflow;
- exact cross-recording speaker reconciliation UX;
- storage technology for hosted metadata and review history;
- audio storage/streaming strategy and retention period;
- whether reviewer notes can target whole meetings/recordings as well as paragraphs;
- how much AI work is automatic versus explicitly launched by a reviewer/admin;
- model/cost/latency policy for very long multi-recording meetings.

## 13. Guiding principle

Keep **evidence**, **editorial interpretation**, **AI proposals**, and **final presentation** separate.

A reviewer should be able to trace a final decision/action/minute back through accepted structured data and transcript findings to the exact source recording and timestamp, while an ordinary hosted reviewer should not have to know anything about the filesystem or processing plumbing that makes that possible.
