# -*- coding: utf-8 -*-
"""Locate the plugin in both supported layouts.

1) repo root:  <repo>/dsh-gugu-stock/... + <repo>/acceptance/tests/
2) plugin root: <plugin>/scripts/...     + <plugin>/acceptance/tests/  (GitHub/CI)
"""
from __future__ import annotations

import pathlib

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent

_SIBLING = REPO / "dsh-gugu-stock"
PLUGIN = _SIBLING if (_SIBLING / "scripts" / "gugu_chart.py").is_file() else REPO

SCRIPTS = PLUGIN / "scripts"
CHART_PY = SCRIPTS / "gugu_chart.py"
