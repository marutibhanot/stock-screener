import { Box, Typography, LinearProgress } from '@mui/material';

// Same Chip-color-keyword -> text-color mapping used across every other
// options-analytics component (SummaryCards.jsx, OptionsAnalyticsDashboardPage.jsx).
const STATUS_TEXT_COLOR = {
  success: 'success.main',
  error: 'error.main',
  warning: 'warning.main',
  default: 'text.secondary',
};

export function ordinal(n) {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

/**
 * A same-day cross-sectional percentile reading (0-100), rendered as a
 * thin progress bar -- "how unusual is this reading today, versus every
 * other ticker." Not a trailing-history percentile (that needs 60+ days
 * feature_percentiles doesn't have yet); see the "cross-sectional" label
 * on the parent section.
 */
export default function PercentileGauge({ label, percentile, status, blurb, comparisonNote }) {
  const hasValue = percentile != null && !Number.isNaN(Number(percentile));
  const color = status ? STATUS_TEXT_COLOR[status.color] || 'text.secondary' : 'text.secondary';

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, color }}>
          {hasValue ? `${ordinal(percentile)} pct` : '—'}
          {status ? ` (${status.label})` : ''}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={hasValue ? Math.max(0, Math.min(100, percentile)) : 0}
        sx={{
          height: 7,
          borderRadius: 1,
          backgroundColor: 'action.hover',
          '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 1 },
        }}
      />
      {/* What-this-is (always shown) + what-today's-reading-means (only when
          we have a status to explain), matching SummaryCards.jsx's
          subtitle + "What this means:" convention. */}
      {blurb && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {blurb}
        </Typography>
      )}
      {status?.description && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          <strong>What this means:</strong> {status.description}
        </Typography>
      )}
      {comparisonNote && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
          {comparisonNote}
        </Typography>
      )}
    </Box>
  );
}
