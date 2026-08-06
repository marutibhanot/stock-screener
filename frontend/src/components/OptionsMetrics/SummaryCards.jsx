import { Grid, Paper, Typography, Box, Chip } from '@mui/material';

function MetricCard({ title, value, subtitle, color, status, description }) {
  const isZero = value === 0 || value === '0';
  return (
    <Paper sx={{ p: 2, height: '100%', backgroundColor: isZero ? 'rgba(255,152,0,0.05)' : 'inherit' }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="h6" sx={{ color: color || 'inherit' }}>
        {value ?? '—'}
      </Typography>
      {status && (
        <Box sx={{ mt: 1 }}>
          <Chip label={status.label} size="small" color={status.color} />
          {status.description && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              {status.description}
            </Typography>
          )}
        </Box>
      )}
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      {/* Plain-language explanation for cards with no good/bad judgment to
          make (structural levels, exposure greeks) -- distinct from
          status.description, which only renders alongside an evaluative
          Chip (Low/High/Neutral etc). */}
      {description && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {description}
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
  const volatilityRiskPremiumPct = volatility_risk_premium != null ? volatility_risk_premium * 100 : null;

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
          label: 'Low IVR',
          color: 'warning',
          description: 'Options are currently inexpensive because the market expects relatively small price moves (low IV Rank).',
        };
      }
      if (num > 80) {
        return {
          label: 'High IVR',
          color: 'warning',
          description: 'Options are currently expensive because the market expects larger price moves (high IV Rank).',
        };
      }
      return {
        label: 'Normal IVR',
        color: 'success',
        description: 'Option prices are neither especially cheap nor expensive right now (mid-range IV Rank).',
      };
    }

    if (metric === 'skew') {
      if (num > 0.01) {
        return {
          label: 'Put Skew',
          color: 'warning',
          description: 'More traders are paying up for protection against the stock falling (put skew).',
        };
      }
      if (num < -0.01) {
        return {
          label: 'Call Skew',
          color: 'success',
          description: 'More traders are betting on the stock going up than down (call skew).',
        };
      }
      return {
        label: 'Neutral Skew',
        color: 'success',
        description: "Traders aren't strongly favoring upside or downside bets right now (neutral skew).",
      };
    }

    if (metric === 'historical_volatility') {
      if (num < 15) {
        return {
          label: 'Low HV',
          color: 'success',
          description: 'The stock has been fairly calm recently.',
        };
      }
      if (num > 35) {
        return {
          label: 'High HV',
          color: 'warning',
          description: 'The stock has been moving around a lot recently.',
        };
      }
      return {
        label: 'Moderate HV',
        color: 'info',
        description: "The stock's recent price swings have been fairly typical.",
      };
    }

    if (metric === 'volatility_risk_premium') {
      if (num > 2) {
        return {
          label: 'Rich VRP',
          color: 'warning',
          description: "Options are pricier than the stock's recent moves would suggest they should be (rich VRP).",
        };
      }
      if (num < -2) {
        return {
          label: 'Cheap VRP',
          color: 'success',
          description: "Options are cheaper than the stock's recent moves would suggest they should be (cheap VRP).",
        };
      }
      return {
        label: 'Neutral VRP',
        color: 'info',
        description: 'Option prices roughly match how much the stock has actually been moving (neutral VRP).',
      };
    }

    if (metric === 'expected_move') {
      return {
        label: 'Guidance',
        color: 'info',
        description: "This isn't a prediction -- just the market's best estimate of how far the stock could move by expiration.",
      };
    }

    if (metric === 'premium_pcr') {
      if (num > 1.5) {
        return {
          label: 'Put-Biased',
          color: 'warning',
          description: 'More money is currently being spent on put options than call options.',
        };
      }
      if (num < 0.7) {
        return {
          label: 'Call-Biased',
          color: 'success',
          description: 'More money is currently being spent on call options than put options.',
        };
      }
      return {
        label: 'Neutral Premium',
        color: 'info',
        description: 'Roughly equal money is being spent on call and put options.',
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
          color: 'warning',
          description: 'The stock has already broken above this resistance level.',
        };
      }
      if (pctFromWall > -2) {
        return {
          label: 'Near Call Wall',
          color: 'warning',
          description: 'The stock is approaching a level where it may face resistance.',
        };
      }
      return {
        label: 'Below Call Wall',
        color: 'info',
        description: 'The stock has room to rise before hitting this resistance level.',
      };
    }

    // side === 'put'
    if (spot <= wallStrike) {
      return {
        label: 'Below Put Wall',
        color: 'warning',
        description: 'The stock has already broken below this support level.',
      };
    }
    if (pctFromWall < 2) {
      return {
        label: 'Near Put Wall',
        color: 'warning',
        description: 'The stock is approaching a level where buyers may step in.',
      };
    }
    return {
      label: 'Above Put Wall',
      color: 'success',
      description: 'The stock has room to fall before reaching this support level.',
    };
  };

  // Sign-only badge for DEX/VEX/CEX -- deliberately neutral color (these
  // aren't inherently bullish/bearish signals the way gamma regime is), just
  // labels which direction the current reading points.
  const getExposureSignStatus = (label) => (value) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    const num = Number(value);
    if (num > 0) return { label: `Positive ${label}`, color: 'info' };
    if (num < 0) return { label: `Negative ${label}`, color: 'info' };
    return { label: `Neutral ${label}`, color: 'info' };
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
            <MetricCard
              title="Net DEX"
              value={net?.net_dex !== undefined ? formatNumber(net.net_dex) : '—'}
              subtitle="Delta Exposure"
              color={net?.net_dex > 0 ? 'success.main' : net?.net_dex < 0 ? 'error.main' : undefined}
              description="Shows how much stock dealers may need to buy or sell as the price moves. Higher numbers usually mean dealers help keep the price more stable."
              status={getExposureSignStatus('DEX')(net?.net_dex)}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <MetricCard
              title="Net VEX"
              value={net?.net_vex !== undefined ? formatNumber(net.net_vex) : '—'}
              subtitle={isModelDerivedGreeks ? 'Vanna Exposure (model estimate)' : 'Vanna Exposure'}
              color={net?.net_vex > 0 ? 'success.main' : net?.net_vex < 0 ? 'error.main' : undefined}
              description="Shows how dealer buying and selling could change if the market's expectations for volatility change."
              status={getExposureSignStatus('VEX')(net?.net_vex)}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <MetricCard
              title="Net CEX"
              value={net?.net_cex !== undefined ? formatNumber(net.net_cex) : '—'}
              subtitle={isModelDerivedGreeks ? 'Charm Exposure (model estimate)' : 'Charm Exposure'}
              color={net?.net_cex > 0 ? 'success.main' : net?.net_cex < 0 ? 'error.main' : undefined}
              description="Shows how dealer positions naturally change as time passes, even if the stock price doesn't move."
              status={getExposureSignStatus('CEX')(net?.net_cex)}
            />
          </Grid>
        </>
      )}
      {sections.includes('greeks') && isModelDerivedGreeks && (
        <Grid item xs={12}>
          <Typography variant="caption" color="text.secondary">
            VEX/CEX are Black-Scholes estimates (strike + IV + time-to-expiry) — Yahoo&apos;s options data doesn&apos;t report vanna/charm directly.
          </Typography>
        </Grid>
      )}

      {/* Volatility Metrics */}
      {sections.includes('volatility') && (
      <>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="IV Rank (IVR)"
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
          title="25Δ Volatility Skew"
          value={skew != null ? skew.toFixed(4) : '—'}
          subtitle="Put IV - Call IV"
          status={getMetricStatus('skew', skew)}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Historical Volatility"
          value={historicalVolatilityPct != null ? `${historicalVolatilityPct.toFixed(1)}%` : '—'}
          subtitle="20-day realized volatility"
          status={getMetricStatus('historical_volatility', historicalVolatilityPct)}
          description="How much the stock has actually been swinging over the past 20 trading days. This looks backward at what already happened -- it isn't a forecast."
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Volatility Risk Premium"
          value={volatilityRiskPremiumPct != null ? `${volatilityRiskPremiumPct.toFixed(1)}%` : '—'}
          subtitle="ATM IV - HV"
          status={getMetricStatus('volatility_risk_premium', volatilityRiskPremiumPct)}
          description="The gap between how much movement options are pricing in and how much the stock has actually been moving lately. Positive means options are pricing in more movement than the stock has actually shown."
        />
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Expected Move"
          value={expected_move != null ? `$${expected_move.toFixed(2)}` : '—'}
          subtitle="ATM call + put premium"
          status={getMetricStatus('expected_move', expected_move)}
          description="A rough estimate of how far the stock could move by expiration, based on current option prices. There's roughly a 2-in-3 chance the stock stays within this range."
        />
      </Grid>
      </>
      )}
      {sections.includes('flow') && (
      <Grid item xs={12} sm={6} md={4} lg={3}>
        <MetricCard
          title="Premium Put/Call Ratio"
          value={call_premium_notional != null && put_premium_notional != null
            ? (put_premium_notional / (call_premium_notional || 1)).toFixed(2)
            : '—'}
          subtitle="Volume-weighted premium ratio"
          status={getMetricStatus('premium_pcr', call_premium_notional != null && put_premium_notional != null ? (put_premium_notional / (call_premium_notional || 1)) : null)}
          description="Compares how many dollars are flowing into puts vs calls today. Above 1: more money going into puts. Below 1: more into calls."
        />
      </Grid>
      )}
    </Grid>
  );
}
