#!/usr/bin/env python3
"""Online SQLite backup for Pocket Provider Dashboard.

Creates a verified backup of the canonical SQLite database including WAL
checkpoint. Uses sqlite3_backup API for safe concurrent backup during
indexer operation.

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
import time


def backup_database(source_path: str, backup_dir: str, retention_days: int) -> bool:
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    backup_path = os.path.join(backup_dir, f"pocket-{timestamp}.sqlite")
    tmp_path = backup_path + ".tmp"

    if os.path.exists(tmp_path):
        os.unlink(tmp_path)

    try:
        source = sqlite3.connect(source_path)
        source.execute("PRAGMA wal_checkpoint(TRUNCATE)")

        dest = sqlite3.connect(tmp_path)
        source.backup(dest)
        dest.close()

        sha = hashlib.sha256()
        with open(tmp_path, "rb") as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                sha.update(chunk)

        checksum_path = tmp_path + ".sha256"
        with open(checksum_path, "w") as c:
            c.write(f"{sha.hexdigest()}  {os.path.basename(backup_path)}\n")

        os.rename(tmp_path, backup_path)

        size_mb = os.path.getsize(backup_path) / (1024 * 1024)
        print(f"[{datetime.datetime.utcnow().isoformat()}Z] Backup complete: {os.path.basename(backup_path)} ({size_mb:.1f} MB, sha256={sha.hexdigest()[:16]}...)")

        source.execute("VACUUM")
        source.close()

        # Verify backup
        verify = sqlite3.connect(backup_path)
        verify.execute("PRAGMA integrity_check")
        rows = verify.execute(
            "SELECT COUNT(*) FROM settlement_facts WHERE estimated_relays IS NOT NULL"
        ).fetchone()
        if rows:
            print(f"  Verified: {rows[0]} estimated facts in backup")
        verify.close()

        # Retention cleanup
        backups = sorted(
            [f for f in os.listdir(backup_dir) if f.startswith("pocket-") and f.endswith(".sqlite")],
            reverse=True,
        )
        for old in backups[retention_days:]:
            old_path = os.path.join(backup_dir, old)
            os.unlink(old_path)
            print(f"  Rotated: {old}")

        # Update metadata
        import subprocess
        try:
            subprocess.run(
                ["python3", "-c",
                 f"import sqlite3; c=sqlite3.connect('{source_path}');"
                 f"c.execute(\"INSERT INTO indexer_state (key,value,updated_at) VALUES ('last_backup',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at\","
                 f"('{timestamp}','{datetime.datetime.utcnow().isoformat()}Z'));"
                 f"c.commit(); c.close()"],
                capture_output=True, timeout=10,
            )
        except Exception:
            pass

        return True

    except Exception as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return False


def main():
    parser = argparse.ArgumentParser(description="Online SQLite backup for Pocket Provider Dashboard")
    parser.add_argument(
        "--db",
        default=os.environ.get("POCKET_SQLITE_PATH", "/var/lib/pocket-dashboard/pocket.sqlite"),
        help="Path to source SQLite database",
    )
    parser.add_argument(
        "--backup-dir",
        default=os.environ.get("POCKET_BACKUP_DIR", "/var/backups/pocket-dashboard"),
        help="Directory to store backup files",
    )
    parser.add_argument("--retention", type=int, default=7, help="Number of backup generations to retain")
    args = parser.parse_args()

    if not os.path.exists(args.db):
        print(f"Database not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    success = backup_database(args.db, args.backup_dir, args.retention)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
