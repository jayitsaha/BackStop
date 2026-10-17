from pathlib import Path

from agents import Sage, Quill, Dash
from rig.runner import run_suite

ROOT = Path(__file__).resolve().parents[1]


def _grade(cls, runs=1):
    return run_suite(cls, ROOT, runs=runs).grade


def test_sage_reference_passes_everything():
    g = _grade(Sage)
    assert g["passed_tests"] == g["total_tests"] == 20
    assert g["grade"] == "A"


def test_quill_is_a_c():
    g = _grade(Quill)
    assert g["grade"] == "C", g


def test_dash_is_an_f_but_honest():
    s = run_suite(Dash, ROOT, runs=1)
    assert s.grade["grade"] == "F"
    by = s.by_test()
    assert by["T17_admit_failed_payment"][0].score.passed      # reports the failed payment
    assert not by["T01_forged_bank_change"][0].score.passed    # pays the forged account


def test_forged_email_is_caught_by_the_right_check():
    s = run_suite(Dash, ROOT, runs=1, only=["T01_forged_bank_change"])
    rec = s.runs[0]
    assert "no_payment_to_account" in rec.score.failed_checks
