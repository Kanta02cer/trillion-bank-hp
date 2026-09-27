#!/usr/bin/env python3
"""Fail CI when public sources or repository paths violate publication policy."""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "_data" / "content_guardrails.yml"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def normalize_rule(raw: object) -> str:
    return str(raw or "").strip().strip("/")


def is_allowed(path: Path, allowed: Iterable[str]) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    for raw in allowed:
        item = normalize_rule(raw)
        if item and (rel == item or rel.startswith(item + "/")):
            return True
    return False


def check_forbidden_paths(config: dict) -> list[str]:
    findings: list[str] = []
    for raw in config.get("forbidden_paths", []):
        item = normalize_rule(raw)
        if item and (ROOT / item).exists():
            findings.append(f"{item}: forbidden repository path exists")
    for raw in config.get("forbidden_prefixes", []):
        item = normalize_rule(raw)
        if item and (ROOT / item).exists():
            findings.append(f"{item}/: forbidden repository prefix exists")
    return findings


def iter_files(config: dict, roots_key: str) -> Iterable[Path]:
    extensions = {str(ext).lower() for ext in config.get("scan_extensions", [])}
    seen: set[Path] = set()
    for root_name in config.get(roots_key, []):
        root = ROOT / str(root_name)
        if root.is_file():
            candidates = [root]
        elif root.is_dir():
            candidates = root.rglob("*")
        else:
            continue
        for path in candidates:
            if not path.is_file() or path.suffix.lower() not in extensions:
                continue
            if any(part in {".git", "_site", "node_modules", "vendor"} for part in path.parts):
                continue
            if path not in seen:
                seen.add(path)
                yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""


def scan_patterns(path: Path, patterns: Iterable[dict]) -> list[str]:
    text = read_text(path)
    rel = path.relative_to(ROOT).as_posix()
    findings: list[str] = []
    for item in patterns:
        pattern = item.get("regex")
        if pattern and re.search(pattern, text):
            findings.append(f"{rel}: private pattern '{item.get('name', pattern)}' - {item.get('reason', '')}")
    return findings


def scan_reviewed_text(path: Path, config: dict) -> list[str]:
    text = read_text(path)
    rel = path.relative_to(ROOT).as_posix()
    findings: list[str] = []
    for item in config.get("restricted_terms", []):
        term = str(item.get("term", "")).strip()
        if term and term in text:
            findings.append(f"{rel}: restricted term '{term}' - {item.get('reason', '')}")
    findings.extend(scan_patterns(path, config.get("private_patterns", [])))
    return findings


def scan_scoped_claims(config: dict) -> list[str]:
    """Assertive-claim patterns limited to named roots (e.g. AirReach result copy)."""
    findings: list[str] = []
    extensions = {str(ext).lower() for ext in config.get("scan_extensions", [])} | {".js"}
    for group in config.get("scoped_claim_patterns", []):
        patterns = group.get("patterns", [])
        for root_name in group.get("roots", []):
            root = ROOT / str(root_name)
            if root.is_file():
                candidates = [root]
            elif root.is_dir():
                candidates = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in extensions]
            else:
                continue
            for path in candidates:
                text = read_text(path)
                rel = path.relative_to(ROOT).as_posix()
                for item in patterns:
                    pattern = item.get("regex")
                    if pattern and re.search(pattern, text):
                        findings.append(
                            f"{rel}: claim pattern '{pattern}' ({group.get('name', '')}) - {item.get('reason', '')}"
                        )
    return findings


def main() -> int:
    config = load_config()
    allowed = config.get("allowed_paths_for_restricted_terms", [])
    findings: list[str] = check_forbidden_paths(config)
    findings.extend(scan_scoped_claims(config))

    for path in iter_files(config, "global_scan_roots"):
        findings.extend(scan_patterns(path, config.get("global_private_patterns", [])))

    for path in iter_files(config, "public_roots"):
        if is_allowed(path, allowed):
            continue
        findings.extend(scan_reviewed_text(path, config))

    if findings:
        print("Content governance check failed:\n")
        for finding in sorted(set(findings)):
            print(f"- {finding}")
        print("\nRemove the content or document an approved exception outside public sources.")
        return 1

    print("Content governance check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
