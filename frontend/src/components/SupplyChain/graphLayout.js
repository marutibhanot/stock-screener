/** Pure layout math for the SPLC network graph. No physics/force simulation
 * -- the spec calls for a structured layout (suppliers left arc, customers
 * right arc, competitors top/bottom row, target dead center), which a
 * deterministic layout renders more predictably than a force simulation
 * would. Coordinates are in an abstract "virtual canvas" space; the SVG
 * viewBox + pan/zoom transform in SupplyChainGraph.jsx handle screen mapping. */

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 820;
export const CENTER = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Vertical arc of nodes bulging toward the target -- used for both the
 * supplier column (side = -1, left) and customer column (side = +1, right). */
function arcColumn(count, side) {
  if (count === 0) return [];
  const baseX = CENTER.x + side * 380;
  const arcBulge = 55;
  const verticalSpan = Math.min(600, 145 * Math.max(count - 1, 1));
  const top = CENTER.y - verticalSpan / 2;
  const step = count > 1 ? verticalSpan / (count - 1) : 0;

  return Array.from({ length: count }, (_, i) => {
    const y = count === 1 ? CENTER.y : top + step * i;
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1..1
    const bulge = (1 - t * t) * arcBulge; // parabolic: max bulge at the middle node
    const x = baseX - side * bulge;
    return { x, y };
  });
}

/** Competitors/peers split across a top row and bottom row, evenly spaced
 * horizontally, per the "Competitors / Peers (Top/Bottom Row)" spec. */
function topBottomRow(count) {
  if (count === 0) return [];
  const topCount = Math.ceil(count / 2);
  const bottomCount = count - topCount;
  const span = 680;

  const layoutRow = (n, y) => {
    if (n === 0) return [];
    if (n === 1) return [{ x: CENTER.x, y }];
    const left = CENTER.x - span / 2;
    const step = span / (n - 1);
    return Array.from({ length: n }, (_, i) => ({ x: left + step * i, y }));
  };

  return [...layoutRow(topCount, 78), ...layoutRow(bottomCount, CANVAS_HEIGHT - 78)];
}

export function computeGraphLayout({ suppliers = [], customers = [], competitors = [] }) {
  const supplierPositions = arcColumn(suppliers.length, -1);
  const customerPositions = arcColumn(customers.length, 1);
  const competitorPositions = topBottomRow(competitors.length);

  return {
    target: { ...CENTER },
    suppliers: suppliers.map((entry, i) => ({ ...entry, ...supplierPositions[i] })),
    customers: customers.map((entry, i) => ({ ...entry, ...customerPositions[i] })),
    competitors: competitors.map((entry, i) => ({ ...entry, ...competitorPositions[i] })),
  };
}

/** Exposure-weighted node radius -- suppliers/customers scale with whichever
 * exposure % they carry, competitors and the target use fixed sizes. */
export function nodeRadiusFor(entry) {
  if (entry.category === 'target') return 48;
  if (entry.category === 'competitors') return 27;
  const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? 0;
  return clamp(19 + exposure * 0.55, 19, 46);
}

/** Edge stroke width scales with the same exposure value driving node size,
 * per the "arrow stroke thickness scale based on exposure %" requirement. */
export function edgeWidthFor(entry) {
  const exposure = entry.revenueExposurePct ?? entry.cogsExposurePct ?? 0;
  return clamp(1.5 + exposure * 0.16, 1.5, 8);
}
