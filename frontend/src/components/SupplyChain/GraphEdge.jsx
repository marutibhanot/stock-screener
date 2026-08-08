import { exposureTierFor } from '../../data/mockSupplyChainData';
import { edgeWidthFor } from './graphLayout';

// Dynamic Line Colors per the dashboard's backend-integration spec: Green
// (>15%), Amber (5-15%), Gray (<5%) -- mirrors GraphNode's TIER_FILL /
// styles/supplyChain.css's --color-splc-high/-medium/-low tokens.
const TIER_COLOR = {
  high: '#00c853',
  medium: '#ff9900',
  low: '#6c727f',
};

/** Directed edge between a supplier/customer and the target node. Suppliers
 * point INTO the target (arrow at target end); customers point OUT of the
 * target (arrow at customer end) -- per the "Directed arrows point FROM
 * Supplier TO Target" / "FROM Target TO Customer" spec. Competitors render
 * with no edge (they're peers, not a flow relationship). Line color reflects
 * exposure tier (not supplier/customer category) -- direction and node
 * position already distinguish supplier vs. customer, so color is free to
 * carry the exposure-magnitude signal instead. A gentle quadratic curve
 * (rather than a straight spoke) keeps the map legible when many
 * suppliers/customers converge on the same center point. */
export default function GraphEdge({ entry, from, to, direction, isHighlighted, onHoverStart, onHoverEnd }) {
  const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? 0;
  const tier = exposureTierFor(exposure);
  const color = TIER_COLOR[tier];
  const width = edgeWidthFor(entry);

  // direction: 'in' = supplier -> target (arrow at `to`), 'out' = target -> customer (arrow at `to`)
  const [x1, y1] = direction === 'in' ? [from.x, from.y] : [to.x, to.y];
  const [x2, y2] = direction === 'in' ? [to.x, to.y] : [from.x, from.y];

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  // Perpendicular offset so the curve bows slightly away from a straight
  // spoke -- purely cosmetic, keeps overlapping edges visually separable.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(28, len * 0.08);
  const ctrlX = midX + (-dy / len) * bow;
  const ctrlY = midY + (dx / len) * bow;

  const path = `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
  const markerId = `splc-arrow-${tier}`;

  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={isHighlighted ? width + 1.5 : width}
      strokeOpacity={isHighlighted ? 0.95 : 0.5}
      markerEnd={`url(#${markerId})`}
      style={{ cursor: 'pointer', transition: 'stroke-width 120ms, stroke-opacity 120ms' }}
      onMouseEnter={(e) => onHoverStart(entry, e)}
      onMouseMove={(e) => onHoverStart(entry, e)}
      onMouseLeave={onHoverEnd}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
