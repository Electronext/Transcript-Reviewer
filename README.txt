aTrain Transcript Reviewer
==========================

Version 1.4
-----------
- Fixed the Chrome/Edge hang introduced with the compact auto-height passage
  layout in v1.1. All visible text boxes are now measured and resized in one
  batched layout pass instead of repeatedly recalculating the full page.
- Recently opened transcript folders can be reopened from the welcome screen or
  the Recent transcripts button.
- Folder and separately selected audio-file handles are remembered locally.
- The browser requests access again when a stored permission has expired.

Version 1.2
-----------
- A missing recording can no longer leave folder loading waiting indefinitely.
- Audio discovery is time-bounded; if no recording is found promptly, the
  transcript opens and offers the separate audio file selector.

Purpose
-------
This is an offline reviewer for aTrain output folders. It keeps text, speaker
assignments, timestamps, and exports in sync from one corrected JSON master.

Requirements
------------
- Windows with a current Microsoft Edge or Google Chrome.
- An aTrain output folder containing transcription.json.
- The source audio may be in that folder or selected separately.

Start
-----
1. Extract this ZIP to a permanent folder.
2. Double-click run_reviewer.bat.
3. Choose "Open aTrain folder".
4. Select the individual aTrain result folder (not its parent).
5. If the recording is not found there, choose it with the separate audio
   selector shown above the playback controls.
6. Later, reopen the project from "Recent transcripts" without navigating back
   to its folder. Remove individual entries with the × button if no longer
   needed.

Review
------
- Click a timestamp to play from that passage.
- Playback highlights and follows the current passage.
- Edit text directly in each passage.
- Select the correct speaker from the passage dropdown.
- Rename SPEAKER_00, SPEAKER_01, etc. once in the Participants panel.
- Collapse the Participants panel to give the transcript more horizontal room.
- Text boxes grow to fit their contents instead of scrolling internally.
- Mark passages Reviewed to track progress.
- Ctrl+S saves at any time.

What Save changes
-----------------
The reviewer updates these files in the selected aTrain folder:

- transcription.json (the corrected master)
- transcription.srt
- transcription.txt
- transcription_timestamps.txt
- transcription_maxqda.txt
- transcription_reviewed.md (an additional readable Markdown export)

By default, SRT cues include the speaker name so they cannot silently diverge
from the labelled transcript. This can be switched off in the Participants
panel.

Safety and compatibility
------------------------
- The first save creates a timestamped "Transcript Reviewer Backup ..." folder
  containing the original text and JSON outputs.
- The source audio is never changed or copied.
- Recent-project entries store only local file/folder handles and display names
  in this browser. They do not store transcript or audio content.
- Unknown aTrain JSON fields are retained.
- Corrected segment text is authoritative. Existing word timestamps are kept
  for reference, but word-level text cannot be reconstructed safely after a
  manual text correction.
- Speaker changes are also applied to the segment's word speaker fields.
- Speaker display names, review progress, and reviewer settings are stored in
  the top-level "reviewer" field of transcription.json.

Privacy
-------
The application uses only local browser features. It has no network code and
does not upload the recording or transcript.
