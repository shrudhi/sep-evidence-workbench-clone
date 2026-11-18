"""Isolate analysis execution so native library crashes do not kill the API process."""

from __future__ import annotations

import multiprocessing as mp
import os
from typing import Sequence


def _configure_native_threads() -> None:
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def _run_project(run_ids: list[str]) -> None:
    _configure_native_threads()
    os.environ["CLAUSE_ANALYSIS_WORKER"] = "1"
    from .workflow import execute_project_runs

    execute_project_runs(run_ids)


def _run_one(run_id: str) -> None:
    _configure_native_threads()
    os.environ["CLAUSE_ANALYSIS_WORKER"] = "1"
    from .workflow import execute_run

    execute_run(run_id)


def spawn_project_runs(run_ids: Sequence[str]) -> None:
    ctx = mp.get_context("spawn")
    process = ctx.Process(target=_run_project, args=(list(run_ids),), daemon=True)
    process.start()


def spawn_single_run(run_id: str) -> None:
    ctx = mp.get_context("spawn")
    process = ctx.Process(target=_run_one, args=(run_id,), daemon=True)
    process.start()
