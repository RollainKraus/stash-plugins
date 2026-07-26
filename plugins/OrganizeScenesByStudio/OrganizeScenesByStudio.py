import json
import os
import re
import shutil
import sqlite3
import sys
from pathlib import Path
from urllib import error, request


PLUGIN_ID = "OrganizeScenesByStudio"
PREVIEW_MODE = "preview"
ORGANIZE_MODE = "organize"
DEFAULT_SETTINGS = {
    "sourceDirectory": "",
    "destinationDirectory": "",
    "parentSubStudioMode": "nested",
    "onlyOrganizedScenes": False,
}
REPORT_BASENAME = "OrganizeScenesByStudio-last-run.log"
PARENT_SUB_STUDIO_NESTED_MODE = "nested"
PARENT_SUB_STUDIO_STANDALONE_MODE = "standalone"
INVALID_WINDOWS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}


def log(level, message):
    print(f"[{PLUGIN_ID}] {level}: {message}", file=sys.stderr)


def exit_plugin(output=None, error_message=None):
    print(json.dumps({"output": output, "error": error_message}))
    sys.exit(0 if error_message is None else 1)


def normalize_path(value):
    return os.path.normcase(os.path.abspath(os.path.normpath(value)))


def path_has_parent_or_self(path, possible_parent):
    try:
        return os.path.commonpath([path, possible_parent]) == possible_parent
    except ValueError:
        return False


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0

    normalized = str(value).strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def sanitize_folder_name(name, fallback):
    cleaned = INVALID_WINDOWS_CHARS.sub("_", (name or "").strip())
    cleaned = cleaned.rstrip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        cleaned = fallback
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def build_studio_path(studio_id, studios_by_id, parent_sub_studio_mode):
    if studio_id is None:
        return []

    if parent_sub_studio_mode == PARENT_SUB_STUDIO_STANDALONE_MODE:
        studio = studios_by_id.get(studio_id)
        if studio is None:
            return []
        return [sanitize_folder_name(studio["name"], "_UNKNOWN_STUDIO")]

    names = []
    current_id = studio_id
    visited = set()
    while current_id is not None:
        if current_id in visited:
            raise RuntimeError(f"Studio hierarchy contains a cycle at studio id {current_id}")
        visited.add(current_id)

        studio = studios_by_id.get(current_id)
        if studio is None:
            break
        names.append(studio["name"])
        current_id = studio["parent_id"]

    names.reverse()
    return [
        sanitize_folder_name(name, "_UNKNOWN_STUDIO")
        for name in names
    ]


def build_destination_path(destination_root, studio_path, basename):
    path = Path(destination_root)
    for folder_name in studio_path:
        path = path / folder_name
    return path / basename


def reserve_available_destination(destination_path, reserved_destinations):
    normalized_destination = normalize_path(str(destination_path))
    if (
        not destination_path.exists()
        and normalized_destination not in reserved_destinations
    ):
        reserved_destinations.add(normalized_destination)
        return destination_path

    stem = destination_path.stem
    suffix = destination_path.suffix
    counter = 2
    while True:
        candidate = destination_path.with_name(f"{stem} {counter}{suffix}")
        normalized_candidate = normalize_path(str(candidate))
        if not candidate.exists() and normalized_candidate not in reserved_destinations:
            reserved_destinations.add(normalized_candidate)
            return candidate
        counter += 1


def graphql_call(server_connection, query, variables=None):
    host = server_connection["Host"]
    if host == "0.0.0.0":
        host = "localhost"

    url = f'{server_connection["Scheme"]}://{host}:{server_connection["Port"]}/graphql'
    payload = {"query": query, "variables": variables or {}}
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": f'session={server_connection["SessionCookie"]["Value"]}',
    }
    req = request.Request(url, data=body, headers=headers, method="POST")

    try:
        with request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GraphQL request failed with HTTP {exc.code}: {details}") from exc
    except Exception as exc:
        raise RuntimeError(f"GraphQL request failed: {exc}") from exc

    if result.get("errors"):
        raise RuntimeError(f"GraphQL error: {result['errors']}")
    return result.get("data", {})


def load_runtime_context(fragment):
    server_connection = fragment.get("server_connection")
    if not server_connection:
        raise RuntimeError("Missing server connection details from Stash")

    configuration = graphql_call(
        server_connection,
        """
        query OrganizeScenesByStudioConfiguration {
          configuration {
            general {
              databasePath
            }
            plugins
          }
        }
        """,
    )["configuration"]

    settings = DEFAULT_SETTINGS.copy()
    settings.update(configuration.get("plugins", {}).get(PLUGIN_ID, {}) or {})
    return server_connection, configuration["general"]["databasePath"], settings


def validate_settings(settings):
    source_directory = str(settings.get("sourceDirectory") or "").strip()
    destination_directory = str(settings.get("destinationDirectory") or "").strip()

    if not source_directory:
        raise RuntimeError("Set Source Directory in the plugin settings before running this task")
    if not destination_directory:
        raise RuntimeError("Set Destination Directory in the plugin settings before running this task")

    source_directory = normalize_path(source_directory)
    destination_directory = normalize_path(destination_directory)

    if source_directory == destination_directory:
        raise RuntimeError("Source Directory and Destination Directory cannot be the same path")
    if path_has_parent_or_self(destination_directory, source_directory):
        raise RuntimeError("Destination Directory cannot be inside Source Directory")
    if path_has_parent_or_self(source_directory, destination_directory):
        raise RuntimeError("Source Directory cannot be inside Destination Directory")

    parent_sub_studio_mode = str(settings.get("parentSubStudioMode") or "").strip().lower()
    if not parent_sub_studio_mode:
        parent_sub_studio_mode = PARENT_SUB_STUDIO_NESTED_MODE
    if parent_sub_studio_mode not in {
        PARENT_SUB_STUDIO_NESTED_MODE,
        PARENT_SUB_STUDIO_STANDALONE_MODE,
    }:
        raise RuntimeError(
            "Parent/Sub-Studio Mode must be set to 'nested' or 'standalone'"
        )

    only_organized_scenes = parse_bool(settings.get("onlyOrganizedScenes"))

    return (
        source_directory,
        destination_directory,
        parent_sub_studio_mode,
        only_organized_scenes,
    )


def ensure_source_directory(path):
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
        log("INFO", f"Created source directory: {path}")


def fetch_studios(cursor):
    cursor.execute(
        """
        SELECT id, name, parent_id
        FROM studios
        """
    )
    return {
        row["id"]: {
            "name": row["name"],
            "parent_id": row["parent_id"],
        }
        for row in cursor.fetchall()
    }


def fetch_candidate_rows(database_path, source_directory, parent_sub_studio_mode):
    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        studios_by_id = fetch_studios(cursor)
        like_prefix = f"{source_directory}{os.sep}%"
        cursor.execute(
            """
            SELECT
              s.id AS scene_id,
              s.title AS scene_title,
              s.studio_id AS studio_id,
              s.organized AS scene_organized,
              sf.file_id AS file_id,
              sf."primary" AS is_primary,
              fo.path AS folder_path,
              f.basename AS basename
            FROM scenes s
            INNER JOIN scenes_files sf ON sf.scene_id = s.id
            INNER JOIN files f ON f.id = sf.file_id
            INNER JOIN folders fo ON fo.id = f.parent_folder_id
            WHERE LOWER(fo.path) = LOWER(?)
               OR LOWER(fo.path) LIKE LOWER(?)
            ORDER BY s.id, sf."primary" DESC, f.id
            """,
            (source_directory, like_prefix),
        )

        candidates = []
        for row in cursor.fetchall():
            studio_path = build_studio_path(
                row["studio_id"],
                studios_by_id,
                parent_sub_studio_mode,
            )
            current_path = os.path.join(row["folder_path"], row["basename"])
            candidates.append(
                {
                    "scene_id": row["scene_id"],
                    "scene_title": row["scene_title"] or "",
                    "file_id": row["file_id"],
                    "current_path": current_path,
                    "basename": row["basename"],
                    "studio_id": row["studio_id"],
                    "scene_organized": bool(row["scene_organized"]),
                    "studio_path": studio_path,
                    "is_primary": bool(row["is_primary"]),
                }
            )
        return candidates
    finally:
        conn.close()


def write_report(
    report_path,
    mode,
    source_directory,
    destination_directory,
    parent_sub_studio_mode,
    only_organized_scenes,
    report_lines,
):
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        handle.write(f"mode: {mode}\n")
        handle.write(f"source_directory: {source_directory}\n")
        handle.write(f"destination_directory: {destination_directory}\n")
        handle.write(f"parent_sub_studio_mode: {parent_sub_studio_mode}\n")
        handle.write(f"only_organized_scenes: {only_organized_scenes}\n")
        handle.write("\n")
        for line in report_lines:
            handle.write(f"{line}\n")


def organize_candidates(
    candidates,
    destination_directory,
    mode,
    only_organized_scenes,
    report_lines,
):
    summary = {
        "considered_files": len(candidates),
        "considered_scenes": len({candidate["scene_id"] for candidate in candidates}),
        "processed_files": 0,
        "processed_scenes": 0,
        "skipped_unorganized": 0,
        "skipped_no_studio": 0,
        "skipped_missing_file": 0,
        "errors": 0,
    }

    destination_root = Path(destination_directory)
    reserved_destinations = set()
    processed_scene_ids = set()

    for candidate in candidates:
        scene_id = candidate["scene_id"]
        current_path = Path(candidate["current_path"])
        studio_path = candidate["studio_path"]
        studio_label = "\\".join(studio_path)

        if only_organized_scenes and not candidate["scene_organized"]:
            summary["skipped_unorganized"] += 1
            report_lines.append(f"SKIP|{scene_id}|{candidate['file_id']}|unorganized-scene|{current_path}")
            continue

        if not current_path.is_file():
            summary["skipped_missing_file"] += 1
            report_lines.append(f"SKIP|{scene_id}|{candidate['file_id']}|missing-file|{current_path}")
            continue

        if not studio_path:
            summary["skipped_no_studio"] += 1
            report_lines.append(f"SKIP|{scene_id}|{candidate['file_id']}|no-studio|{current_path}")
            continue

        target_path = build_destination_path(
            destination_root,
            studio_path,
            candidate["basename"],
        )
        target_path = reserve_available_destination(target_path, reserved_destinations)

        if mode == ORGANIZE_MODE:
            try:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(current_path), str(target_path))
            except Exception as exc:
                summary["errors"] += 1
                report_lines.append(
                    f"ERROR|{scene_id}|{candidate['file_id']}|move-failed|{current_path}|{target_path}|{exc}"
                )
                continue

        summary["processed_files"] += 1
        processed_scene_ids.add(scene_id)
        action = "MOVE" if mode == ORGANIZE_MODE else "PREVIEW"
        report_lines.append(
            f"{action}|{scene_id}|{candidate['file_id']}|{studio_label}|{current_path}|{target_path}"
        )

    summary["processed_scenes"] = len(processed_scene_ids)
    return summary


def build_summary_text(
    mode,
    parent_sub_studio_mode,
    only_organized_scenes,
    summary,
    report_path,
):
    if mode == PREVIEW_MODE:
        action_label = "Preview complete"
        processed_label = "ready"
    else:
        action_label = "Organize run complete"
        processed_label = "moved"

    return (
        f"{action_label}. Considered {summary['considered_files']} scene file(s) "
        f"from {summary['considered_scenes']} scene(s); "
        f"{processed_label} {summary['processed_files']} file(s) "
        f"from {summary['processed_scenes']} scene(s); "
        f"parent/sub-studio mode {parent_sub_studio_mode}; "
        f"only organized scenes {only_organized_scenes}; "
        f"skipped {summary['skipped_unorganized']} unorganized file(s); "
        f"skipped {summary['skipped_no_studio']} file(s) with no studio; "
        f"missing files {summary['skipped_missing_file']}; "
        f"errors {summary['errors']}. "
        f"{'Full preview written to log file: ' if mode == PREVIEW_MODE else 'Run log: '}{report_path}"
    )


def main():
    fragment = json.loads(sys.stdin.read())
    mode = str(fragment.get("args", {}).get("mode") or PREVIEW_MODE).strip().lower()
    if mode not in {PREVIEW_MODE, ORGANIZE_MODE}:
        raise RuntimeError(f"Unsupported mode '{mode}'")

    _, database_path, settings = load_runtime_context(fragment)
    (
        source_directory,
        destination_directory,
        parent_sub_studio_mode,
        only_organized_scenes,
    ) = validate_settings(settings)
    ensure_source_directory(source_directory)

    candidates = fetch_candidate_rows(
        database_path,
        source_directory,
        parent_sub_studio_mode,
    )
    report_lines = []
    summary = organize_candidates(
        candidates,
        destination_directory,
        mode,
        only_organized_scenes,
        report_lines,
    )

    plugin_dir = Path(fragment["server_connection"]["PluginDir"])
    report_path = plugin_dir / REPORT_BASENAME
    write_report(
        report_path,
        mode,
        source_directory,
        destination_directory,
        parent_sub_studio_mode,
        only_organized_scenes,
        report_lines,
    )

    summary_text = build_summary_text(
        mode,
        parent_sub_studio_mode,
        only_organized_scenes,
        summary,
        report_path,
    )
    log("INFO", summary_text)
    exit_plugin(summary_text)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log("ERROR", str(exc))
        exit_plugin(error_message=str(exc))
