"""Pure percentile/z-score math for feature normalization -- no DB access.

Two independent normalizations, computed against two different reference
sets:

  - trailing_exclusive_percentile_rank / trailing_exclusive_zscore: a
    ticker's own history -- "is this reading unusual for THIS ticker."
    The reference set for index i is the trailing ``window`` values
    STRICTLY BEFORE i (never including i itself -- percentile rank must
    exclude the current observation). Near the start of a series, the
    reference set is whatever prior history actually exists, capped at
    ``window`` -- never padded or substituted with a different window size.
    Below ``min_sample`` observations, the result is NaN, but the real
    observation count is still returned so callers can persist it
    (feature_percentiles.sample_size_self).

  - cross_sectional_percentile: same-day, across tickers -- "is this
    reading unusual TODAY, across the universe." Only tickers with a
    non-null value on that exact date participate.

Percentile convention throughout (matches the existing convention in
app.analysis.patterns.technicals.rolling_percentile_rank, applied here to an
excluded-current-value reference window instead of an included one):

    pct = (count of reference values <= current value) / sample_size * 100
"""

from __future__ import annotations

import numpy as np


def trailing_exclusive_percentile_rank(
    values: np.ndarray,
    *,
    window: int,
    min_sample: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Percentile rank of each value against its own excluded trailing window.

    For index i, the reference set is ``values[max(0, i-window):i]`` -- up
    to ``window`` prior observations, never including ``values[i]`` itself,
    and never padded or substituted with a different window size when fewer
    than ``window`` prior observations exist (the window is always "as much
    trailing history as exists, capped at ``window``", applied consistently
    -- never a different ad hoc size).

    Returns ``(pct, sample_size)`` arrays, both length ``len(values)``:
      - ``sample_size[i]``: count of non-NaN values in the reference window,
        independent of whether ``values[i]`` itself is NaN.
      - ``pct[i]``: NaN when ``values[i]`` is NaN, or when
        ``sample_size[i] < min_sample``. Otherwise the percentile rank
        (0..100) of ``values[i]`` among the non-NaN reference values.
    """
    if window < 1:
        raise ValueError("window must be >= 1")
    if min_sample < 1:
        raise ValueError("min_sample must be >= 1")

    n = len(values)
    pct = np.full(n, np.nan)
    sample_size = np.zeros(n, dtype=np.int64)

    for i in range(n):
        reference = values[max(0, i - window) : i]
        valid_reference = reference[~np.isnan(reference)]
        sample_size[i] = valid_reference.size

        if valid_reference.size < min_sample:
            continue
        current = values[i]
        if np.isnan(current):
            continue
        pct[i] = (
            float((valid_reference <= current).sum()) / valid_reference.size * 100.0
        )

    return pct, sample_size


def trailing_exclusive_zscore(
    values: np.ndarray,
    *,
    window: int,
    min_sample: int,
) -> np.ndarray:
    """Z-score of each value against its own excluded trailing window.

    Same reference-window rule as ``trailing_exclusive_percentile_rank``.
    Sample standard deviation (``ddof=1``). NaN when the reference has
    fewer than ``min_sample`` observations, when its standard deviation is
    zero (a constant reference window makes z-score undefined), or when the
    current value itself is NaN.
    """
    if window < 1:
        raise ValueError("window must be >= 1")
    if min_sample < 2:
        raise ValueError("min_sample must be >= 2 for a sample standard deviation")

    n = len(values)
    z = np.full(n, np.nan)

    for i in range(n):
        reference = values[max(0, i - window) : i]
        valid_reference = reference[~np.isnan(reference)]

        if valid_reference.size < min_sample:
            continue
        current = values[i]
        if np.isnan(current):
            continue

        std = float(np.std(valid_reference, ddof=1))
        if std == 0.0:
            continue
        mean = float(np.mean(valid_reference))
        z[i] = (float(current) - mean) / std

    return z


def trailing_exclusive_latest(
    prior_values: np.ndarray,
    current_value: float,
    *,
    window: int,
    min_sample: int,
) -> tuple[float | None, float | None, int]:
    """Percentile rank AND z-score of a single new value against its own
    trailing window -- O(window), computing only what's actually needed.

    Equivalent to calling trailing_exclusive_percentile_rank/
    trailing_exclusive_zscore on ``[*prior_values, current_value]`` and
    taking the last element of each result (verified by an exhaustive
    differential test), but WITHOUT recomputing every earlier index's
    percentile/z-score along the way. Those array functions are O(len *
    window) in total; computing only the newest day's result via them
    inside a day-by-day backfill loop is accidentally O(days^2) overall,
    since day N's call redundantly recomputes days 1..N-1 all over again
    just to discard them. This function is the O(1)-per-day building
    block for that loop -- use the array functions when you actually need
    every index's value (e.g. golden-fixture tests over a known series),
    use this one for incremental/backfill computation.

    Returns ``(pct, z, sample_size)``. Reference window is
    ``prior_values[-window:]`` (never including ``current_value``) --
    same "as much history as exists, capped at window, never padded"
    rule as the array functions.
    """
    if window < 1:
        raise ValueError("window must be >= 1")
    if min_sample < 1:
        raise ValueError("min_sample must be >= 1")

    reference = prior_values[-window:] if prior_values.size > window else prior_values
    valid_reference = reference[~np.isnan(reference)]
    sample_size = int(valid_reference.size)

    if sample_size < min_sample:
        return None, None, sample_size
    if np.isnan(current_value):
        return None, None, sample_size

    pct = float((valid_reference <= current_value).sum()) / sample_size * 100.0

    z: float | None = None
    if sample_size >= 2:
        std = float(np.std(valid_reference, ddof=1))
        if std != 0.0:
            mean = float(np.mean(valid_reference))
            z = (float(current_value) - mean) / std

    return pct, z, sample_size


def cross_sectional_percentile(values_by_ticker: dict[str, float | None]) -> dict[str, float]:
    """Same-day percentile rank of each ticker's value against every other
    ticker with a non-null value in ``values_by_ticker``.

    None/NaN entries are dropped from both the ranked set and the returned
    dict -- callers should treat a missing key as "no cross-sectional
    percentile for this ticker today", not as a zero.
    """
    tickers: list[str] = []
    peer_values: list[float] = []
    for ticker, value in values_by_ticker.items():
        if value is None:
            continue
        value_f = float(value)
        if np.isnan(value_f):
            continue
        tickers.append(ticker)
        peer_values.append(value_f)

    if not tickers:
        return {}

    arr = np.asarray(peer_values, dtype=float)
    return {
        ticker: float((arr <= value).sum()) / arr.size * 100.0
        for ticker, value in zip(tickers, arr)
    }
