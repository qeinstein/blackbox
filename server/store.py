from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from .config import DATABASE_PATH


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_store() -> None:
    with _connect() as db:
        db.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                site TEXT NOT NULL,
                created_at TEXT NOT NULL,
                filename TEXT NOT NULL,
                media_path TEXT NOT NULL,
                media_type TEXT NOT NULL,
                duration_s REAL NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                fps REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress INTEGER NOT NULL,
                message TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS jobs_case_id ON jobs(case_id);
            """
        )
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            """UPDATE jobs SET status = 'failed', stage = 'failed', progress = 100,
            message = 'Analysis was interrupted by a local service restart.',
            error = 'Retry this case to resume analysis.', updated_at = ?
            WHERE status IN ('queued', 'running')""",
            (now_iso(),),
        )


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def create_case(case: dict[str, Any], job: dict[str, Any]) -> None:
    with _connect() as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            """INSERT INTO cases
            (id,title,site,created_at,filename,media_path,media_type,duration_s,width,height,fps)
            VALUES (:id,:title,:site,:created_at,:filename,:media_path,:media_type,
              :duration_s,:width,:height,:fps)""",
            case,
        )
        db.execute(
            """INSERT INTO jobs
            (id,case_id,status,stage,progress,message,updated_at)
            VALUES (:id,:case_id,:status,:stage,:progress,:message,:updated_at)""",
            job,
        )


def create_job(job: dict[str, Any]) -> None:
    with _connect() as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            """INSERT INTO jobs (id,case_id,status,stage,progress,message,updated_at)
            VALUES (:id,:case_id,:status,:stage,:progress,:message,:updated_at)""",
            job,
        )


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress: int | None = None,
    message: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    fields: dict[str, Any] = {"updated_at": now_iso()}
    for name, value in (
        ("status", status),
        ("stage", stage),
        ("progress", progress),
        ("message", message),
        ("result_json", json.dumps(result, separators=(",", ":")) if result is not None else None),
        ("error", error),
    ):
        if value is not None:
            fields[name] = value
    assignments = ", ".join(f"{name} = :{name}" for name in fields)
    fields["id"] = job_id
    with _connect() as db:
        db.execute(f"UPDATE jobs SET {assignments} WHERE id = :id", fields)


def get_job(job_id: str) -> dict[str, Any] | None:
    with _connect() as db:
        row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    value = dict(row)
    value["result"] = json.loads(value.pop("result_json")) if value["result_json"] else None
    return value


def get_case(case_id: str) -> dict[str, Any] | None:
    with _connect() as db:
        row = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        if row is None:
            return None
        case = dict(row)
        job_row = db.execute(
            "SELECT * FROM jobs WHERE case_id = ? ORDER BY updated_at DESC LIMIT 1",
            (case_id,),
        ).fetchone()
    if job_row is not None:
        job = dict(job_row)
        case["analysis"] = json.loads(job["result_json"]) if job["result_json"] else None
        case["analysis_status"] = job["status"]
        case["analysis_stage"] = job["stage"]
        case["analysis_progress"] = job["progress"]
        case["analysis_message"] = job["message"]
        case["analysis_error"] = job["error"]
        case["job_id"] = job["id"]
    return case


def list_cases() -> list[dict[str, Any]]:
    with _connect() as db:
        rows = db.execute("SELECT id FROM cases ORDER BY created_at DESC").fetchall()
    return [case for row in rows if (case := get_case(row["id"])) is not None]


def delete_case(case_id: str) -> dict[str, Any] | None:
    case = get_case(case_id)
    if case is None:
        return None
    with _connect() as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("DELETE FROM jobs WHERE case_id = ?", (case_id,))
        db.execute("DELETE FROM cases WHERE id = ?", (case_id,))
    return case
