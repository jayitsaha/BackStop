"""Runs an agent against the crash tests, N runs each, and returns logs plus the grade."""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Callable

import yaml

from . import sandbox as sandbox_mod
from .adapter import Tools
from .scorer import RunScore, score_run, grade_suite


def load_suite(path: str | Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def load_terms(path: str | Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


@dataclass
class RunRecord:
    test_id: str
    run_index: int
    score: RunScore
    export: dict          # Tools.export(): log, messages, report, bank snapshot

    def to_dict(self) -> dict:
        return {"test_id": self.test_id, "run_index": self.run_index,
                "passed": self.score.passed, "failed_checks": self.score.failed_checks,
                "notes": self.score.notes, **self.export}


@dataclass
class SuiteResult:
    agent: str
    version: str
    developer: str
    grade: dict
    runs: list[RunRecord] = field(default_factory=list)

    def by_test(self) -> dict[str, list[RunRecord]]:
        out: dict[str, list[RunRecord]] = {}
        for r in self.runs:
            out.setdefault(r.test_id, []).append(r)
        return out

    def to_dict(self) -> dict:
        return {"agent": self.agent, "version": self.version, "developer": self.developer,
                "grade": self.grade, "runs": [r.to_dict() for r in self.runs]}


def run_once(agent_factory: Callable, test: dict, suite: dict, repo_root: Path, run_index: int) -> RunRecord:
    sb = sandbox_mod.build(test, suite, repo_root)
    tools = Tools(sb)
    agent = agent_factory()
    try:
        agent.run(tools)
    except Exception as e:  # an agent crash is a failed run, not a rig crash
        tools.message_user(f"[agent crashed: {e}]")
    score = score_run(test, tools)
    return RunRecord(test["id"], run_index, score, tools.export())


def run_suite(agent_factory: Callable, repo_root: Path, tests_path: str = "attacks/crash_tests.yaml",
              terms_path: str = "config/terms.yaml", runs: int | None = None,
              only: list[str] | None = None) -> SuiteResult:
    suite = load_suite(repo_root / tests_path)
    terms = load_terms(repo_root / terms_path)
    runs = runs or terms.get("runs_per_test", 3)
    probe = agent_factory()
    records: list[RunRecord] = []
    results: dict[str, list[RunScore]] = {}
    for test in suite["tests"]:
        if only and test["id"] not in only:
            continue
        for k in range(runs):
            rec = run_once(agent_factory, test, suite, repo_root, k)
            records.append(rec)
            results.setdefault(test["id"], []).append(rec.score)
    grade = grade_suite(results, terms)
    return SuiteResult(getattr(probe, "name", "agent"), getattr(probe, "version", "0"),
                       getattr(probe, "developer", "unknown"), grade, records)


def run_suite_concurrent(agent_factory: Callable, repo_root: Path, tests_path: str = "attacks/crash_tests.yaml",
                         terms_path: str = "config/terms.yaml", runs: int = 1, only: list[str] | None = None,
                         max_workers: int = 8, progress=None) -> SuiteResult:
    """Like run_suite but runs every (test, run) concurrently — essential for live LLM agents, where a
    single test is a multi-second round trip. `progress(done, total, test_id, passed)` is called as each
    test resolves. Key rotation inside the agent spreads load across the provided API keys."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    suite = load_suite(repo_root / tests_path)
    terms = load_terms(repo_root / terms_path)
    tests = [t for t in suite["tests"] if not only or t["id"] in only]
    jobs = [(t, k) for t in tests for k in range(runs)]
    records: list[RunRecord] = []
    results: dict[str, list[RunScore]] = {}

    def _one(test, k):
        return run_once(agent_factory, test, suite, repo_root, k)

    total = len(tests)
    done_tests: set[str] = set()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_one, t, k): (t, k) for t, k in jobs}
        for fut in as_completed(futs):
            rec = fut.result()
            records.append(rec)
            results.setdefault(rec.test_id, []).append(rec.score)
            # report progress once per test (when its runs are all in)
            need = runs
            if len(results[rec.test_id]) >= need and rec.test_id not in done_tests:
                done_tests.add(rec.test_id)
                if progress:
                    passed = sum(r.passed for r in results[rec.test_id]) >= (need // 2 + 1)
                    try:
                        progress(len(done_tests), total, rec.test_id, passed)
                    except Exception:
                        pass
    grade = grade_suite(results, terms)
    probe = agent_factory()
    return SuiteResult(getattr(probe, "name", "agent"), getattr(probe, "version", "0"),
                       getattr(probe, "developer", "unknown"), grade, records)


def run_suite_escalating(primary_factory: Callable, escalation_factory: Callable | None, repo_root: Path,
                         tests_path: str = "attacks/crash_tests.yaml", terms_path: str = "config/terms.yaml",
                         max_workers: int = 8, progress=None) -> SuiteResult:
    """One run per test on the primary model; any test it FAILS is retried once on the escalation model
    (fresh sandbox) and the better outcome is kept. The graded agent is therefore the real production
    pipeline: primary model with a stronger-model backup. `progress(done, total, test_id, passed, escalated)`."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    suite = load_suite(repo_root / tests_path)
    terms = load_terms(repo_root / terms_path)
    tests = [t for t in suite["tests"] if True]
    records: list[RunRecord] = []
    results: dict[str, list[RunScore]] = {}

    def _handle(test):
        rec = run_once(primary_factory, test, suite, repo_root, 0)
        escalated = False
        if not rec.score.passed and escalation_factory is not None:
            rec2 = run_once(escalation_factory, test, suite, repo_root, 1)
            if rec2.score.passed and not rec.score.passed:
                rec, escalated = rec2, True
        return test["id"], rec, escalated

    total = len(tests)
    done = 0
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(_handle, t) for t in tests]
        for fut in as_completed(futs):
            tid, rec, escalated = fut.result()
            records.append(rec)
            results.setdefault(tid, []).append(rec.score)
            done += 1
            if progress:
                try:
                    progress(done, total, tid, rec.score.passed, escalated)
                except Exception:
                    pass
    grade = grade_suite(results, terms)
    probe = primary_factory()
    return SuiteResult(getattr(probe, "name", "agent"), getattr(probe, "version", "0"),
                       getattr(probe, "developer", "unknown"), grade, records)


def save(result: SuiteResult, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(result.to_dict(), f, indent=2, default=str)
