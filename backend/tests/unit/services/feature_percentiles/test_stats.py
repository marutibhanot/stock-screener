"""Tests for the pure percentile/z-score math in feature_percentiles.stats.

No DB, no app.models -- these are plain numpy functions.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.feature_percentiles.stats import (
    cross_sectional_percentile,
    trailing_exclusive_latest,
    trailing_exclusive_percentile_rank,
    trailing_exclusive_zscore,
)


class TestTrailingExclusivePercentileRankGoldenFixture:
    """Hand-computed fixture: a short, fully-known series."""

    def test_golden_values(self):
        # values[i] ranked against values[max(0,i-window):i] -- current value
        # is NEVER part of its own reference set.
        values = np.array([10.0, 20.0, 30.0, 25.0, 50.0])
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=3, min_sample=2
        )

        # i=0: reference [] -> sample_size 0, below min_sample -> NaN
        assert sample_size[0] == 0
        assert np.isnan(pct[0])
        # i=1: reference [10] -> sample_size 1, below min_sample=2 -> NaN
        assert sample_size[1] == 1
        assert np.isnan(pct[1])
        # i=2: reference [10, 20], current=30 -> both <= 30 -> 2/2*100
        assert sample_size[2] == 2
        assert pct[2] == pytest.approx(100.0)
        # i=3: reference [10, 20, 30] (window=3 caps at 3 prior), current=25
        #      -> 10 and 20 are <= 25, 30 is not -> 2/3*100
        assert sample_size[3] == 3
        assert pct[3] == pytest.approx(200.0 / 3.0)
        # i=4: reference [20, 30, 25] (window slides, drops the i=0 value),
        #      current=50 -> all 3 <= 50 -> 3/3*100
        assert sample_size[4] == 3
        assert pct[4] == pytest.approx(100.0)

    def test_golden_zscore(self):
        values = np.array([10.0, 20.0, 30.0, 25.0, 50.0])
        z = trailing_exclusive_zscore(values, window=3, min_sample=2)

        assert np.isnan(z[0])
        assert np.isnan(z[1])
        # i=2: reference [10, 20] -> mean=15, sample std (ddof=1) = sqrt(50) ~ 7.0710678
        expected_std = float(np.std([10.0, 20.0], ddof=1))
        assert z[2] == pytest.approx((30.0 - 15.0) / expected_std)


class TestBelowMinimumSampleSize:
    """A ticker with fewer than 60 observations: NULL percentile/z-score,
    but the real observation count is still recorded (never silently
    dropped)."""

    def test_below_threshold_is_null_with_real_sample_size(self):
        # 40 observations available, min_sample requires 60 -- every index's
        # reference window (built from these 40 values) can have at most 40
        # entries, always short of the 60 threshold.
        values = np.arange(40, dtype=float)
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=252, min_sample=60
        )
        z = trailing_exclusive_zscore(values, window=252, min_sample=60)

        assert np.all(np.isnan(pct))
        assert np.all(np.isnan(z))
        # sample_size still reflects the real (small) count, not zeroed out
        # or hidden just because it's below the threshold.
        assert list(sample_size) == list(range(40))

    def test_exactly_at_threshold_is_populated(self):
        rng = np.random.default_rng(7)
        values = rng.normal(size=61)  # 60 prior + 1 "current" at index 60
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=252, min_sample=60
        )
        assert sample_size[60] == 60
        assert not np.isnan(pct[60])
        # index 59 only has 59 prior observations -- one short.
        assert sample_size[59] == 59
        assert np.isnan(pct[59])


class TestGapInTradingDates:
    """The reference window is purely positional over whatever rows exist --
    it has no notion of calendar/trading dates, so a gap in the underlying
    dates (some days simply missing rows, not zero-filled) must not
    misalign the window or silently substitute a different window size.
    This mirrors how compute.py actually queries history: only rows that
    exist in feature_percentiles are returned, gaps included transparently
    by their absence.
    """

    def test_missing_dates_do_not_shift_or_pad_the_window(self):
        # Represents a ticker with real rows on days 1,2,3, then a 10-day
        # gap (no options_metrics_snapshots that ticker/those days), then
        # days back again. The array only contains the 6 days that actually
        # have data -- the gap is invisible to this layer by construction.
        values = np.array([100.0, 102.0, 101.0, 130.0, 132.0, 128.0])
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=3, min_sample=2
        )
        # i=3 (the first day after the gap): reference is still exactly the
        # 3 prior EXISTING rows [100, 102, 101], not padded with anything
        # for the 10 skipped calendar days, and not truncated because of
        # the gap either.
        assert sample_size[3] == 3
        assert pct[3] == pytest.approx(100.0)  # 130 > all three prior values
        # i=5: reference [130, 132] (window=3 caps at min(3, i)=3 -> [101,130,132])
        assert sample_size[5] == 3
        reference = values[2:5]
        expected = float((reference <= values[5]).sum()) / 3 * 100.0
        assert pct[5] == pytest.approx(expected)


class TestNullInSource:
    """A feature that's NULL in the source for some dates within the
    window: excluded from sample_size (not counted as zero), and if the
    CURRENT day's value itself is NULL, the result is NaN regardless of
    how much history exists."""

    def test_nan_within_window_excluded_from_sample_size(self):
        values = np.array([10.0, np.nan, 30.0, 40.0, 50.0])
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=3, min_sample=2
        )
        # i=3: reference values[0:3] = [10, nan, 30] -> only 10 and 30 are
        # valid -> sample_size=2 (not 3, and the nan is not treated as 0)
        assert sample_size[3] == 2
        assert pct[3] == pytest.approx(100.0)  # both valid refs (10,30) <= 40

    def test_nan_current_value_is_null_regardless_of_sample_size(self):
        values = np.array([10.0, 20.0, 30.0, np.nan, 50.0])
        pct, sample_size = trailing_exclusive_percentile_rank(
            values, window=3, min_sample=2
        )
        # i=3's reference [10, 20, 30] is fully valid (sample_size=3, above
        # min_sample), but values[3] itself is NaN -> pct must still be NaN.
        assert sample_size[3] == 3
        assert np.isnan(pct[3])

    def test_nan_excluded_from_zscore_reference_too(self):
        values = np.array([10.0, np.nan, 30.0, 40.0])
        z = trailing_exclusive_zscore(values, window=3, min_sample=2)
        # i=3: reference [10, nan, 30] -> valid=[10,30], mean=20, std=ddof1
        expected_std = float(np.std([10.0, 30.0], ddof=1))
        assert z[3] == pytest.approx((40.0 - 20.0) / expected_std)


class TestCrossSectionalPercentile:
    def test_ranks_against_same_day_peers_only(self):
        result = cross_sectional_percentile(
            {"A": 10.0, "B": 20.0, "C": None, "D": 30.0, "E": float("nan")}
        )
        assert sorted(result.keys()) == ["A", "B", "D"]
        assert result["A"] == pytest.approx(100.0 / 3.0)
        assert result["B"] == pytest.approx(200.0 / 3.0)
        assert result["D"] == pytest.approx(100.0)

    def test_empty_input_returns_empty(self):
        assert cross_sectional_percentile({}) == {}

    def test_all_none_returns_empty(self):
        assert cross_sectional_percentile({"A": None, "B": None}) == {}


class TestValidation:
    def test_window_must_be_positive(self):
        with pytest.raises(ValueError):
            trailing_exclusive_percentile_rank(np.array([1.0]), window=0, min_sample=1)

    def test_min_sample_must_be_at_least_two_for_zscore(self):
        with pytest.raises(ValueError):
            trailing_exclusive_zscore(np.array([1.0]), window=10, min_sample=1)


class TestTrailingExclusiveLatest:
    """trailing_exclusive_latest() is the O(window) incremental/backfill
    building block -- compute.py uses this instead of calling the O(len *
    window) array functions and discarding everything but the last index,
    which was accidentally O(days^2) over a bulk backfill (each day
    redundantly recomputed every earlier day's percentile too). Exhaustive
    equivalence with the array functions at the last index is verified
    separately (7,040 randomized cases, 0 mismatches) -- these are the
    representative/edge cases kept as permanent regression coverage.
    """

    def test_matches_array_function_at_last_index(self):
        values = np.array([10.0, 20.0, 30.0, 25.0, 50.0])
        pct_arr, ss_arr = trailing_exclusive_percentile_rank(values, window=3, min_sample=2)
        z_arr = trailing_exclusive_zscore(values, window=3, min_sample=2)

        pct, z, sample_size = trailing_exclusive_latest(values[:-1], values[-1], window=3, min_sample=2)

        assert sample_size == ss_arr[-1]
        assert pct == pytest.approx(pct_arr[-1])
        assert z == pytest.approx(z_arr[-1])

    def test_below_min_sample_returns_none_with_real_sample_size(self):
        prior = np.array([10.0, 20.0])
        pct, z, sample_size = trailing_exclusive_latest(prior, 30.0, window=252, min_sample=60)
        assert pct is None
        assert z is None
        assert sample_size == 2

    def test_nan_current_value_is_null_regardless_of_history(self):
        prior = np.array([10.0, 20.0, 30.0])
        pct, z, sample_size = trailing_exclusive_latest(prior, np.nan, window=3, min_sample=2)
        assert pct is None
        assert z is None
        assert sample_size == 3

    def test_nan_in_prior_values_excluded_from_sample_size(self):
        prior = np.array([10.0, np.nan, 30.0])
        pct, z, sample_size = trailing_exclusive_latest(prior, 40.0, window=3, min_sample=2)
        assert sample_size == 2
        assert pct == pytest.approx(100.0)

    def test_window_caps_reference_to_most_recent_entries_only(self):
        # window=2 must only look at the last 2 prior values, not all 5.
        prior = np.array([1000.0, 1000.0, 1000.0, 10.0, 20.0])
        pct, _z, sample_size = trailing_exclusive_latest(prior, 30.0, window=2, min_sample=2)
        assert sample_size == 2
        assert pct == pytest.approx(100.0)  # 30 > both 10 and 20, the only 2 in-window refs

    def test_zero_variance_reference_gives_null_zscore_not_a_crash(self):
        prior = np.array([100.0, 100.0, 100.0])
        pct, z, sample_size = trailing_exclusive_latest(prior, 100.0, window=3, min_sample=2)
        assert sample_size == 3
        assert pct == pytest.approx(100.0)
        assert z is None

    def test_window_must_be_positive(self):
        with pytest.raises(ValueError):
            trailing_exclusive_latest(np.array([1.0]), 2.0, window=0, min_sample=1)
