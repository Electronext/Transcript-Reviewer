# Phase B — Meeting / Recording Data Model

This document is the concrete data-contract companion to `WORKFLOW_ARCHITECTURE.md`.

## Scope

Phase B establishes a stable meeting-level representation before the OpenAI/service layer is implemented. The current local reviewer remains recording-oriented and continues to edit a single aTrain result at a time; Phase B defines how one or more reviewed recordings are assembled for whole-meeting processing.

The live reviewer is intentionally not yet coupled to this module. `meeting-core.js` is a pure domain module that can be used by a future local importer, HTTP service, hosted backend, or tests.

## Contracts added

- `meeting-core.js` — manifest normalization, single-recording compatibility wrapper, stable processing references, and construction of a whole-meeting processing payload.
- `schemas/meeting-manifest.schema.json` — version 1 meeting manifest contract.
- `schemas/meeting-processing-input.schema.json` — version 1 processing payload contract.
- `examples/meeting-manifest.example.json` — example of one meeting composed from two independently transcribed recordings.
- `tests/meeting-core.test.js` — basic provenance and validation tests.

## Stable provenance

A raw aTrain segment ID is only unique inside its recording. Meeting-level stages therefore address source evidence using both values:

```text
recording_id + segment_id
```

`meeting-core.js` additionally exposes a compact processing reference:

```text
<recording_id>:<segment_id>
```

For example:

```text
recording-2:417
```

The compact `ref` is a convenience, not a replacement for the separate fields. AI findings and later extraction records should retain `recording_id`, `segment_id`, and timestamp fields explicitly so they can always navigate back to the source recording.

## Recording-local and meeting-level speaker identity

aTrain diarisation IDs remain recording-local. The same person may be `SPEAKER_00` in one recording and `SPEAKER_04` in another.

The manifest therefore separates:

- `people[]` — meeting-level human identities;
- `speaker_mappings[]` — mapping from `(recording_id, speaker_id)` to a meeting-level `person_id`.

A mapping may deliberately have `person_id: null` when the identity is unresolved. Do not infer cross-recording identity merely because display names happen to match.

The processing payload carries both the recording-local speaker identity/display name and any resolved meeting-level person identity.

## Source references

Manifest fields such as `source_ref`, `audio_ref`, and `transcript_ref` are opaque logical references. They are deliberately not filesystem paths or public URLs.

A local adapter may resolve them to File System Access handles. A hosted adapter may resolve them to database/object-storage IDs. The transcript editor and AI processing code should not depend on the backing representation.

## Context

`context` is deliberately extensible in schema version 1 because supported context sources will evolve. Examples include:

- agenda references/content;
- meeting-specific vocabulary;
- known names/roles;
- organization-specific terms;
- meeting-level reviewer notes.

Everything under `context` is guidance, not evidence that something happened in the meeting. Later AI prompts must preserve that distinction explicitly.

## Processing payload semantics

`buildMeetingProcessingPayload()` emits every segment from every recording, in recording order.

Segments are **not dropped** because they are:

- unreviewed;
- excluded from final output;
- associated with unresolved speakers.

Instead the payload carries explicit state:

```json
{
  "reviewed": true,
  "paragraph_break_before": false,
  "excluded_from_output": true,
  "reviewer_note": "Context for the next stage only"
}
```

This is intentional. Downstream processing needs chronology and provenance, while final-output generation must respect `excluded_from_output` and must treat `reviewer_note` as editorial guidance rather than spoken content.

## Single-recording compatibility

`buildSingleRecordingManifest()` creates a one-recording meeting wrapper around the existing normalized transcript project. This is the compatibility path for current local use and for meetings that genuinely have only one recording.

It means the later AI/service layer can always consume a meeting-level contract; it does not need a separate code path for the historical one-folder workflow.

## Importer responsibilities — next implementation step

The importer/service layer should take a whole meeting package and construct the manifest without exposing package structure to reviewers.

It will need to:

1. identify one or more aTrain result directories/transcripts;
2. identify the corresponding audio files;
3. establish recording order;
4. retain the uploaded source package unchanged in hosted mode;
5. normalize each recording with `TranscriptCore`;
6. allocate stable meeting/recording IDs;
7. attach agenda/context/vocabulary sources where present;
8. present unresolved cross-recording speaker mapping for human confirmation where necessary;
9. persist normalized review state separately from immutable source material;
10. supply `meeting-core.js` with normalized recording projects to produce the processing payload.

Automatic discovery should be conservative. If ordering or audio/transcript association is ambiguous, ingestion should flag that ambiguity for an administrator rather than guessing.

## Hosted UI boundary

The hosted reviewer should receive logical meeting/recording data only. It should never need to know:

- the original directory names;
- where the server stored the package;
- object-storage keys;
- how the uploaded archive was unpacked;
- which generated files are intermediate processing artifacts.

The user-facing model is an assigned Meeting containing ordered Recording parts and review progress.

## Validation rules currently enforced by `meeting-core.js`

- a manifest must contain a meeting ID;
- at least one recording is required;
- recording IDs are unique;
- recording order values are unique;
- person IDs are unique;
- speaker mappings must refer to known recordings;
- non-null person mappings must refer to known people;
- one recording-local speaker can have at most one mapping;
- building a processing payload requires a normalized transcript project for every manifest recording.

Additional validation belongs in the server/import layer, especially package/file safety, media association, authentication/authorization, workflow status, and persistence constraints.

## Phase B completion criteria

Before Phase C (OpenAI transcript checking) is considered integrated, the project should have:

- a working whole-meeting package importer for one and multiple recordings;
- stable generated meeting/recording IDs;
- a persisted manifest/meeting record;
- a way to reconcile cross-recording speakers;
- a storage adapter boundary so local and hosted sources resolve through the same logical interface;
- a processing-payload builder exercised against real reviewed aTrain projects.

Once those are in place, the OpenAI stage should consume `atrain-meeting-processing-input` rather than reading aTrain folders directly.
