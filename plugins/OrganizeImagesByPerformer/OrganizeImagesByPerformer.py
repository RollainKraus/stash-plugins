import json
import os
import re
import shutil
import sqlite3
import sys
from pathlib import Path
from urllib import error, request


PLUGIN_ID = "OrganizeImagesByPerformer"
PREVIEW_MODE = "preview"
ORGANIZE_MODE = "organize"
DEFAULT_SETTINGS = {
    "sourceDirectory": "",
    "destinationDirectory": "",
    "multiPerformerMode": "bucket",
}
REPORT_BASENAME = "OrganizeImagesByPerformer-last-run.log"
MULTI_FOLDER_NAME = "_MULTI"
MULTI_PERFORMER_BUCKET_MODE = "bucket"
MULTI_PERFORMER_FANOUT_MODE = "fanout"
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


def sanitize_folder_name(name):
    cleaned = INVALID_WINDOWS_CHARS.sub("_", (name or "").strip())
    cleaned = cleaned.rstrip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        cleaned = "_UNKNOWN_PERFORMER"
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def build_destination_path(destination_root, performer_name, basename):
    folder_name = sanitize_folder_name(performer_name)
    return Path(destination_root) / folder_name / basename


def build_multi_destination_path(destination_root, basename):
    return Path(destination_root) / MULTI_FOLDER_NAME / basename


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
        query OrganizeImagesByPerformerConfiguration {
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

    multi_performer_mode = str(settings.get("multiPerformerMode") or "").strip().lower()
    if not multi_performer_mode:
        multi_performer_mode = MULTI_PERFORMER_BUCKET_MODE
    if multi_performer_mode not in {
        MULTI_PERFORMER_BUCKET_MODE,
        MULTI_PERFORMER_FANOUT_MODE,
    }:
        raise RuntimeError(
            "Multi Performer Mode must be set to 'bucket' or 'fanout'"
        )

    return (
        source_directory,
        destination_directory,
        multi_performer_mode,
    )


def ensure_source_directory(path):
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
        log("INFO", f"Created source directory: {path}")


def fetch_candidate_rows(database_path, source_directory):
    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        like_prefix = f"{source_directory}{os.sep}%"
        cursor.execute(
            """
            SELECT
              i.id AS image_id,
              f.id AS file_id,
              fo.path AS folder_path,
              f.basename AS basename
            FROM images i
            INNER JOIN images_files imgf ON imgf.image_id = i.id
            INNER JOIN files f ON f.id = imgf.file_id
            INNER JOIN folders fo ON fo.id = f.parent_folder_id
            WHERE LOWER(fo.path) = LOWER(?)
               OR LOWER(fo.path) LIKE LOWER(?)
            ORDER BY i.id, f.id
            """,
            (source_directory, like_prefix),
        )
        rows = cursor.fetchall()
        if not rows:
            return []

        image_ids = sorted({row["image_id"] for row in rows})
        performers_by_image = {}
        chunk_size = 900
        for start in range(0, len(image_ids), chunk_size):
            batch = image_ids[start : start + chunk_size]
            placeholders = ",".join("?" for _ in batch)
            cursor.execute(
                f"""
                SELECT pi.image_id, p.name
                FROM performers_images pi
                INNER JOIN performers p ON p.id = pi.performer_id
                WHERE pi.image_id IN ({placeholders})
                ORDER BY pi.image_id, p.name
                """,
                batch,
            )
            for performer_row in cursor.fetchall():
                performers_by_image.setdefault(performer_row["image_id"], []).append(
                    performer_row["name"]
                )

        candidates = []
        for row in rows:
            current_path = os.path.join(row["folder_path"], row["basename"])
            performers = sorted(set(performers_by_image.get(row["image_id"], [])))
            candidates.append(
                {
                    "image_id": row["image_id"],
                    "file_id": row["file_id"],
                    "current_path": current_path,
                    "basename": row["basename"],
                    "performers": performers,
                }
            )
        return candidates
    finally:
        conn.close()


def write_report(report_path, mode, source_directory, destination_directory, report_lines):
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        handle.write(f"mode: {mode}\n")
        handle.write(f"source_directory: {source_directory}\n")
        handle.write(f"destination_directory: {destination_directory}\n")
        handle.write("\n")
        for line in report_lines:
            handle.write(f"{line}\n")


def organize_candidates(
    candidates,
    destination_directory,
    multi_performer_mode,
    mode,
    report_lines,
):
    summary = {
        "considered": len(candidates),
        "processed": 0,
        "skipped_no_performer": 0,
        "processed_multi_performer": 0,
        "skipped_missing_file": 0,
        "errors": 0,
        "fanout_copies": 0,
    }

    destination_root = Path(destination_directory)
    reserved_destinations = set()

    for candidate in candidates:
        image_id = candidate["image_id"]
        current_path = Path(candidate["current_path"])
        performers = candidate["performers"]

        if not current_path.is_file():
            summary["skipped_missing_file"] += 1
            report_lines.append(f"SKIP|{image_id}|missing-file|{current_path}")
            continue

        if len(performers) == 0:
            summary["skipped_no_performer"] += 1
            report_lines.append(f"SKIP|{image_id}|no-performer|{current_path}")
            continue

        if len(performers) > 1:
            performer_list = ", ".join(performers)

            if multi_performer_mode == MULTI_PERFORMER_FANOUT_MODE:
                target_paths = []
                for performer_name in performers:
                    target_path = build_destination_path(
                        destination_root, performer_name, candidate["basename"]
                    )
                    target_path = reserve_available_destination(
                        target_path, reserved_destinations
                    )
                    target_paths.append((performer_name, target_path))

                if mode == ORGANIZE_MODE:
                    created_targets = []
                    try:
                        for performer_name, target_path in target_paths:
                            target_path.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(str(current_path), str(target_path))
                            created_targets.append((performer_name, target_path))
                        current_path.unlink()
                    except Exception as exc:
                        for _, created_target in reversed(created_targets):
                            try:
                                if created_target.exists():
                                    created_target.unlink()
                            except Exception:
                                pass
                        summary["errors"] += 1
                        report_lines.append(
                            f"ERROR|{image_id}|fanout-failed|{current_path}|{performer_list}|{exc}"
                        )
                        continue
                    action = "FANOUT"
                else:
                    action = "FANOUT-PREVIEW"

                summary["processed"] += 1
                summary["processed_multi_performer"] += 1
                summary["fanout_copies"] += len(target_paths)
                for performer_name, target_path in target_paths:
                    report_lines.append(
                        f"{action}|{image_id}|{performer_name}|{current_path}|{target_path}"
                    )
            else:
                target_path = build_multi_destination_path(
                    destination_root, candidate["basename"]
                )
                target_path = reserve_available_destination(
                    target_path, reserved_destinations
                )
                if mode == ORGANIZE_MODE:
                    try:
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(current_path), str(target_path))
                    except Exception as exc:
                        summary["errors"] += 1
                        report_lines.append(
                            f"ERROR|{image_id}|multi-move-failed|{current_path}|{target_path}|{exc}"
                        )
                        continue
                    action = "MULTI"
                else:
                    action = "MULTI-PREVIEW"
                summary["processed"] += 1
                summary["processed_multi_performer"] += 1
                report_lines.append(
                    f"{action}|{image_id}|{performer_list}|{current_path}|{target_path}"
                )
            continue

        performer_name = performers[0]
        target_path = build_destination_path(
            destination_root, performer_name, candidate["basename"]
        )
        target_path = reserve_available_destination(target_path, reserved_destinations)

        if mode == ORGANIZE_MODE:
            try:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(current_path), str(target_path))
            except Exception as exc:
                summary["errors"] += 1
                report_lines.append(
                    f"ERROR|{image_id}|move-failed|{current_path}|{target_path}|{exc}"
                )
                continue

        summary["processed"] += 1
        action = "MOVE" if mode == ORGANIZE_MODE else "PREVIEW"
        report_lines.append(
            f"{action}|{image_id}|{performer_name}|{current_path}|{target_path}"
        )

    return summary


def build_summary_text(
    mode,
    multi_performer_mode,
    summary,
    report_path,
):
    if mode == PREVIEW_MODE:
        action_label = "Preview complete"
        processed_label = "ready"
    else:
        action_label = "Organize run complete"
        processed_label = "moved"
    if multi_performer_mode == MULTI_PERFORMER_FANOUT_MODE:
        multi_phrase = (
            f"fanout processed {summary['processed_multi_performer']} multi-performer image(s) "
            f"into {summary['fanout_copies']} performer copy/copies; "
        )
    else:
        multi_phrase = (
            f"routed {summary['processed_multi_performer']} multi-performer image(s) to "
            f"{MULTI_FOLDER_NAME}; "
        )
    return (
        f"{action_label}. Considered {summary['considered']} image file(s); "
        f"{processed_label} {summary['processed']}; "
        f"{multi_phrase}"
        f"skipped {summary['skipped_no_performer']} with no performer; "
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
        multi_performer_mode,
    ) = validate_settings(settings)
    ensure_source_directory(source_directory)

    candidates = fetch_candidate_rows(database_path, source_directory)
    report_lines = []
    summary = organize_candidates(
        candidates,
        destination_directory,
        multi_performer_mode,
        mode,
        report_lines,
    )

    plugin_dir = Path(fragment["server_connection"]["PluginDir"])
    report_path = plugin_dir / REPORT_BASENAME
    write_report(report_path, mode, source_directory, destination_directory, report_lines)

    summary_text = build_summary_text(
        mode,
        multi_performer_mode,
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
