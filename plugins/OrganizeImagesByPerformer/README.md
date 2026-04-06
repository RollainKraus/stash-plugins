# Organize Images By Performer

Organizes image files from a deliberate inbox directory into performer-named folders based on attached Stash performers.

## Current behavior

- Only image files already inside the configured `Source Directory` tree are considered.
- Images with no performers are left in place.
- Images with exactly one performer are moved to `<Destination Directory>\<Performer Name>\`.
- Images with two or more performers either go to `<Destination Directory>\_MULTI\` or fan out into each attached performer folder, depending on `Multi Performer Mode`.
- If a filename already exists in the target performer folder, the plugin tries `name 2.ext`, `name 3.ext`, and so on.
- The plugin only moves files on disk. It does **not** update the Stash database path, so you should run your own scan or rescan afterward.

## Settings

- `Source Directory`: the inbox tree to sort from. If it does not exist yet, the plugin creates it.
- `Destination Directory`: where performer folders will be created.
- `Multi Performer Mode`: enter `bucket` to route multi-performer images into `_MULTI`, or `fanout` to copy them into each attached performer folder and then remove the inbox original.

## Tasks

- `Preview Image Organization`: dry run. The full preview is written to `OrganizeImagesByPerformer-last-run.log` in the plugin folder.
- `Organize Images`: moves files into performer folders or `_MULTI`, and writes a run log.

## Notes

- Source and destination cannot be the same path.
- Source cannot be inside destination, and destination cannot be inside source.
- Images with no performer stay in the inbox so you can fix metadata and rerun later.
- Performer folder names are sanitized for Windows-invalid characters.
- In `fanout` mode, multi-performer images are copied into every attached performer folder. The original inbox file is deleted only after every copy succeeds.
- In `bucket` mode, multi-performer images are routed into `_MULTI` in the destination directory.
- The most recent run report is written to `OrganizeImagesByPerformer-last-run.log` in this plugin folder.
