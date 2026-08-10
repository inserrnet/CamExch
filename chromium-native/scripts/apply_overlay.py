#!/usr/bin/env python3
"""Apply the minimal CamExch native-camera prototype to a Chromium checkout."""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


FEATURE_FILE = pathlib.Path("media/base/media_switches.cc")
DISABLED_PATTERN = re.compile(
    r"(BASE_FEATURE\(kUseFakeDeviceForMediaStream,\s*)"
    r"base::FEATURE_DISABLED_BY_DEFAULT(\s*\);)"
)
ENABLED_PATTERN = re.compile(
    r"BASE_FEATURE\(kUseFakeDeviceForMediaStream,\s*"
    r"base::FEATURE_ENABLED_BY_DEFAULT\s*\);"
)


def apply_feature(checkout: pathlib.Path, check_only: bool) -> None:
    path = checkout / FEATURE_FILE
    if not path.is_file():
        raise RuntimeError(f"Chromium file is missing: {path}")

    source = path.read_text(encoding="utf-8")
    if ENABLED_PATTERN.search(source):
        print(f"CamExch native test source already enabled in {FEATURE_FILE}")
        return

    matches = list(DISABLED_PATTERN.finditer(source))
    if len(matches) != 1:
        raise RuntimeError(
            "Expected exactly one disabled kUseFakeDeviceForMediaStream feature; "
            f"found {len(matches)}. The pinned Chromium source changed."
        )

    if check_only:
        print(f"Chromium overlay is applicable to {FEATURE_FILE}")
        return

    updated = DISABLED_PATTERN.sub(
        r"\1base::FEATURE_ENABLED_BY_DEFAULT\2", source, count=1
    )
    path.write_text(updated, encoding="utf-8", newline="\n")
    print(f"Enabled Chromium's native fake VideoCaptureDevice in {FEATURE_FILE}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", required=True, type=pathlib.Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    try:
        apply_feature(args.checkout.resolve(), args.check_only)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
