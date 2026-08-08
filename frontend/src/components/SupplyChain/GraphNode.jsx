import { exposureTierFor } from '../../data/mockSupplyChainData';
import { nodeRadiusFor } from './graphLayout';

const TIER_FILL = {
  high: '#00c853',
  medium: '#ffb300',
  low: '#3a4150',
  unknown: '#3a4150',
};

const CATEGORY_STROKE = {
  target: '#ff9900',
  suppliers: '#ff9900',
  customers: '#38bdf8',
  competitors: '#6c727f',
};

/** One company node in the SPLC graph: target (center), supplier, customer,
 * or competitor. Circle size + fill communicate exposure tier at a glance;
 * the target gets an amber glow ring (see .splc-target-glow in
 * styles/supplyChain.css) so it reads as the fixed center of the map. */
export default function GraphNode({ entry, x, y, isSelected, onSelect, onHoverStart, onHoverEnd, onDragStart }) {
  const radius = nodeRadiusFor(entry);
  const isTarget = entry.category === 'target';
  const isCompetitor = entry.category === 'competitors';
  const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? null;
  const tier = isTarget ? null : exposureTierFor(exposure);

  const fill = isTarget
    ? 'url(#splc-target-gradient)'
    : isCompetitor
      ? '#171b24'
      : TIER_FILL[tier];
  const stroke = CATEGORY_STROKE[entry.category];
  const strokeWidth = isSelected ? 3.5 : isTarget ? 2.5 : 1.5;
  const strokeDasharray = isCompetitor ? '4 3' : undefined;
  const labelColor = isCompetitor ? '#9aa1ad' : '#e1e4ea';

  return (
    <g
      className={isTarget ? 'splc-target-glow' : ''}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(entry.id);
      }}
      onMouseEnter={(e) => onHoverStart(entry, e)}
      onMouseMove={(e) => onHoverStart(entry, e)}
      onMouseLeave={onHoverEnd}
      onPointerDown={(e) => onDragStart(entry.id, e)}
    >
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fill}
        fillOpacity={isTarget ? 1 : isCompetitor ? 0.9 : 0.85}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
      {isSelected && !isTarget && (
        <circle cx={x} cy={y} r={radius + 5} fill="none" stroke="#ff9900" strokeWidth={1.5} strokeOpacity={0.7} />
      )}
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-splc-mono)"
        fontSize={isTarget ? 15 : 11}
        fontWeight={700}
        fill={isTarget ? '#0f1218' : isCompetitor ? '#e1e4ea' : '#0f1218'}
      >
        {entry.ticker.split('.')[0]}
      </text>
      <text
        x={x}
        y={y + radius + 16}
        textAnchor="middle"
        fontFamily="var(--font-splc-sans)"
        fontSize={10.5}
        fill={labelColor}
      >
        {truncate(entry.name, 20)}
      </text>
      {!isTarget && exposure != null && (
        <text
          x={x}
          y={y + radius + 29}
          textAnchor="middle"
          fontFamily="var(--font-splc-mono)"
          fontSize={10}
          fontWeight={600}
          fill={TIER_FILL[tier]}
        >
          {exposure.toFixed(1)}%
        </text>
      )}
    </g>
  );
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}
