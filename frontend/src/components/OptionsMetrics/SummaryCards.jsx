import { Grid, Paper, Typography, Box, Table, TableBody, TableRow, TableCell } from '@mui/material';

// Maps the MUI Chip-style color keyword each status object already carries
// (success/error/warning/default) to the equivalent text color, so the
// sentiment line renders as plain colored text + emoji dot -- matching the
// Time Drift (DEX/VEX/CEX) cards' style -- instead of a pill-shaped Chip.
const STATUS_TEXT_COLOR = {
  success: 'success.main',
  error: 'error.main',
  warning: 'warning.main',
  info: 'info.main',
  default: 'text.secondary',
};

// Dashboard-wide convention: title says what the number is, the sentiment
// line gives an emoji-coded bullish/bearish/neutral read at a glance, and
// "What this means:" spells out the judgment in plain language -- status
// (judgment) and description (plain definition, no judgment) are separate
// slots so a card can use either or both.
function MetricCard({ title, value, subtitle, color, status, description, notes }) {
  const isZero = value === 0 || value === '0';
  return (
    <Paper sx={{ p: 2, height: '100%', backgroundColor: isZero ? 'rgba(255,152,0,0.05)' : 'inherit' }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="h6" sx={{ color: color || 'inherit' }}>
        {value ?? '—'}
      </Typography>
      {status && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: STATUS_TEXT_COLOR[status.color] || 'text.secondary' }}>
            {status.emoji ? `${status.emoji} ` : ''}{status.label}
          </Typography>
          {status.description && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              <strong>What this means:</strong> {status.description}
            </Typography>
          )}
        </Box>
      )}
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      {/* Plain-language definition for cards with no good/bad judgment to
          make (structural levels) -- distinct from status.description,
          which only renders alongside an evaluative Chip (Low/High/Neutral etc). */}
      {description && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {description}
        </Typography>
      )}
      {notes && notes.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
            How to read it
          </Typography>
          {notes.map((note) => (
            <Typography key={note} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              {note}
            </Typography>
          ))}
        </Box>
      )}
      {isZero && <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main' }}>No data</Typography>}
    </Paper>
  );
}

// Dealer-exposure cards (DEX/VEX/CEX) follow a distinct "what it means" +
// "Simple explanation:" layout instead of MetricCard's Chip-based status,
// since their sign meaning is direction-neutral prose rather than a short
// evaluative label -- forcing them through MetricCard would either drop the
// two-paragraph explanation or bloat that shared component for 3 callers.
function ExposureCard({ title, value, sign, whatItMeans, simpleExplanation }) {
  const isZero = value === 0 || value === '0';
  const signMeta =
    sign > 0
      ? { label: 'Positive', emoji: '🟢', color: 'success.main' }
      : sign < 0
        ? { label: 'Negative', emoji: '🔴', color: 'error.main' }
        : { label: 'Neutral', emoji: '⚪', color: 'text.secondary' };
  return (
    <Paper sx={{ p: 2, height: '100%', backgroundColor: isZero ? 'rgba(255,152,0,0.05)' : 'inherit' }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="h6">{value ?? '—'}</Typography>
      {sign != null && (
        <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, color: signMeta.color }}>
          {signMeta.emoji} {signMeta.label}
        </Typography>
      )}
      {whatItMeans && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {whatItMeans}
        </Typography>
      )}
      {simpleExplanation && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
          <strong>Simple explanation:</strong> {simpleExplanation}
        </Typography>
      )}
      {isZero && <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main' }}>No data</Typography>}
    </Paper>
  );
}

const ALL_SECTIONS = ['walls', 'greeks', 'volatility', 'flow'];

/**
 * @param {Object} props
 * @param {Object} props.data
 * @param {Array<'walls'|'greeks'|'volatility'|'flow'>} [props.sections] - which
 *   card groups to render, for splitting this data across separate page
 *   sections (Structural/Gamma, Greeks, Vol Surface, Flow) without
 *   duplicating any of the derived-value/status logic below. Defaults to
 *   all four (the original single-block layout).
 */
export default function SummaryCards({ data, sections = ALL_SECTIONS }) {
  const {
    key_levels,
    net,
    ivr,
    skew,
    historical_volatility,
    realized_vol_10d,
    realized_vol_60d,
    volatility_risk_premium,
    expected_move,
    call_premium_notional,
    put_premium_notional,
    greeks_methodology,
    underlying_price,
  } = data;

  // Yahoo's public options data doesn't supply vanna/charm at all -- these
  // are Black-Scholes model estimates, not exchange-reported values. Flagged
  // on VEX/CEX specifically (not gamma/delta) since vanna/charm have no
  // provider fallback whatsoever.
  const isModelDerivedGreeks = greeks_methodology === 'black_scholes_derived';

  const historicalVolatilityPct = historical_volatility != null ? historical_volatility * 100 : null;
  const realizedVol10dPct = realized_vol_10d != null ? realized_vol_10d * 100 : null;
  const realizedVol60dPct = realized_vol_60d != null ? realized_vol_60d * 100 : null;
  const volatilityRiskPremiumPct = volatility_risk_premium != null ? volatility_risk_premium * 100 : null;

  // Plain-language read of the realized-vol term structure (10d vs 20d vs
  // 60d) -- lets a reader see whether the stock's actual movement is
  // speeding up into a squeeze or settling down, independent of the
  // separately-shown Implied Volatility Term Structure chart. A >20%
  // relative gap is the threshold for calling it out; smaller gaps read as
  // noise rather than a real regime shift.
  const getRealizedVolTrendNote = () => {
    if (realizedVol10dPct == null || historicalVolatilityPct == null) return null;
    if (historicalVolatilityPct === 0) return null;
    const shortVsMid = (realizedVol10dPct - historicalVolatilityPct) / historicalVolatilityPct;
    if (shortVsMid > 0.2) {
      return 'The stock has been moving noticeably more in the last 10 days than its recent average -- price action is speeding up.';
    }
    if (shortVsMid < -0.2) {
      return 'The stock has been moving noticeably less in the last 10 days than its recent average -- price action is settling down.';
    }
    return 'Recent price movement has been fairly steady -- no clear speeding up or settling down.';
  };

  const invalidSameStrikeLevels = Boolean(
    key_levels?.call_wall != null &&
    key_levels?.put_wall != null &&
    key_levels?.zero_gamma != null &&
    key_levels.call_wall === key_levels.put_wall &&
    key_levels.call_wall === key_levels.zero_gamma &&
    (net?.net_dex ?? 0) === 0 &&
    (net?.net_vex ?? 0) === 0 &&
    (net?.net_cex ?? 0) === 0
  );

  const safeKeyLevel = (value) => {
    if (invalidSameStrikeLevels) return null;
    return Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
  };

  const formatNumber = (n) => {
    if (n === null || n === undefined) return 'Premium Data Required';
    if (n === 0) return '0';
    if (Math.abs(n) > 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) > 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  const getMetricStatus = (metric, value) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    const num = Number(value);

    if (metric === 'ivr') {
      if (num < 20) {
        return {
          label: 'Options Are Cheap',
          emoji: '🟢',
          color: 'success',
          description: 'Option prices are currently low compared to the past year. This means buying options is relatively inexpensive because the market expects smaller price moves.',
        };
      }
      if (num > 80) {
        return {
          label: 'Options Are Expensive',
          emoji: '🟠',
          color: 'warning',
          description: 'Option prices are currently high compared to the past year. This means buying options is relatively expensive because the market expects larger price moves.',
        };
      }
      return {
        label: 'Fairly Priced',
        emoji: '⚪',
        color: 'default',
        description: 'Option prices are near their typical range compared to the past year -- neither especially cheap nor expensive right now.',
      };
    }

    if (metric === 'skew') {
      if (num > 0.01) {
        return {
          label: 'Bearish',
          emoji: '🔴',
          color: 'error',
          description: 'Traders are paying more for downside (put) protection than upside (call) exposure, suggesting some fear or caution in the options market.',
        };
      }
      if (num < -0.01) {
        return {
          label: 'Bullish',
          emoji: '🟢',
          color: 'success',
          description: 'Traders are paying more for upside (call) exposure than downside (put) protection, suggesting some optimism in the options market.',
        };
      }
      return {
        label: 'Neutral',
        emoji: '⚪',
        color: 'default',
        description: 'Traders are paying about the same for bullish (call) and bearish (put) options, suggesting no strong fear or optimism in the options market.',
      };
    }

    if (metric === 'historical_volatility') {
      if (num < 15) {
        return {
          label: 'Low',
          emoji: '🟢',
          color: 'success',
          description: 'The stock has been fairly calm over the past 20 trading days. This looks at what already happened, not what is expected to happen next.',
        };
      }
      if (num > 35) {
        return {
          label: 'High',
          emoji: '🟠',
          color: 'warning',
          description: 'The stock has been making large price moves over the past 20 trading days. This looks at what already happened, not what is expected to happen next.',
        };
      }
      return {
        label: 'Moderate',
        emoji: '⚪',
        color: 'default',
        description: "The stock's recent price swings have been fairly typical over the past 20 trading days. This looks at what already happened, not what is expected to happen next.",
      };
    }

    if (metric === 'volatility_risk_premium') {
      if (num > 2) {
        return {
          label: 'Options Look Expensive',
          emoji: '🟠',
          color: 'warning',
          description: "Options are more expensive than the stock's recent movements would suggest. This may make selling premium more attractive than buying it.",
        };
      }
      if (num < -2) {
        return {
          label: 'Options Look Cheap',
          emoji: '🟢',
          color: 'success',
          description: "Options are less expensive than the stock's recent movements would suggest. This may provide better value for traders looking to buy options.",
        };
      }
      return {
        label: 'Fairly Priced',
        emoji: '⚪',
        color: 'default',
        description: "Option prices roughly match how much the stock has actually been moving -- neither buying nor selling options has an obvious edge from this alone.",
      };
    }

    if (metric === 'expected_move') {
      return {
        label: 'Market Estimate',
        emoji: '📊',
        color: 'default',
        description: `Based on today's option prices, the market expects the stock to move about $${num.toFixed(2)} up or down by expiration. This is not a prediction -- just the range that options are currently pricing in.`,
      };
    }

    if (metric === 'premium_pcr') {
      if (num > 1.5) {
        return {
          label: 'Bearish (Put-Biased)',
          emoji: '🔴',
          color: 'error',
          description: 'Today, much more money is flowing into put options than call options. This suggests traders are currently betting on lower prices or hedging downside risk.',
        };
      }
      if (num < 0.7) {
        return {
          label: 'Bullish (Call-Biased)',
          emoji: '🟢',
          color: 'success',
          description: 'Today, much more money is flowing into call options than put options. This suggests traders are currently betting on higher prices.',
        };
      }
      return {
        label: 'Neutral',
        emoji: '⚪',
        color: 'default',
        description: 'Money is flowing fairly evenly between call and put options today, showing no strong directional bet.',
      };
    }

    if (metric === 'net_exposure') {
      if (num > 0) {
        return {
          label: 'Long Gamma',
          color: 'success',
          description: 'Dealers are helping keep the price more stable -- large swings are less likely (positive GEX).',
        };
      }
      if (num < 0) {
        return {
          label: 'Short Gamma',
          color: 'warning',
          description: 'Dealers may have to buy and sell shares quickly, which can make price swings bigger (negative GEX).',
        };
      }
      return {
        label: 'Neutral Gamma',
        color: 'info',
        description: "Dealer positioning is balanced and isn't adding much to price swings either way (neutral GEX).",
      };
    }

    return null;
  };

  // Where price sits relative to a structural level, in plain terms --
  // mirrors the "Above Max Pain" / "Current price is above max pain..."
  // pattern already used for the Max Pain card.
  const getWallStatus = (spot, wallStrike, side) => {
    if (spot == null || wallStrike == null || invalidSameStrikeLevels) return null;
    const pctFromWall = ((spot - wallStrike) / wallStrike) * 100;

    if (side === 'call') {
      if (spot >= wallStrike) {
        return {
          label: 'Above Call Wall',
          emoji: '🟠',
          color: 'warning',
          description: 'The stock has already broken above this resistance level.',
        };
      }
      if (pctFromWall > -2) {
        return {
          label: 'Near Call Wall',
          emoji: '🟠',
          color: 'warning',
          description: 'The stock is approaching a level where it may face resistance.',
        };
      }
      return {
        label: 'Below Call Wall',
        emoji: '⚪',
        color: 'default',
        description: 'The stock has room to rise before hitting this resistance level.',
      };
    }

    // side === 'put'
    if (spot <= wallStrike) {
      return {
        label: 'Below Put Wall',
        emoji: '🟠',
        color: 'warning',
        description: 'The stock has already broken below this support level.',
      };
    }
    if (pctFromWall < 2) {
      return {
        label: 'Near Put Wall',
        emoji: '🟠',
        color: 'warning',
        description: 'The stock is approaching a level where buyers may step in.',
      };
    }
    return {
      label: 'Above Put Wall',
      emoji: '🟢',
      color: 'success',
      description: 'The stock has room to fall before reaching this support level.',
    };
  };

  // Sign of DEX/VEX/CEX -- null when the metric is missing, so ExposureCard
  // knows to hide the Positive/Negative/Neutral badge entirely rather than
  // show a misleading "Neutral" for absent data.
  const getExposureSign = (value) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    const num = Number(value);
    return num > 0 ? 1 : num < 0 ? -1 : 0;
  };

  // "Simple explanation:" copy per exposure card, branched on sign -- these
  // aren't bullish/bearish calls (DEX/VEX/CEX stay out of the Executive
  // Summary's vote), just plain-language framing of what that sign implies
  // for dealer hedging flow.
  const getExposureExplanation = (kind, sign) => {
    if (sign == null) return null;
    if (kind === 'dex') {
      if (sign > 0) return 'A positive value usually helps keep price moves smoother because dealers tend to buy when prices rise and sell when prices fall.';
      if (sign < 0) return 'A negative value means dealers may need to sell as prices rise and buy as prices fall, which can add to price swings instead of smoothing them.';
      return "Dealer positioning is balanced right now, so it isn't adding meaningful buying or selling pressure either way.";
    }
    if (kind === 'vex') {
      if (sign > 0) return 'A positive value means a change in volatility could cause dealers to trade in a way that helps reduce market swings.';
      if (sign < 0) return 'A negative value means a change in volatility could cause dealers to trade in a way that adds to market swings instead of reducing them.';
      return "Dealer hedging currently isn't very sensitive to changes in volatility.";
    }
    if (kind === 'cex') {
      if (sign > 0) return 'A positive value means dealers may gradually adjust their positions in a way that tends to add stability as options get closer to expiration.';
      if (sign < 0) return 'A negative value means dealers may gradually need to adjust their positions, which can create extra buying or selling pressure as options get closer to expiration.';
      return "Time decay currently isn't creating meaningful buying or selling pressure from dealers.";
    }
    return null;
  };

  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      {/* Key Gamma Levels */}
      {sections.includes('walls') && (
      <>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Call Wall"
          value={safeKeyLevel(key_levels?.call_wall)}
          description="This is a price level where the stock often struggles to move above. Think of it as a ceiling."
          status={getWallStatus(underlying_price, key_levels?.call_wall, 'call')}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Put Wall"
          value={safeKeyLevel(key_levels?.put_wall)}
          description="This is a price level where buyers often step in. Think of it as a floor."
          status={getWallStatus(underlying_price, key_levels?.put_wall, 'put')}
        />
      </Grid>
      </>
      )}

      {sections.includes('greeks') && (
        <>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <ExposureCard
              title="Dealer Buying & Selling (DEX)"
              value={net?.net_dex !== undefined ? formatNumber(net.net_dex) : '—'}
              sign={getExposureSign(net?.net_dex)}
              whatItMeans="Shows how much buying or selling dealers may need to do as the stock price changes."
              simpleExplanation={getExposureExplanation('dex', getExposureSign(net?.net_dex))}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <ExposureCard
              title="🌪️ Volatility Impact (VEX)"
              value={net?.net_vex !== undefined ? formatNumber(net.net_vex) : '—'}
              sign={getExposureSign(net?.net_vex)}
              whatItMeans="Shows how dealer activity could change if the market suddenly becomes more or less volatile."
              simpleExplanation={getExposureExplanation('vex', getExposureSign(net?.net_vex))}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <ExposureCard
              title="⏳ Time Decay Impact (CEX)"
              value={net?.net_cex !== undefined ? formatNumber(net.net_cex) : '—'}
              sign={getExposureSign(net?.net_cex)}
              whatItMeans="Shows how dealer positions naturally change as time passes, even if the stock price stays the same."
              simpleExplanation={getExposureExplanation('cex', getExposureSign(net?.net_cex))}
            />
          </Grid>
        </>
      )}
      {sections.includes('greeks') && isModelDerivedGreeks && (
        <Grid item xs={12}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            📖 Note
          </Typography>
          <Typography variant="caption" color="text.secondary">
            VEX (Vanna Exposure) and CEX (Charm Exposure) are estimates based on the Black-Scholes options model.
            Yahoo Finance does not provide these values directly, so they are calculated from the available option data.
          </Typography>
        </Grid>
      )}

      {/* Volatility Metrics */}
      {sections.includes('volatility') && (
      <>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="💲 Option Prices (IV Rank)"
          value={ivr != null ? `${ivr.toFixed(1)}%` : '—'}
          subtitle="52W IV Percentile"
          status={getMetricStatus('ivr', ivr)}
          description={ivr == null
            ? 'Building 52-week IV history for this ticker from daily snapshots -- no historical IV data source exists yet, so this fills in over time as the ticker is viewed on future trading days.'
            : undefined}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="⚖️ Bullish vs Bearish Demand (25Δ Volatility Skew)"
          value={skew != null ? skew.toFixed(4) : '—'}
          subtitle="Put IV - Call IV"
          status={getMetricStatus('skew', skew)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="📈 Recent Stock Movement (Historical Volatility)"
          value={historicalVolatilityPct != null ? `${historicalVolatilityPct.toFixed(1)}%` : '—'}
          subtitle="20-day realized volatility"
          status={getMetricStatus('historical_volatility', historicalVolatilityPct)}
          notes={
            realizedVol10dPct != null || realizedVol60dPct != null
              ? [
                  `Last 10 days: ${realizedVol10dPct != null ? `${realizedVol10dPct.toFixed(1)}%` : '—'}`,
                  `Last 60 days: ${realizedVol60dPct != null ? `${realizedVol60dPct.toFixed(1)}%` : '—'}`,
                  getRealizedVolTrendNote(),
                ].filter(Boolean)
              : undefined
          }
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="💰 Option Value (Volatility Risk Premium)"
          value={volatilityRiskPremiumPct != null ? `${volatilityRiskPremiumPct.toFixed(1)}%` : '—'}
          subtitle="ATM IV - HV"
          status={getMetricStatus('volatility_risk_premium', volatilityRiskPremiumPct)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="🎯 Expected Move"
          value={expected_move != null ? `±$${expected_move.toFixed(2)}` : '—'}
          subtitle="ATM call + put premium"
          status={getMetricStatus('expected_move', expected_move)}
        />
      </Grid>
      <Grid item xs={12}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            📖 Simple Guide
          </Typography>
          <Table size="small">
            <TableBody>
              {[
                ['Option Prices (IV Rank)', 'Are options cheap or expensive?'],
                ['Bullish vs Bearish Demand (25Δ Volatility Skew)', 'Are traders leaning bullish or bearish?'],
                ['Recent Stock Movement (Historical Volatility)', 'How much has the stock actually been moving lately?'],
                ['Option Value (Volatility Risk Premium)', 'Are options priced fairly compared to recent stock movement?'],
                ['Expected Move', 'How much does the market expect the stock to move before expiration?'],
              ].map(([indicator, meaning]) => (
                <TableRow key={indicator}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{indicator}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Grid>
      </>
      )}
      {sections.includes('flow') && (
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="💰 Money Flow (Premium Put/Call Ratio)"
          value={call_premium_notional != null && put_premium_notional != null
            ? (put_premium_notional / (call_premium_notional || 1)).toFixed(2)
            : '—'}
          subtitle="Volume-weighted premium ratio"
          status={getMetricStatus('premium_pcr', call_premium_notional != null && put_premium_notional != null ? (put_premium_notional / (call_premium_notional || 1)) : null)}
          notes={['Above 1.0 = More money into puts (bearish)', 'Below 1.0 = More money into calls (bullish)']}
        />
      </Grid>
      )}
    </Grid>
  );
}
