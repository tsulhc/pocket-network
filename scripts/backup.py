#!/usr/bin/env python3
"""Online SQLite backup for Pocket Provider Dashboard.

Creates a verified backup of the canonical SQLite database using the
sqlite3_backup API. Does not VACUUM or checkpoint the source — those
are maintenance operations that belong in a separate job.

Usage:
    python3 scripts/backup.py [--db /var/lib/pocket-dashboard/pocket.sqlite]
                              [--backup-dir /var/backups/pocket-dashboard]
                              [--retention 7]
"""

import argparse
import datetime
import hashlib
import os
import sqlite3
import sys

MIN_RETENTION = 3


def _validate_backup(path: str, source_facts: int) -> bool:
    conn = sqlite3.connect(path)
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA integrity_check")
        row = cur.fetchone()
        if not row or row[0] != "ok":
            print(f"  integrity_check failed: {row}", file=sys.stderr)
            return False
        cur.execute("SELECT COUNT(*) FROM settlement_facts WHERE estimated_relays IS NOT NULL")
        backup_facts = cur.fetchone()[0]
        if backup_facts < source_facts:
            print(f"  Backup has fewer estimated facts ({backup_facts}) than source ({source_facts})",
                  file=sys.stderr)
            return False
        cur.execute("SELECT value FROM indexer_state WHERE key='data_version'")
        row = cur.fetchone()
        if not row:
            print("  Backup missing data_version in indexer_state", file=sys.stderr)
            return False
        return True
    finally:
        conn.close()


def _record_metadata(source_path: str, timestamp: str) -> None:
    conn = sqlite3.connect(source_path)
    try:
        conn.execute(
            "INSERT INTO indexer_state (key, value, updated_at) VALUES ('last_backup', ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (timestamp, datetime.datetime.utcnow().isoformat() + "Z"),
        )
        conn.commit()
    finally:
        conn.close()


def backup_database(source_path: str, backup_dir: str, retention: int) -> bool:
    if retention < MIN_RETENTION:
        print(f"Retention must be at least {MIN_RETENTION}, got {retention}", file=sys.stderr)
        return False

    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    final_path = os.path.join(backup_dir, f"pocket-{timestamp}.sqlite")
    tmp_path = final_path + ".tmp"
    checksum_tmp = final_path + ".sha256.tmp"
    checksum_final = final_path + ".sha256"

    for stale in (tmp_path, checksum_tmp):
        if os.path.exists(stale):
            os.unlink(stale)

    try:
        source = sqlite3.connect(source_path)
        cur = source.cursor()
        cur.execute("SELECT COUNT(*) FROM settlement_facts WHERE estimated_relays IS NOT NULL")
        source_facts = cur.fetchone()[0]
        cur.execute("SELECT value FROM indexer_state WHERE key='data_version'")
        ver_row = cur.fetchone()
        if not ver_row:
            source.close()
            print("Source database missing data_version; cannot backup", file=sys.stderr)
            return False

        dest = sqlite3.connect(tmp_path)
        source.backup(dest)
        dest.close()
        source.close()

        sha = hashlib.sha256()
        with open(tmp_path, "rb") as f:
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    break
                sha.update(chunk)
        digest = sha.hexdigest()

        if not _validate_backup(tmp_path, source_facts):
            os.unlink(tmp_path)
            return False

        with open(checksum_tmp, "w") as c:
            c.write(f"{digest}  {os.path.basename(final_path)}\n")

        os.rename(tmp_path, final_path)
        os.rename(checksum_tmp, checksum_final)

        size_mb = os.path.getsize(final_path) / (1024 * 1024)
        print(f"[{datetime.datetime.utcnow().isoformat()}Z] Backup verified: "
              f"{os.path.basename(final_path)} ({size_mb:.1f} MB, sha256={digest[:16]}...)")

        _record_metadata(source_path, timestamp)

        backups = sorted(
            [f for f in os.listdir(backup_dir)
             if f.startswith("pocket-") and f.endswith(".sqlite")],
            reverse=True,
        )
        for old in backups[retention:]:
            old_path = os.path.join(backup_dir, old)
            old_checksum = old_path + ".sha256"
            os.unlink(old_path)
            if os.path.exists(old_checksum):
                os.unlink(old_checksum)
            print(f"  Rotated: {old}")

        return True

    except Exception as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if os.path.exists(checksum_tmp):
            os.unlink(checksum_tmp)
        return False


def main():
    parser = argparse.ArgumentParser(description="Online SQLite backup for Pocket Provider Dashboard")
    parser.add_argument(
        "--db",
        default=os.environ.get("POCKET_SQLITE_PATH", ""),
        help="Path to source SQLite database",
    )
    parser.add_argument(
        "--backup-dir",
        default=os.environ.get("POCKET_BACKUP_DIR", "/var/backups/pocket-dashboard"),
        help="Directory to store backup files",
    )
    parser.add_argument("--retention", type=int, default=7, help="Number of backup generations to retain (min 3)")
    args = parser.parse_args()

    db_path = args.db or "/var/lib/pocket-dashboard/pocket.sqlite"
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    success = backup_database(db_path, args.backup_dir, args.retention)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
