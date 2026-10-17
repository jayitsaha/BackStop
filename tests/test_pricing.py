from pathlib import Path

from insurance.pricing import load_terms, quote, book_projection

ROOT = Path(__file__).resolve().parents[1]
TERMS = load_terms(ROOT / "config/terms.yaml")


def test_grade_a_is_two_cents():
    q = quote("A", TERMS)
    assert abs(q.pure_premium_usd - 0.012) < 1e-6          # 1/10,000 x $120
    assert abs(q.gross_premium_usd - 0.02) < 1e-6          # / 0.60
    assert abs(q.commission_usd - 0.005) < 1e-6            # 25%
    assert abs(q.reinsurer_margin_usd - 0.003) < 1e-6
    assert q.status == "bound"


def test_grade_c_is_twenty_cents_and_f_declined():
    assert abs(quote("C", TERMS).gross_premium_usd - 0.20) < 1e-6
    f = quote("F", TERMS)
    assert abs(f.gross_premium_usd - 1.00) < 1e-6
    assert f.status == "declined"
    assert quote("D", TERMS).status == "suspended"


def test_sage_book_matches_the_pitch():
    proj = book_projection(quote("A", TERMS), 400_000)
    assert proj["gross_premium_usd"] == 8000.0
    assert proj["expected_claim_count"] == 40.0
    assert proj["expected_claims_usd"] == 4800.0
    assert proj["commission_usd"] == 2000.0
    assert proj["loss_ratio"] == 0.6
