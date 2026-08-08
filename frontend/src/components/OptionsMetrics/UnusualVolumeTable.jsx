/**
 * UnusualVolumeTable
 *
 * Contracts trading today at more than 1.5x their existing open interest
 * (find_unusual_volume() in options_metrics.py) -- a rough "someone is
 * doing something today, not just holding" flag. Pre-filtered and
 * pre-sorted (highest ratio first) server-side; this just renders it.
 *
 * The analysis block below is real arithmetic over these exact rows (call
 * vs put volume split, which side of the spot price the activity clusters
 * on, the single most extreme contract) -- never an invented signal or
 * probability, same rule the Horizon panel follows. It describes WHAT the
 * data shows, not a buy/sell call, since volume alone can't distinguish a
 * new position from someone closing an old one (see the caption below).
 */
import { useMemo } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  Box,
} from '@mui/material';
import LastUpdated from './LastUpdated';

function summarizeUnusualActivity(contracts, spotPrice) {
  if (!contracts || contracts.length === 0) return null;

  let callVolume = 0;
  let putVolume = 0;
  let aboveSpotVolume = 0;
  let belowSpotVolume = 0;
  let mostExtreme = contracts[0];

  for (const row of contracts) {
    if (row.type === 'call') callVolume += row.volume;
    else putVolume += row.volume;

    if (typeof spotPrice === 'number') {
      if (row.strike >= spotPrice) aboveSpotVolume += row.volume;
      else belowSpotVolume += row.volume;
    }

    if (row.ratio > mostExtreme.ratio) mostExtreme = row;
  }

  const totalVolume = callVolume + putVolume;
  const callSharePct = totalVolume > 0 ? (callVolume / totalVolume) * 100 : null;

  let tiltSentence;
  if (callSharePct === null) {
    tiltSentence = null;
  } else if (callSharePct >= 65) {
    tiltSentence = `Unusual activity today skews heavily toward calls (${callSharePct.toFixed(0)}% of the unusual volume), not puts.`;
  } else if (callSharePct <= 35) {
    tiltSentence = `Unusual activity today skews heavily toward puts (${(100 - callSharePct).toFixed(0)}% of the unusual volume), not calls.`;
  } else {
    tiltSentence = `Unusual activity is fairly balanced between calls and puts today (${callSharePct.toFixed(0)}% calls).`;
  }

  let clusterSentence = null;
  if (typeof spotPrice === 'number' && (aboveSpotVolume > 0 || belowSpotVolume > 0)) {
    const aboveTotal = aboveSpotVolume + belowSpotVolume;
    const abovePct = (aboveSpotVolume / aboveTotal) * 100;
    if (abovePct >= 65) {
      clusterSentence = `Most of it is concentrated in strikes above the current price ($${spotPrice.toFixed(2)}) -- bets or hedges positioned for a move higher, or downside protection sellers.`;
    } else if (abovePct <= 35) {
      clusterSentence = `Most of it is concentrated in strikes below the current price ($${spotPrice.toFixed(2)}) -- bets or hedges positioned for a move lower, or downside protection buyers.`;
    } else {
      clusterSentence = `It's spread fairly evenly on both sides of the current price ($${spotPrice.toFixed(2)}).`;
    }
  }

  const standoutSentence = `The single most extreme contract is the $${mostExtreme.strike.toFixed(2)} ${mostExtreme.type === 'call' ? 'Call' : 'Put'}, trading at ${mostExtreme.ratio.toFixed(2)}x its open interest.`;

  return { tiltSentence, clusterSentence, standoutSentence };
}

/**
 * @param {Object} props
 * @param {Array<{strike:number, type:string, volume:number, open_interest:number, ratio:number}>} [props.contracts]
 * @param {number} [props.limit=25]
 * @param {string} [props.expiration] - the single expiration these contracts were computed for
 * @param {string} [props.asOf] - ISO timestamp this data was computed/fetched
 * @param {number} [props.spotPrice] - underlying price, used to say which side of the market the activity clusters on
 */
export default function UnusualVolumeTable({ contracts, limit = 25, expiration, asOf, spotPrice }) {
  const summary = useMemo(() => summarizeUnusualActivity(contracts, spotPrice), [contracts, spotPrice]);

  if (!contracts) return null;

  const rows = contracts.slice(0, limit);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
          Unusual Volume
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'baseline', mb: 0.5 }}>
          {expiration && (
            <Typography variant="caption" color="text.secondary">
              Expiration: <strong>{expiration}</strong>
            </Typography>
          )}
          <LastUpdated timestamp={asOf} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Contracts trading at over 1.5x their existing open interest today -- volume alone does not distinguish a new position from someone closing out an old one, so this is not proof of directional conviction, just a flag worth a closer look.
        </Typography>

        {rows.length === 0 && (
          <Alert severity="info">No contracts trading above 1.5x open interest right now.</Alert>
        )}

        {summary && rows.length > 0 && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              What&apos;s unusual here
            </Typography>
            {summary.tiltSentence && (
              <Typography variant="body2" sx={{ mb: 0.5 }}>{summary.tiltSentence}</Typography>
            )}
            {summary.clusterSentence && (
              <Typography variant="body2" sx={{ mb: 0.5 }}>{summary.clusterSentence}</Typography>
            )}
            <Typography variant="body2">{summary.standoutSentence}</Typography>
          </Alert>
        )}

        {rows.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Strike</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Volume</TableCell>
                  <TableCell align="right">Open Interest</TableCell>
                  <TableCell align="right">Vol / OI</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.type}-${row.strike}`}>
                    <TableCell>${row.strike.toFixed(2)}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.type === 'call' ? 'Call' : 'Put'}
                        size="small"
                        color={row.type === 'call' ? 'success' : 'error'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{row.volume.toLocaleString()}</TableCell>
                    <TableCell align="right">{row.open_interest.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {row.ratio.toFixed(2)}x
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {contracts.length > limit && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Showing top {limit} of {contracts.length} by ratio.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
