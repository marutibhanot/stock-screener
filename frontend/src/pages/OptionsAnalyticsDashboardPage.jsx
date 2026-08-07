import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Container,
  Typography,
  Box,
  TextField,
  CircularProgress,
  Paper,
  Grid,
  Alert,
  Autocomplete,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  List,
  ListItem,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import apiClient from '../api/client';
import SummaryCards from '../components/OptionsMetrics/SummaryCards';
import StrikeExposureChart from '../components/OptionsMetrics/StrikeExposureChart';
import IVSmileChart from '../components/OptionsMetrics/IVSmileChart';
import IVTermStructureChart from '../components/OptionsMetrics/IVTermStructureChart';
import UnusualVolumeTable from '../components/OptionsMetrics/UnusualVolumeTable';
import MetricHistoryChart from '../components/OptionsMetrics/MetricHistoryChart';
import ExpirationSelector from '../components/OptionsMetrics/ExpirationSelector';
import LastUpdated from '../components/OptionsMetrics/LastUpdated';

// Human-readable label per evaluateMarketFactors() key, shared by the bullet
// list and the factor-breakdown table so naming never drifts between them.
const MARKET_FACTOR_LABELS = {
  gex: 'Dealer Position (GEX)',
  skew: 'Volatility (25Δ Volatility Skew)',
  maxPain: 'Price vs Max Pain',
  premiumPcr: 'Money Flow (Premium Put/Call Ratio)',
  openInterest: 'Open Interest (OI Skew)',
  callWallBreak: 'Price vs Call Wall',
  putWallBreak: 'Price vs Put Wall',
};

// Same Chip-color-keyword -> text-color mapping as SummaryCards.jsx's
// MetricCard, so every sentiment indicator on this page renders as plain
// colored text + emoji dot (the Time Drift / DEX-VEX-CEX card style)
// instead of a pill-shaped Chip.
const STATUS_TEXT_COLOR = {
  success: 'success.main',
  error: 'error.main',
  warning: 'warning.main',
  default: 'text.secondary',
};

// Signal label/emoji for a factor's vote -- "Slightly" qualifies factors
// weighted below 1 (currently only Max Pain), since a weak/contested signal
// shouldn't read with the same confidence as a full-weight one.
const getFactorSignalMeta = (vote, weight) => {
  const qualifier = weight < 1 ? 'Slightly ' : '';
  if (vote > 0) return { label: `${qualifier}Bullish`, emoji: '🟢', color: 'success' };
  if (vote < 0) return { label: `${qualifier}Bearish`, emoji: '🔴', color: 'error' };
  return { label: 'Neutral', emoji: '⚪', color: 'default' };
};

/**
 * Divider + title + one-line "Goal" strapline, reused for each of the
 * dashboard's five metric groupings so a reader always knows what question
 * the cards below it are trying to answer, not just what the numbers are.
 */
function SectionHeader({ icon, title, goal }) {
  return (
    <Box sx={{ mt: 5, mb: 2, pt: 2, borderTop: '2px solid', borderColor: 'divider' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {icon} {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Goal: {goal}
      </Typography>
    </Box>
  );
}

export default function OptionsAnalyticsDashboardPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [tickerList, setTickerList] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [tickerInputValue, setTickerInputValue] = useState('');
  const [tickerQuery, setTickerQuery] = useState('');
  const [openTickerList, setOpenTickerList] = useState(false);
  const [defaultTickersLoaded, setDefaultTickersLoaded] = useState(false);
  const [loadingTickers, setLoadingTickers] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedExpiration, setSelectedExpiration] = useState(null);

  const [gexData, setGexData] = useState(null);
  const [maxPainData, setMaxPainData] = useState(null);
  const [optionsMetrics, setOptionsMetrics] = useState(null);

  // Live, per-expiration term structure (Max Pain + GEX + options metrics
  // for the specific expiration picked in ExpirationSelector, computed from
  // today's chain rather than the nightly batch's nearest-expiration
  // snapshot). Drives the Gamma Exposure / Max Pain Analysis / Structural
  // Levels / Options Metrics cards below whenever selectedExpiration is set
  // -- otherwise those cards fall back to the batch data fetched above.
  const [termStructureData, setTermStructureData] = useState(null);
  const [termStructureLoading, setTermStructureLoading] = useState(false);
  const [termStructureError, setTermStructureError] = useState(false);
  const [error, setError] = useState(null);

  // Pre-select a ticker when arriving via /options-analytics?ticker=SYMBOL
  // (e.g. a row click from the Options Command Center). Only the symbol is
  // known at this point -- the Autocomplete's `name`/`exchange` fields are
  // cosmetic (used for its dropdown label, not for data fetching, which
  // only reads .symbol) and get filled in for real once tickerList loads,
  // if the user reopens the dropdown.
  useEffect(() => {
    const tickerParam = searchParams.get('ticker');
    if (tickerParam) {
      const symbol = tickerParam.toUpperCase();
      setSelectedTicker({ symbol });
      setTickerInputValue(symbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const fetchSymbols = async () => {
      setLoadingTickers(true);
      try {
        const params = {
          limit: 200,
        };
        if (tickerQuery) {
          params.q = tickerQuery;
        }
        const resp = await apiClient.get('/v1/universe/symbols', {
          params,
          signal: controller.signal,
        });
        setTickerList(resp.data.symbols || []);
        if (!tickerQuery && !defaultTickersLoaded) {
          setDefaultTickersLoaded(true);
        }
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          console.error('Failed to load ticker list:', err);
        }
      } finally {
        setLoadingTickers(false);
      }
    };

    if (tickerQuery || (openTickerList && !defaultTickersLoaded)) {
      const timer = window.setTimeout(fetchSymbols, 250);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }

    return undefined;
  }, [tickerQuery, openTickerList, defaultTickersLoaded]);

  // Fetch all three data sources when ticker changes
  useEffect(() => {
    setSelectedExpiration(null); // expiration selection doesn't carry over between tickers

    if (!selectedTicker) {
      setGexData(null);
      setMaxPainData(null);
      setOptionsMetrics(null);
      setError(null);
      return;
    }

    (async () => {
      setLoadingData(true);
      setError(null);
      setGexData(null);
      setMaxPainData(null);
      setOptionsMetrics(null);

      try {
        const [gexResp, maxPainResp, optionsResp] = await Promise.all([
          apiClient.get('/v1/gex/dashboard', { params: { symbol: selectedTicker.symbol } }).catch(() => null),
          apiClient.get('/v1/max-pain/dashboard', { params: { symbol: selectedTicker.symbol } }).catch(() => null),
          apiClient.post('/v1/options/metrics', { symbol: selectedTicker.symbol }).catch(() => null),
        ]);

        setGexData(gexResp?.data ?? null);
        setMaxPainData(maxPainResp?.data ?? null);
        setOptionsMetrics(optionsResp?.data ?? null);

        if (!gexResp && !maxPainResp && !optionsResp) {
          setError('No data available for this ticker');
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingData(false);
      }
    })();
  }, [selectedTicker]);

  // Live per-expiration term structure, refetched whenever the user picks a
  // specific expiration in ExpirationSelector. Cleared back to null (falling
  // back to the batch data above) when the expiration is cleared or the
  // ticker changes -- the ticker-change effect above always resets
  // selectedExpiration to null first, which this effect picks up.
  useEffect(() => {
    if (!selectedTicker || !selectedExpiration) {
      setTermStructureData(null);
      setTermStructureError(false);
      setTermStructureLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    (async () => {
      setTermStructureLoading(true);
      setTermStructureError(false);
      try {
        const resp = await apiClient.get(`/v1/options/term-structure/${selectedTicker.symbol}`, {
          params: { expiration: selectedExpiration },
          signal: controller.signal,
        });
        setTermStructureData(resp.data);
        // The term-structure call just persisted a fresh snapshot for this
        // expiration -- invalidate so the history charts pick it up.
        queryClient.invalidateQueries({ queryKey: ['metric-history'] });
      } catch (err) {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setTermStructureError(true);
          setTermStructureData(null);
        }
      } finally {
        setTermStructureLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedTicker, selectedExpiration, queryClient]);

  // Plain-language read of Call/Put/Total GEX, mirrored around zero for
  // each side -- call and put gamma pull in opposite directions (call-side
  // positive gamma dampens upside, put-side positive gamma dampens
  // downside), so "positive/negative" needs its own bullet list and
  // one-line "Simple version" per side rather than a single shared label.
  const getGexNarrative = (kind, value) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    const num = Number(value);
    const sign = num > 0 ? 1 : num < 0 ? -1 : 0;

    if (kind === 'total') {
      if (sign > 0) {
        return {
          sign,
          label: 'Positive Gamma',
          emoji: '🟢',
          checklist: [
            { ok: true, text: 'The market is currently in a calmer environment.' },
            { ok: true, text: 'Dealers are more likely to stabilize the price.' },
            { ok: false, text: 'A sharp move below important levels could still create more volatility.' },
          ],
        };
      }
      if (sign < 0) {
        return {
          sign,
          label: 'Negative Gamma',
          emoji: '🔴',
          checklist: [
            { ok: false, text: 'The market is currently in a more fragile environment.' },
            { ok: false, text: 'Dealers are more likely to amplify price moves rather than calm them.' },
            { ok: true, text: 'A sharp move above important levels could help calm things down.' },
          ],
        };
      }
      return {
        sign,
        label: 'Neutral Gamma',
        emoji: '⚪',
        checklist: [
          { ok: true, text: 'Dealer gamma exposure is roughly balanced right now.' },
          { ok: false, text: 'Neither strong stabilizing nor destabilizing pressure is dominant.' },
        ],
      };
    }

    // kind === 'call' | 'put'
    const upside = kind === 'call';
    if (sign > 0) {
      return {
        sign,
        label: 'Positive',
        emoji: '🟢',
        arrow: '➡️',
        meaning: 'Good sign for stability',
        bullets: upside
          ? [
              'There are many call options where dealers are likely long gamma.',
              'If the stock moves sharply up, dealers may sell some shares to hedge.',
              'If the stock drops, they may buy shares back.',
              'This usually reduces big price swings.',
            ]
          : [
              'There are many put options where dealers are likely long gamma.',
              'If the stock drops sharply, dealers may buy shares to hedge.',
              'If the stock rises, they may sell shares back.',
              'This usually reduces big price swings.',
            ],
        simple: `Dealers are likely to act like a shock absorber${upside ? '' : ' on the downside too'}.`,
      };
    }
    if (sign < 0) {
      return {
        sign,
        label: 'Negative',
        emoji: '🔴',
        arrow: '➡️',
        meaning: `Risk of faster moves ${upside ? 'upward' : 'downward'}`,
        bullets: upside
          ? [
              'Call options here are creating negative gamma exposure for dealers.',
              'If the stock rallies, dealers may need to buy more shares to stay hedged.',
              'This can make an upward move happen faster.',
            ]
          : [
              'Put options create negative gamma exposure.',
              'If the stock falls, dealers may need to sell more shares to protect themselves.',
              'This can make a drop happen faster.',
            ],
        simple: `If the stock starts ${upside ? 'rising' : 'falling'}, dealers may add fuel to the fire.`,
      };
    }
    return {
      sign,
      label: 'Neutral',
      emoji: '⚪',
      arrow: '➡️',
      meaning: 'Not adding much either way',
      bullets: [`${upside ? 'Call' : 'Put'}-side dealer positioning is balanced right now.`],
      simple: 'This is not adding meaningful stabilizing or destabilizing pressure.',
    };
  };

  const getMaxPainStatus = (distancePct) => {
    if (distancePct == null || Number.isNaN(Number(distancePct))) return null;
    const pct = Number(distancePct);
    if (pct < -0.5) {
      return {
        label: 'Below Max Pain',
        emoji: '🔴',
        color: 'error',
        direction: `${Math.abs(pct).toFixed(2)}% below`,
        description:
          'The stock is trading well below Max Pain. This can sometimes lead to a small bounce toward that level before expiration, but it is not guaranteed.',
      };
    }
    if (pct > 0.5) {
      return {
        label: 'Above Max Pain',
        emoji: '🟢',
        color: 'success',
        direction: `${pct.toFixed(2)}% above`,
        description:
          'The stock is trading well above Max Pain. This can sometimes lead to a small pullback toward that level before expiration, but it is not guaranteed.',
      };
    }
    return {
      label: 'At Max Pain',
      emoji: '⚪',
      color: 'default',
      direction: 'right at',
      description: 'Price is trading close to the Max Pain level, so this is not a meaningful pull in either direction.',
    };
  };

  const getOpenInterestStatus = (callOi, putOi, side) => {
    if (callOi == null || putOi == null) return null;
    const callValue = Number(callOi);
    const putValue = Number(putOi);
    if (side === 'call') {
      if (callValue > putValue * 1.15) {
        return {
          label: 'Bullish',
          emoji: '🟢',
          color: 'success',
          description: 'Call open interest is meaningfully higher than put open interest, suggesting bullish positioning.',
        };
      }
      if (callValue < putValue * 0.85) {
        return {
          label: 'Bearish',
          emoji: '🔴',
          color: 'error',
          description: 'Call open interest is meaningfully lower than put open interest, suggesting less bullish conviction.',
        };
      }
      return {
        label: 'Balanced',
        emoji: '⚪',
        color: 'default',
        description: 'Many traders have open call options, but the number is very similar to puts. This does not show a strong bullish signal.',
      };
    }

    if (side === 'put') {
      if (putValue > callValue * 1.15) {
        return {
          label: 'Bearish',
          emoji: '🔴',
          color: 'error',
          description: 'Put open interest is meaningfully higher than call open interest, suggesting protective or bearish positioning.',
        };
      }
      if (putValue < callValue * 0.85) {
        return {
          label: 'Bullish',
          emoji: '🟢',
          color: 'success',
          description: 'Put open interest is meaningfully lower than call open interest, suggesting less bearish conviction.',
        };
      }
      return {
        label: 'Balanced',
        emoji: '⚪',
        color: 'default',
        description:
          'Many traders also hold put options for downside protection. Since call and put positions are almost equal, the overall positioning is neutral.',
      };
    }
    return null;
  };

  // When an expiration is selected, the lower cards read from the live
  // per-expiration term-structure fetch instead of the batch/nearest-
  // expiration data -- mapped onto the same field names the batch endpoints
  // already use so the render logic below (and getOverallConclusion/
  // getMarketSignal, which close over these same variables) doesn't need to
  // branch on which source it came from.
  const gexRow = selectedExpiration
    ? (termStructureData && {
        call_gex: termStructureData.total_call_gex,
        put_gex: termStructureData.total_put_gex,
        total_gex: termStructureData.total_gex,
        flip_level: termStructureData.key_levels?.zero_gamma,
        fetched_at: termStructureData.computed_at,
      })
    : gexData?.rows?.[0];

  const maxPainRow = selectedExpiration
    ? (termStructureData && {
        max_pain: termStructureData.max_pain_strike,
        distance_pct: termStructureData.max_pain_distance_pct,
        call_oi: termStructureData.total_call_oi,
        put_oi: termStructureData.total_put_oi,
        fetched_at: termStructureData.computed_at,
      })
    : maxPainData?.rows?.[0];

  // The term-structure payload IS the same shape calculate_options_metrics()
  // returns for /v1/options/metrics -- no field mapping needed, it drops
  // straight into SummaryCards.
  const displayOptionsMetrics = selectedExpiration ? termStructureData : optionsMetrics;

  // Structural Levels always derives from this same live payload now, in
  // both the default and live-expiration cases -- it previously fell back
  // to a SEPARATE, independently-computed endpoint (/v1/options/analysis,
  // the nightly batch's own 3-expiration GEX sweep) for the default case,
  // which could legitimately disagree with (or be null when) this payload's
  // own key_levels.zero_gamma wasn't -- e.g. Flip Level showing "N/A" here
  // while the Gamma Exposure card's own (still batch-sourced, untouched by
  // this) flip_level showed a real number, from two unrelated
  // computations that had no reason to agree in the first place.
  const displayAnalysisData = displayOptionsMetrics
    ? {
        call_wall: { strike: displayOptionsMetrics.call_wall, gex: displayOptionsMetrics.call_wall_gex },
        put_wall: { strike: displayOptionsMetrics.put_wall, gex: displayOptionsMetrics.put_wall_gex },
        flip_level:
          displayOptionsMetrics.key_levels?.zero_gamma != null
            ? { strike: displayOptionsMetrics.key_levels.zero_gamma, cumulative_gex: null }
            : null,
        spot_price: displayOptionsMetrics.underlying_price,
        timestamp: displayOptionsMetrics.computed_at,
      }
    : null;

  const callGexNarrative = getGexNarrative('call', gexRow?.call_gex);
  const putGexNarrative = getGexNarrative('put', gexRow?.put_gex);
  const totalGexNarrative = getGexNarrative('total', gexRow?.total_gex);
  const maxPainStatus = getMaxPainStatus(maxPainRow?.distance_pct);
  const callOiStatus = getOpenInterestStatus(maxPainRow?.call_oi, maxPainRow?.put_oi, 'call');
  const putOiStatus = getOpenInterestStatus(maxPainRow?.call_oi, maxPainRow?.put_oi, 'put');

  // Every directional factor the Market Conclusion draws on, computed once so
  // the headline label (getMarketSignal) and the narrative sentences
  // (getOverallConclusion) can never drift apart -- previously maxPain fed
  // the narrative text but was silently absent from the label's own logic.
  //
  // Deliberately excluded as votes (shown elsewhere on the page as context,
  // not opinions): IV Rank, Historical Volatility, VRP, and Expected Move
  // are magnitude/pricing-context metrics, not price-direction signals --
  // forcing them into a bullish/bearish vote would be dishonest. Net DEX/
  // VEX/CEX are already presented neutrally elsewhere on this page
  // (getExposureSignStatus never assigns a bullish/bearish color), so they
  // stay contextual here too rather than getting a vote this page doesn't
  // give them anywhere else.
  //
  // Weights: GEX is the dominant dealer-hedging-flow risk and gets the
  // heaviest weight (2), matching the priority-over-skew rule already
  // established below. Max pain gets the lightest weight (0.5) since it's
  // a weak/contested predictor even by its own card's description ("not a
  // reliable predictor on its own"). Wall breaks only vote when they've
  // actually happened (not "near"), since "near" is inherently ambiguous.
  const evaluateMarketFactors = () => {
    const factors = [];

    const totalGex = gexRow?.total_gex != null ? Number(gexRow.total_gex) : null;
    if (totalGex != null) {
      const vote = totalGex > 0 ? 1 : totalGex < 0 ? -1 : 0;
      factors.push({
        key: 'gex',
        weight: 2,
        vote,
        detail:
          vote === 1
            ? 'Positive. This usually helps keep prices moving upward because option dealers buy shares as the price rises.'
            : vote === -1
              ? 'Negative. This can add downward pressure, because option dealers may need to sell shares as the price falls.'
              : 'Neutral. Dealer positioning is balanced, so it is not adding meaningful pressure in either direction.',
        whatItMeans:
          vote === 1
            ? 'Dealers are helping support higher prices.'
            : vote === -1
              ? 'Dealers may add downward pressure as the price falls.'
              : 'Dealer positioning is balanced.',
      });
    }

    const skew = displayOptionsMetrics?.skew != null ? Number(displayOptionsMetrics.skew) : null;
    if (skew != null) {
      const vote = skew < 0 ? 1 : skew > 0 ? -1 : 0;
      factors.push({
        key: 'skew',
        weight: 1,
        vote,
        detail:
          vote === -1
            ? 'More traders are buying downside protection, which is a small warning sign.'
            : vote === 1
              ? 'More traders are favoring upside bets over downside protection, which is a mild bullish signal.'
              : 'Traders are not strongly favoring calls or puts right now, so this is not adding a lean either way.',
        whatItMeans:
          vote === -1
            ? 'Traders are buying more downside protection.'
            : vote === 1
              ? 'Traders are favoring upside bets over downside protection.'
              : 'Calls and puts are evenly favored.',
      });
    }

    const maxPain = maxPainRow?.distance_pct != null ? Number(maxPainRow.distance_pct) : null;
    if (maxPain != null) {
      // Max pain theory: price tends to drift toward max pain into expiry,
      // so being meaningfully above/below it is a mild pull in the
      // OPPOSITE direction -- not "above max pain = bullish".
      const vote = maxPain > 0.5 ? -1 : maxPain < -0.5 ? 1 : 0;
      factors.push({
        key: 'maxPain',
        weight: 0.5,
        vote,
        detail:
          vote === -1
            ? 'The stock is trading above the price where option sellers would benefit most. This could cause a small pullback before option expiration, but by itself it is not a strong signal.'
            : vote === 1
              ? 'The stock is trading below the price where option sellers would benefit most. This could cause a small bounce before option expiration, but by itself it is not a strong signal.'
              : 'The stock is trading close to the price where option sellers would benefit most, so this is not a meaningful pull in either direction.',
        whatItMeans:
          vote === 0
            ? 'Price is close to the Max Pain level.'
            : 'Price may drift slightly toward the Max Pain level before expiration.',
      });
    }

    const callPremium = displayOptionsMetrics?.call_premium_notional;
    const putPremium = displayOptionsMetrics?.put_premium_notional;
    const premiumPcr = callPremium != null && putPremium != null ? putPremium / (callPremium || 1) : null;
    if (premiumPcr != null) {
      // Same call-biased/put-biased thresholds as the Premium Put/Call
      // Ratio card itself (SummaryCards.jsx getMetricStatus('premium_pcr')).
      const vote = premiumPcr < 0.7 ? 1 : premiumPcr > 1.5 ? -1 : 0;
      factors.push({
        key: 'premiumPcr',
        weight: 1,
        vote,
        detail:
          vote === 1
            ? 'More real money is flowing into call options than put options, showing traders are betting on higher prices.'
            : vote === -1
              ? 'More real money is flowing into put options than call options, showing traders are betting on lower prices or hedging downside risk.'
              : 'Money is flowing fairly evenly between calls and puts, so this is not showing a strong directional bet.',
        whatItMeans:
          vote === 1
            ? 'More money is going into call options than put options.'
            : vote === -1
              ? 'More money is going into put options than call options.'
              : 'Calls and puts are getting roughly equal money flow.',
      });
    }

    const callOi = maxPainRow?.call_oi != null ? Number(maxPainRow.call_oi) : null;
    const putOi = maxPainRow?.put_oi != null ? Number(maxPainRow.put_oi) : null;
    if (callOi != null && putOi != null) {
      // Same 1.15x threshold as getOpenInterestStatus above.
      const vote = callOi > putOi * 1.15 ? 1 : putOi > callOi * 1.15 ? -1 : 0;
      factors.push({
        key: 'openInterest',
        weight: 1,
        vote,
        detail:
          vote === 1
            ? 'There are meaningfully more open call contracts than put contracts, which can reflect bullish positioning or traders testing resistance.'
            : vote === -1
              ? 'There are meaningfully more open put contracts than call contracts, which can reflect protective or bearish positioning.'
              : 'The number of open call and put contracts is fairly balanced, so this does not strongly favor either direction.',
        whatItMeans:
          vote === 1
            ? 'More open call contracts than put contracts.'
            : vote === -1
              ? 'More open put contracts than call contracts.'
              : 'Calls and puts are evenly balanced.',
      });
    }

    const spot = displayAnalysisData?.spot_price;
    const callWallStrike = displayAnalysisData?.call_wall?.strike;
    const putWallStrike = displayAnalysisData?.put_wall?.strike;
    if (spot != null && callWallStrike != null && spot >= callWallStrike) {
      factors.push({
        key: 'callWallBreak',
        weight: 1,
        vote: 1,
        detail: 'Price has pushed above the call wall, suggesting that resistance is no longer holding and a larger upward move may be underway.',
        whatItMeans: 'Price has broken above resistance.',
      });
    }
    if (spot != null && putWallStrike != null && spot <= putWallStrike) {
      factors.push({
        key: 'putWallBreak',
        weight: 1,
        vote: -1,
        detail: 'Price has fallen below the put wall, suggesting that support is no longer holding and a larger downward move may be underway.',
        whatItMeans: 'Price has broken below support.',
      });
    }

    return factors;
  };

  const marketFactors = evaluateMarketFactors();

  // Weighted sum of every factor's vote -- see evaluateMarketFactors above
  // for what's included/excluded and why. Thresholds are set relative to
  // the max possible score (2 + 1 + 0.5 + 1 + 1 + 1(each wall) = 7.5) so
  // "Buy"/"Sell" require several factors actually agreeing, not just GEX
  // alone -- GEX alone (weight 2) now lands as Bullish/Bearish, matching
  // the old behavior for the single-factor case.
  const getMarketSignal = (factors) => {
    if (!factors || factors.length === 0) return null;
    const score = factors.reduce((sum, f) => sum + f.weight * f.vote, 0);

    if (score >= 3) {
      return {
        label: 'Buy',
        chipColor: 'success',
        textColor: 'success.main',
        emoji: '🟢',
        explanation: 'Strong signals point to higher prices',
        intro: "Most of today's option data points to higher prices.",
        direction: 'bullish',
      };
    }
    if (score >= 1) {
      return {
        label: 'Bullish',
        chipColor: 'success',
        textColor: 'success.main',
        emoji: '🟢',
        explanation: 'Price is more likely to move up',
        intro: "Most of today's option data points to higher prices.",
        direction: 'bullish',
      };
    }
    if (score <= -3) {
      return {
        label: 'Sell',
        chipColor: 'error',
        textColor: 'error.main',
        emoji: '🔴',
        explanation: 'Strong signals point to lower prices',
        intro: "Most of today's option data points to lower prices.",
        direction: 'bearish',
      };
    }
    if (score <= -1) {
      return {
        label: 'Bearish',
        chipColor: 'error',
        textColor: 'error.main',
        emoji: '🔴',
        explanation: 'Price is more likely to move down',
        intro: "Most of today's option data points to lower prices.",
        direction: 'bearish',
      };
    }
    return {
      label: 'Neutral',
      chipColor: 'default',
      textColor: 'text.secondary',
      emoji: '⚪',
      explanation: 'Signals are mixed, with no clear directional edge',
      intro: "Today's option data is mixed, with no strong directional lean.",
      direction: 'neutral',
    };
  };

  // "Overall:" wrap-up sentence -- states which side wins, then adds a
  // caveat only when at least one factor actually disagrees with the
  // conclusion (a clean sweep gets no "although" hedge).
  const getOverallSummary = (factors, signal) => {
    if (!factors || factors.length === 0 || !signal) return null;
    const hasBullishFactor = factors.some((f) => f.vote > 0);
    const hasBearishFactor = factors.some((f) => f.vote < 0);

    if (signal.direction === 'bullish') {
      const caveat = hasBearishFactor ? ', although a short-term pullback is still possible.' : '.';
      return `The positive signals outweigh the negative ones, so the market currently has a bullish bias${caveat}`;
    }
    if (signal.direction === 'bearish') {
      const caveat = hasBullishFactor ? ', although a short-term bounce is still possible.' : '.';
      return `The negative signals outweigh the positive ones, so the market currently has a bearish bias${caveat}`;
    }
    return "Signals are mixed and don't strongly favor either direction, so the market currently has a neutral bias.";
  };

  const marketSignal = getMarketSignal(marketFactors);

  // Strategy pick crossed on two independent axes: Total Score gives
  // direction (bullish/bearish/neutral), VRP gives pricing (is premium rich
  // or cheap right now) -- a bullish read with rich vol calls for selling
  // premium in a bullish structure, not just buying calls. Thresholds are
  // the user-specified ones, not the same +-1/+-3 bands as getMarketSignal
  // above (that one's tuned for the Buy/Sell headline label; this one's
  // tuned for strategy selection and intentionally coarser).
  const getRecommendedStrategy = (score, vrpPct) => {
    if (score == null || vrpPct == null || Number.isNaN(score) || Number.isNaN(vrpPct)) return null;
    const rich = vrpPct > 10;
    const pricingWhy = rich
      ? 'Option prices are currently rich, so selling premium is favored over buying it.'
      : 'Option prices are relatively cheap or fairly valued.';

    if (score >= 1.5) {
      return {
        name: rich ? 'Bull Put Spread / Covered Call' : 'Long Call / Bull Call Spread',
        why: [
          'Most signals suggest prices could continue to rise.',
          pricingWhy,
          rich
            ? 'This strategy profits from a steady or rising stock while collecting premium up front.'
            : 'This strategy profits if the stock moves higher while limiting risk.',
        ],
      };
    }
    if (score <= -1.5) {
      return {
        name: rich ? 'Bear Call Spread' : 'Long Put / Put Debit Spread',
        why: [
          'Most signals suggest prices could continue to fall.',
          pricingWhy,
          rich
            ? 'This strategy profits from a steady or falling stock while collecting premium up front.'
            : 'This strategy profits if the stock moves lower while limiting risk.',
        ],
      };
    }
    return {
      name: rich ? 'Iron Condor / Short Straddle' : 'Long Straddle / Calendar Spread',
      why: [
        rich
          ? 'Signals are mixed, suggesting the stock may stay range-bound.'
          : 'Signals are mixed, but a breakout move in either direction is possible.',
        pricingWhy,
        rich
          ? 'This strategy profits if the stock stays within a range into expiration.'
          : 'This strategy profits from a big move in either direction.',
      ],
    };
  };

  const totalScore = marketFactors.reduce((sum, f) => sum + f.weight * f.vote, 0);
  const vrpPct =
    displayOptionsMetrics?.volatility_risk_premium != null
      ? displayOptionsMetrics.volatility_risk_premium * 100
      : null;
  const recommendedStrategy =
    marketFactors.length > 0 ? getRecommendedStrategy(totalScore, vrpPct) : null;

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          Options Analytics Dashboard
        </Typography>
        {selectedTicker && (
          <Button
            className="no-print"
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => window.print()}
          >
            Print / Save as PDF
          </Button>
        )}
      </Box>

      {/* Ticker Selector */}
      <Paper className="no-print" sx={{ p: 2, mb: 3 }}>
        <Autocomplete
          open={openTickerList}
          onOpen={() => {
            setOpenTickerList(true);
            if (!defaultTickersLoaded) {
              setTickerQuery('');
            }
          }}
          onClose={() => setOpenTickerList(false)}
          openOnFocus
          options={tickerList}
          getOptionLabel={(opt) => `${opt.symbol} - ${opt.name || ''} (${opt.exchange})`}
          value={selectedTicker}
          onChange={(e, val) => {
            setSelectedTicker(val);
            setTickerInputValue(val ? `${val.symbol} - ${val.name || ''}` : '');
          }}
          inputValue={tickerInputValue}
          onInputChange={(e, val, reason) => {
            setTickerInputValue(val);
            if (reason === 'input') {
              setTickerQuery(val);
            }
          }}
          loading={loadingTickers}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Select Ticker"
              placeholder="Type symbol or company name..."
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loadingTickers ? <CircularProgress color="inherit" size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      </Paper>

      {loadingData && (
        <Box className="no-print" sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {displayOptionsMetrics?.is_stale_fallback && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          ⚠️ Live options data currently shows zero open interest for {selectedTicker?.symbol}
          {' '}(a known yfinance data gap during off-hours) -- showing the last known-good snapshot
          {displayOptionsMetrics.snapshot_fetched_at
            ? ` from ${new Date(displayOptionsMetrics.snapshot_fetched_at).toLocaleString()}`
            : ''}
          {' '}instead. Prices shown are current; positioning data below is not.
        </Alert>
      )}
      {displayOptionsMetrics?.data_source === 'live_zero_oi' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          ℹ️ Live options data currently shows zero open interest for {selectedTicker?.symbol}
          {' '}(a known yfinance data gap during off-hours) and no prior snapshot is available yet
          to fall back to. The numbers below are likely not meaningful right now -- try again during
          market hours.
        </Alert>
      )}

      {selectedTicker && !loadingData && (
        <>
          {/* Ticker Header */}
          <Typography variant="h5" sx={{ mb: 2 }}>
            {selectedTicker.symbol} {selectedTicker.name && `- ${selectedTicker.name}`}
          </Typography>

          {/* Term structure: compare positioning across expirations using today's
              data (a cross-section, not a forecast -- see ExpirationSelector's
              doc comment). Selecting one also filters the history charts below
              to that expiration's own series. */}
          <ExpirationSelector
            symbol={selectedTicker.symbol}
            expiration={selectedExpiration}
            onExpirationChange={setSelectedExpiration}
            termStructureLoading={termStructureLoading}
            termStructureError={termStructureError}
            termStructureData={termStructureData}
          />

          <SectionHeader
            icon="🌀"
            title="Gamma Exposure (GEX) — Simple Explanation"
            goal="Understand how option dealers are likely to react when the stock price moves, and which price levels matter most."
          />

          {/* History trend chart (separate from the point-in-time cards below --
              see MetricHistoryChart's doc comment for why these are never averaged) */}
          <MetricHistoryChart symbol={selectedTicker.symbol} metric="gex" expiration={selectedExpiration} />

          {/* GEX Summary */}
          {gexRow && (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">
                  What does this tell us? {selectedExpiration ? `(Live: ${selectedExpiration})` : ''}
                </Typography>
                <LastUpdated timestamp={gexRow.fetched_at} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                GEX shows how option dealers (big banks/market makers) are likely to react when the stock price
                moves. Their buying and selling can either calm the price down or make moves bigger.
              </Typography>

              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                1. Overall Market Behavior
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">Call GEX</Typography>
                      <Typography variant="h6">
                        {gexRow.call_gex?.toFixed(2) || 'N/A'}
                      </Typography>
                      {callGexNarrative && (
                        <>
                          <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                            {callGexNarrative.emoji} {callGexNarrative.label} — {callGexNarrative.arrow} {callGexNarrative.meaning}
                          </Typography>
                          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                            {callGexNarrative.bullets.map((bullet) => (
                              <Typography key={bullet} component="li" variant="caption" color="text.secondary">
                                {bullet}
                              </Typography>
                            ))}
                          </Box>
                          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                            <strong>Simple version:</strong> {callGexNarrative.simple}
                          </Typography>
                        </>
                      )}
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">Put GEX</Typography>
                      <Typography variant="h6">
                        {gexRow.put_gex?.toFixed(2) || 'N/A'}
                      </Typography>
                      {putGexNarrative && (
                        <>
                          <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                            {putGexNarrative.emoji} {putGexNarrative.label} — {putGexNarrative.arrow} {putGexNarrative.meaning}
                          </Typography>
                          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                            {putGexNarrative.bullets.map((bullet) => (
                              <Typography key={bullet} component="li" variant="caption" color="text.secondary">
                                {bullet}
                              </Typography>
                            ))}
                          </Box>
                          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                            <strong>Simple version:</strong> {putGexNarrative.simple}
                          </Typography>
                        </>
                      )}
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">Total GEX</Typography>
                      <Typography variant="h6">
                        {gexRow.total_gex?.toFixed(2) || 'N/A'}
                      </Typography>
                      {totalGexNarrative && (
                        <>
                          <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
                            {totalGexNarrative.emoji} {totalGexNarrative.label}
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
                            Overall message:
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            {totalGexNarrative.checklist.map((item) => (
                              <Typography key={item.text} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                {item.ok ? '✅' : '⚠️'} {item.text}
                              </Typography>
                            ))}
                          </Box>
                        </>
                      )}
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Structural Levels - Call Wall, Put Wall, Flip Level */}
          {displayAnalysisData && (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  📍 Important Price Levels {selectedExpiration ? `(Live: ${selectedExpiration})` : '(Live: nearest expiration)'}
                </Typography>
                <LastUpdated timestamp={displayAnalysisData.timestamp} />
              </Box>
              {(() => {
                const callWallStrike = displayAnalysisData.call_wall?.strike;
                const putWallStrike = displayAnalysisData.put_wall?.strike;
                const flipLevelStrike = displayAnalysisData.flip_level?.strike;
                const invalidStructuralLevels = Boolean(
                  callWallStrike != null &&
                  putWallStrike != null &&
                  flipLevelStrike != null &&
                  callWallStrike === putWallStrike &&
                  callWallStrike === flipLevelStrike &&
                  displayAnalysisData.call_wall?.gex === 0 &&
                  displayAnalysisData.put_wall?.gex === 0 &&
                  (displayAnalysisData.flip_level?.cumulative_gex || 0) === 0
                );

                const formatStrike = (strike) =>
                  invalidStructuralLevels || strike == null ? 'N/A' : `$${strike.toFixed(2)}`;

                const spot = displayAnalysisData.spot_price;
                const haveLevels = !invalidStructuralLevels && spot != null && callWallStrike != null && putWallStrike != null && flipLevelStrike != null;

                // "$X room" vs "very close" -- same <1%-of-spot threshold used
                // elsewhere on this page for "near" a structural level.
                const roomToCallWall = haveLevels && spot < callWallStrike ? callWallStrike - spot : null;
                const roomIsTinyAboveCall = roomToCallWall != null && (roomToCallWall / spot) * 100 < 1;
                const distanceToPutWall = haveLevels && spot > putWallStrike ? spot - putWallStrike : null;
                const distanceIsTinyAbovePut = distanceToPutWall != null && (distanceToPutWall / spot) * 100 < 1;

                const flipPct = haveLevels ? ((spot - flipLevelStrike) / flipLevelStrike) * 100 : null;
                const flipZone =
                  flipPct == null
                    ? null
                    : flipPct > 5
                      ? 'well above the danger zone'
                      : flipPct > 0
                        ? 'getting close to the danger zone'
                        : 'below the danger zone, where dealers may amplify moves';

                return (
                  <>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, height: '100%' }}>
                            <Typography color="textSecondary">Current Stock Price</Typography>
                            <Typography variant="h6">
                              ${spot?.toFixed(2) || 'N/A'}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                              This is where the stock is trading now -- the point every level below is measured against.
                            </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, height: '100%' }}>
                            <Typography color="textSecondary">Call Wall</Typography>
                            <Typography variant="h6">
                              {formatStrike(callWallStrike)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Think: Ceiling
                            </Typography>
                            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                              <Typography component="li" variant="caption" color="text.secondary">
                                The biggest concentration of call options is around this strike.
                              </Typography>
                              <Typography component="li" variant="caption" color="text.secondary">
                                This level may act as resistance -- the stock may struggle to break above it.
                              </Typography>
                            </Box>
                            {haveLevels && (
                              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                                <strong>Current situation:</strong>{' '}
                                {spot >= callWallStrike
                                  ? 'The stock has already broken above this level.'
                                  : roomIsTinyAboveCall
                                    ? 'The stock is very close to this level.'
                                    : `The stock has about $${roomToCallWall.toFixed(2)} room to move upward before hitting this level.`}
                              </Typography>
                            )}
                        </Paper>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, height: '100%' }}>
                            <Typography color="textSecondary">Put Wall</Typography>
                            <Typography variant="h6">
                              {formatStrike(putWallStrike)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Think: Floor
                            </Typography>
                            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                              <Typography component="li" variant="caption" color="text.secondary">
                                The biggest concentration of put options is around this strike.
                              </Typography>
                              <Typography component="li" variant="caption" color="text.secondary">
                                This level may attract buyers -- dealers may buy shares here to hedge.
                              </Typography>
                            </Box>
                            {haveLevels && (
                              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                                <strong>Current situation:</strong>{' '}
                                {spot <= putWallStrike
                                  ? 'The stock has already broken below this level.'
                                  : distanceIsTinyAbovePut
                                    ? 'The stock is very close to this level.'
                                    : `The stock has about $${distanceToPutWall.toFixed(2)} room to move downward before reaching this level.`}
                              </Typography>
                            )}
                        </Paper>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, height: '100%' }}>
                            <Typography color="textSecondary">Flip Level</Typography>
                            <Typography variant="h6">
                              {formatStrike(flipLevelStrike)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Very important level
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                              This is where dealer behavior changes. Above it, dealers usually stabilize the
                              stock with smoother moves and lower volatility. Below it, dealers may amplify
                              moves, making bigger swings more likely.
                            </Typography>
                            {haveLevels && (
                              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                                <strong>Current situation:</strong> The stock is {flipZone}.
                              </Typography>
                            )}
                        </Paper>
                      </Grid>
                    </Grid>
                    {invalidStructuralLevels && (
                      <Typography variant="caption" sx={{ mt: 2, display: 'block', color: 'warning.main' }}>
                        ℹ️ Analysis data is too sparse to derive reliable key strike levels.
                      </Typography>
                    )}

                    {haveLevels && (
                      <Box sx={{ mt: 3 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                          🧭 Simple Trading Interpretation
                        </Typography>
                        {(() => {
                          const totalGex = gexRow?.total_gex != null ? Number(gexRow.total_gex) : null;
                          const isBullishStable = spot > flipLevelStrike && totalGex != null && totalGex > 0;
                          const isBearishFragile = spot <= flipLevelStrike && totalGex != null && totalGex < 0;
                          const picture = isBullishStable
                            ? {
                                emoji: '🟢',
                                label: 'Bullish/Stable',
                                points: [
                                  'Stock is above the gamma flip level.',
                                  'Total GEX is positive.',
                                  'Dealers likely reduce volatility.',
                                ],
                              }
                            : isBearishFragile
                              ? {
                                  emoji: '🔴',
                                  label: 'Bearish/Fragile',
                                  points: [
                                    'Stock is below the gamma flip level.',
                                    'Total GEX is negative.',
                                    'Dealers likely amplify volatility.',
                                  ],
                                }
                              : {
                                  emoji: '🟡',
                                  label: 'Mixed/Watch',
                                  points: [
                                    'Price level and dealer positioning are not fully aligned.',
                                    'Watch both the flip level and total GEX for confirmation.',
                                  ],
                                };
                          return (
                            <>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                Current picture: {picture.emoji} {picture.label}
                              </Typography>
                              <Box component="ul" sx={{ mt: 0.5, mb: 1.5, pl: 2.5 }}>
                                {picture.points.map((point) => (
                                  <Typography key={point} component="li" variant="body2" color="text.secondary">
                                    {point}
                                  </Typography>
                                ))}
                              </Box>

                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                🟡 Watch:
                              </Typography>
                              <Box component="ul" sx={{ mt: 0.5, mb: 1.5, pl: 2.5 }}>
                                <Typography component="li" variant="body2" color="text.secondary">
                                  ${putWallStrike.toFixed(2)} = important support
                                </Typography>
                                <Typography component="li" variant="body2" color="text.secondary">
                                  ${callWallStrike.toFixed(2)} = important resistance
                                </Typography>
                              </Box>

                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                Possible scenarios:
                              </Typography>
                              <Box component="ul" sx={{ mt: 0.5, mb: 1.5, pl: 2.5 }}>
                                <Typography component="li" variant="body2" color="text.secondary">
                                  If price stays between ${putWallStrike.toFixed(2)}–${callWallStrike.toFixed(2)}: expect
                                  sideways trading. Dealers may keep the stock trapped in this range.
                                </Typography>
                                <Typography component="li" variant="body2" color="text.secondary">
                                  If price breaks above ${callWallStrike.toFixed(2)}: the stock could move higher because
                                  resistance has been cleared.
                                </Typography>
                                <Typography component="li" variant="body2" color="text.secondary">
                                  If price breaks below ${putWallStrike.toFixed(2)}: selling pressure could increase,
                                  especially if dealers need to hedge aggressively.
                                </Typography>
                              </Box>

                              <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                                &ldquo;
                                {(() => {
                                  const stability = spot > flipLevelStrike ? 'a calm stock' : 'a more volatile stock';
                                  const flipClause =
                                    spot > flipLevelStrike
                                      ? `as long as the stock stays above $${flipLevelStrike.toFixed(2)}, dealers are likely to keep volatility under control.`
                                      : `until the stock reclaims $${flipLevelStrike.toFixed(2)}, dealers are more likely to amplify moves.`;
                                  return `The options market currently expects ${stability} around $${putWallStrike.toFixed(2)}–$${callWallStrike.toFixed(2)}. $${putWallStrike.toFixed(2)} is the floor, $${callWallStrike.toFixed(2)} is the ceiling, and ${flipClause}`;
                                })()}
                                &rdquo;
                              </Typography>
                            </>
                          );
                        })()}
                      </Box>
                    )}
                  </>
                );
              })()}
              <Typography variant="caption" sx={{ mt: 2, display: 'block', color: 'text.secondary' }}>
                {selectedExpiration
                  ? `ℹ️ Live term structure computed just now for ${selectedExpiration}`
                  : 'ℹ️ Live yfinance option-chain compute for the nearest expiration -- see the timestamp above for exactly when (may be a recent cache hit, not necessarily this instant).'}
              </Typography>
            </Box>
          )}

          {/* Strike-level dealer positioning -- shares the live payload with
              every other section below, so it's fetched once here. */}
          {displayOptionsMetrics && (
            <>
              <LastUpdated timestamp={displayOptionsMetrics.computed_at} sx={{ display: 'block', mb: 1 }} />
              <SummaryCards data={displayOptionsMetrics} sections={['walls']} />
              <StrikeExposureChart
                strikes={displayOptionsMetrics.strikes}
                spot={displayOptionsMetrics.underlying_price}
                callWall={displayOptionsMetrics.key_levels?.call_wall}
                putWall={displayOptionsMetrics.key_levels?.put_wall}
                zeroGamma={displayOptionsMetrics.key_levels?.zero_gamma}
                expectedMove={displayOptionsMetrics.expected_move}
              />
            </>
          )}

          <SectionHeader
            icon="📈"
            title="Volatility & Skew Overview"
            goal="Determine if options are overpriced or underpriced, and detect structural directional skew across the option chain."
          />

          {displayOptionsMetrics && (
            <>
              <LastUpdated timestamp={displayOptionsMetrics.computed_at} sx={{ display: 'block', mb: 1 }} />
              <SummaryCards data={displayOptionsMetrics} sections={['volatility']} />
              <IVSmileChart
                ivSmile={displayOptionsMetrics.iv_smile}
                spot={displayOptionsMetrics.underlying_price}
              />
              {displayOptionsMetrics.next_earnings_date &&
                new Date(displayOptionsMetrics.next_earnings_date) >= new Date(new Date().toDateString()) && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    ⚠️ Earnings Date: {displayOptionsMetrics.next_earnings_date}
                  </Alert>
              )}
              <IVTermStructureChart symbol={selectedTicker.symbol} />
            </>
          )}

          <SectionHeader
            icon="🔥"
            title="Max Pain & Options Positioning"
            goal="See where option traders are positioned and whether today's options activity is bullish, bearish, or neutral."
          />

          <MetricHistoryChart symbol={selectedTicker.symbol} metric="maxPain" expiration={selectedExpiration} />

          {/* Max Pain Summary */}
          {maxPainRow && (
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  Max Pain Analysis {selectedExpiration ? `(Live: ${selectedExpiration})` : ''}
                </Typography>
                <LastUpdated timestamp={maxPainRow.fetched_at} />
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">🎯 Max Pain Price</Typography>
                      <Typography variant="h6">
                        ${maxPainRow.max_pain?.toFixed(2) || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Where option buyers lose the most money if the stock expires at this price.
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                        <strong>What this means:</strong> Some traders believe the stock may slowly move toward this
                        price as option expiration approaches. It is only one indicator and should never be used by
                        itself to predict price.
                      </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">📏 Distance from Max Pain</Typography>
                      <Typography variant="h6">
                        {maxPainRow.distance_pct != null ? `${Math.abs(maxPainRow.distance_pct).toFixed(2)}%` : 'N/A'}
                      </Typography>
                      {maxPainStatus && (
                        <>
                          <Typography variant="body2" sx={{ mt: 1 }}>
                            Current price is {maxPainStatus.direction} the Max Pain price.
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                            <strong>What this means:</strong> {maxPainStatus.description}
                          </Typography>
                        </>
                      )}
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">📈 Call Positions (Call OI)</Typography>
                      <Typography variant="h6">
                        {maxPainRow.call_oi?.toLocaleString() || 'N/A'}
                      </Typography>
                      {callOiStatus && (
                        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, color: STATUS_TEXT_COLOR[callOiStatus.color] || 'text.secondary' }}>
                          {callOiStatus.emoji} {callOiStatus.label}
                        </Typography>
                      )}
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                        <strong>What this means:</strong> {callOiStatus?.description}
                      </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Paper sx={{ p: 2, height: '100%' }}>
                      <Typography color="textSecondary">📉 Put Positions (Put OI)</Typography>
                      <Typography variant="h6">
                        {maxPainRow.put_oi?.toLocaleString() || 'N/A'}
                      </Typography>
                      {putOiStatus && (
                        <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, color: STATUS_TEXT_COLOR[putOiStatus.color] || 'text.secondary' }}>
                          {putOiStatus.emoji} {putOiStatus.label}
                        </Typography>
                      )}
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                        <strong>What this means:</strong> {putOiStatus?.description}
                      </Typography>
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          )}

          {displayOptionsMetrics && (
            <>
              <LastUpdated timestamp={displayOptionsMetrics.computed_at} sx={{ display: 'block', mb: 1 }} />
              <SummaryCards data={displayOptionsMetrics} sections={['flow']} />
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  🔥 Unusual Options Activity
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Shows option contracts that are trading much more than normal today.
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                  <strong>What this means:</strong> Heavy trading can indicate something important is happening, but
                  it does not tell you whether traders are buying or selling those contracts. Think of it as a
                  signal to investigate further, not as a buy or sell signal.
                </Typography>
              </Box>
              <UnusualVolumeTable contracts={displayOptionsMetrics.unusual_volume} />
            </>
          )}

          <SectionHeader
            icon="⏱️"
            title="Time Drift & Second-Order Greeks Overview"
            goal="Understand how time decay and volatility shifts will change market maker positioning over time."
          />

          {displayOptionsMetrics && (
            <>
              <LastUpdated timestamp={displayOptionsMetrics.computed_at} sx={{ display: 'block', mb: 1 }} />
              <SummaryCards data={displayOptionsMetrics} sections={['greeks']} />
            </>
          )}

          <SectionHeader
            icon="🎯"
            title="Executive Signal & Strategy Overview"
            goal="Combine all market signals into one simple conclusion and trading suggestion."
          />

          {displayOptionsMetrics && (
            <>
              <Paper sx={{ p: 2, mt: 1 }}>
                {marketSignal ? (
                  <>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {marketSignal.emoji} Market Conclusion:{' '}
                      <Box component="span" sx={{ color: marketSignal.textColor }}>
                        {marketSignal.label}
                      </Box>{' '}
                      <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                        ({marketSignal.explanation})
                      </Box>
                    </Typography>

                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {marketSignal.intro}
                    </Typography>

                    {marketFactors.length > 0 && (
                      <List sx={{ mt: 0.5 }}>
                        {marketFactors.map((factor) => (
                          <ListItem key={factor.key} sx={{ display: 'list-item', listStyleType: 'disc', pl: 0, ml: 3, py: 0.25 }}>
                            <Typography variant="body2">
                              <strong>{MARKET_FACTOR_LABELS[factor.key] || factor.key}:</strong> {factor.detail}
                            </Typography>
                          </ListItem>
                        ))}
                      </List>
                    )}

                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <strong>Overall:</strong> {getOverallSummary(marketFactors, marketSignal)}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No conclusion available due to missing metric data.
                  </Typography>
                )}

                {marketFactors.length > 0 && (
                  <TableContainer sx={{ mt: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Factor</TableCell>
                          <TableCell>What it means</TableCell>
                          <TableCell>Signal</TableCell>
                          <TableCell align="right">Impact</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {marketFactors.map((factor) => {
                          const contribution = factor.weight * factor.vote;
                          const signalMeta = getFactorSignalMeta(factor.vote, factor.weight);
                          return (
                            <TableRow key={factor.key}>
                              <TableCell>
                                <Typography variant="body2">{MARKET_FACTOR_LABELS[factor.key] || factor.key}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color="text.secondary">
                                  {factor.whatItMeans}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontWeight: 600, color: STATUS_TEXT_COLOR[signalMeta.color] || 'text.secondary' }}>
                                  {signalMeta.emoji} {signalMeta.label}
                                </Typography>
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  color:
                                    contribution > 0
                                      ? 'success.main'
                                      : contribution < 0
                                        ? 'error.main'
                                        : 'text.secondary',
                                  fontWeight: 600,
                                }}
                              >
                                {contribution > 0 ? '+' : ''}
                                {contribution.toFixed(1)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                {marketSignal && marketFactors.length > 0 && (
                  <Typography variant="subtitle1" sx={{ mt: 1.5, fontWeight: 700, color: marketSignal.textColor }}>
                    Overall Score: {totalScore > 0 ? '+' : ''}
                    {totalScore.toFixed(1)} ({marketSignal.label})
                  </Typography>
                )}

                {recommendedStrategy && (
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      📈 Recommended Strategy
                    </Typography>
                    <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
                      {recommendedStrategy.name}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
                      Why?
                    </Typography>
                    <List sx={{ mt: 0 }}>
                      {recommendedStrategy.why.map((reason) => (
                        <ListItem key={reason} sx={{ display: 'list-item', listStyleType: 'disc', pl: 0, ml: 3, py: 0.25 }}>
                          <Typography variant="body2" color="text.secondary">
                            {reason}
                          </Typography>
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                {/* Repeats the same timestamp shown next to the "Options Metrics"
                    heading above -- this card is long enough that the top-of-
                    section timestamp scrolls out of view, leaving the reader
                    with no visible answer to "how current is this?" right where
                    the conclusion (and its Buy/Sell/Bearish label) is read. */}
                <LastUpdated timestamp={displayOptionsMetrics.computed_at} sx={{ display: 'block', mt: 1 }} />
              </Paper>
            </>
          )}
        </>
      )}
    </Container>
  );
}
