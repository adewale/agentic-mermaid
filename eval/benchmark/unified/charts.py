#!/usr/bin/env python3
"""Delegate historical AM reporting to its implementation in the pinned library."""
import runpy
from pathlib import Path

reporter = Path(__file__).resolve().parents[3] / 'node_modules/trident/unified/charts.py'
if not reporter.is_file():
    raise SystemExit('Prepare the pinned library first: bun eval/trident/prepare.ts')
globals().update(runpy.run_path(str(reporter), run_name=__name__))
