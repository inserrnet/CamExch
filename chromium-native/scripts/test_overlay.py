#!/usr/bin/env python3
"""Unit checks for the version-pinned Chromium overlay transformation."""

from __future__ import annotations

import pathlib
import tempfile
import unittest

import apply_overlay


class OverlayTest(unittest.TestCase):
    def make_checkout(self, source: str) -> pathlib.Path:
        root = pathlib.Path(self.temp_dir.name)
        target = root / apply_overlay.FEATURE_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
        return root

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_enables_native_fake_capture_feature(self) -> None:
        checkout = self.make_checkout(
            "BASE_FEATURE(kUseFakeDeviceForMediaStream,\n"
            "             base::FEATURE_DISABLED_BY_DEFAULT);\n"
        )
        apply_overlay.apply_feature(checkout, check_only=False)
        result = (checkout / apply_overlay.FEATURE_FILE).read_text(encoding="utf-8")
        self.assertIn("base::FEATURE_ENABLED_BY_DEFAULT", result)
        self.assertNotIn("base::FEATURE_DISABLED_BY_DEFAULT", result)

    def test_is_idempotent(self) -> None:
        checkout = self.make_checkout(
            "BASE_FEATURE(kUseFakeDeviceForMediaStream,\n"
            "             base::FEATURE_ENABLED_BY_DEFAULT);\n"
        )
        apply_overlay.apply_feature(checkout, check_only=False)

    def test_rejects_changed_upstream_shape(self) -> None:
        checkout = self.make_checkout("// feature was renamed\n")
        with self.assertRaises(RuntimeError):
            apply_overlay.apply_feature(checkout, check_only=False)


if __name__ == "__main__":
    unittest.main()
