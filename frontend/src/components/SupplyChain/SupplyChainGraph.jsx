import { useEffect, useMemo, useRef, useState } from 'react';

import { useSupplyChain } from '../../contexts/SupplyChainContext';
import { computeGraphLayout, CANVAS_WIDTH, CANVAS_HEIGHT } from './graphLayout';
import GraphNode from './GraphNode';
import GraphEdge from './GraphEdge';
import GraphTooltip from './GraphTooltip';

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function fitTransform(containerSize) {
  if (!containerSize.width || !containerSize.height) {
    return { scale: 0.8, x: 0, y: 0 };
  }
  const fitScale = Math.min(containerSize.width / CANVAS_WIDTH, containerSize.height / CANVAS_HEIGHT) * 0.92;
  const scale = clamp(fitScale, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    x: (containerSize.width - CANVAS_WIDTH * scale) / 2,
    y: (containerSize.height - CANVAS_HEIGHT * scale) / 2,
  };
}

/** The central directed network graph -- target node dead center, suppliers
 * on a left arc, customers on a right arc, competitors split across a
 * top/bottom row. Custom SVG pan/zoom/drag (no graph library): the layout is
 * structured rather than force-directed, so a bespoke renderer keeps full
 * control over the exact Bloomberg-terminal look without pulling in a large
 * dependency for something react-flow/d3 would fight to theme anyway. */
export default function SupplyChainGraph() {
  const { dataset, filteredCounterparties, selectedNodeId, setSelectedNodeId } = useSupplyChain();
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.8 });
  const [positionOverrides, setPositionOverrides] = useState({});
  const [hover, setHover] = useState(null); // { entry, clientX, clientY }
  const dragRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-fit and clear manual node drags whenever the ticker changes or the
  // container is measured for the first time.
  useEffect(() => {
    if (!containerSize.width || !containerSize.height) return;
    setTransform(fitTransform(containerSize));
    setPositionOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally NOT re-fitting on every resize after the initial measurement, so an in-progress pan/zoom survives incidental layout shifts (e.g. sidebar toggling).
  }, [dataset?.ticker, containerSize.width > 0 && containerSize.height > 0]);

  const suppliers = useMemo(() => filteredCounterparties.filter((e) => e.category === 'suppliers'), [filteredCounterparties]);
  const customers = useMemo(() => filteredCounterparties.filter((e) => e.category === 'customers'), [filteredCounterparties]);
  const competitors = useMemo(() => filteredCounterparties.filter((e) => e.category === 'competitors'), [filteredCounterparties]);

  const layout = useMemo(() => computeGraphLayout({ suppliers, customers, competitors }), [suppliers, customers, competitors]);

  // Merge computed layout positions with any manual drag overrides, and the
  // fixed target entry, into one id -> {entry, x, y} lookup used by both
  // nodes and edges.
  const nodesById = useMemo(() => {
    const map = new Map();
    if (dataset) {
      const targetPos = positionOverrides.__target__ ?? layout.target;
      map.set('__target__', { entry: { id: '__target__', category: 'target', ...dataset }, ...targetPos });
    }
    for (const entry of [...layout.suppliers, ...layout.customers, ...layout.competitors]) {
      const pos = positionOverrides[entry.id] ?? { x: entry.x, y: entry.y };
      map.set(entry.id, { entry, ...pos });
    }
    return map;
  }, [dataset, layout, positionOverrides]);

  // Global pointer listeners drive both node dragging and canvas panning --
  // attached once; live state is read from dragRef so the listener itself
  // never needs to be re-subscribed mid-gesture.
  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === 'pan') {
        setTransform((prev) => ({
          ...prev,
          x: drag.startPanX + (e.clientX - drag.startClientX),
          y: drag.startPanY + (e.clientY - drag.startClientY),
        }));
      } else if (drag.mode === 'node') {
        const dx = (e.clientX - drag.startClientX) / drag.scale;
        const dy = (e.clientY - drag.startClientY) / drag.scale;
        setPositionOverrides((prev) => ({ ...prev, [drag.id]: { x: drag.startX + dx, y: drag.startY + dy } }));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Native (non-passive) wheel listener -- React's synthetic onWheel can't
  // reliably preventDefault the page scroll on every browser.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheelNative = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setTransform((prev) => {
        const newScale = clamp(prev.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          x: cursorX - (cursorX - prev.x) * ratio,
          y: cursorY - (cursorY - prev.y) * ratio,
        };
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  const handleNodeDragStart = (id, e) => {
    e.stopPropagation();
    const node = nodesById.get(id);
    if (!node) return;
    dragRef.current = {
      mode: 'node',
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: node.x,
      startY: node.y,
      scale: transform.scale,
    };
  };

  const handleBackgroundPointerDown = (e) => {
    dragRef.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: transform.x,
      startPanY: transform.y,
    };
    setIsPanning(true);
  };

  const handleBackgroundClick = () => setSelectedNodeId('__target__');

  const handleHoverStart = (hoveredEntry, domEvent) =>
    setHover({ entry: hoveredEntry, clientX: domEvent.clientX, clientY: domEvent.clientY });
  const handleHoverEnd = () => setHover(null);

  const zoomBy = (factor) => {
    setTransform((prev) => {
      const newScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
      const cx = containerSize.width / 2;
      const cy = containerSize.height / 2;
      const ratio = newScale / prev.scale;
      return { scale: newScale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
    });
  };

  const resetView = () => {
    setTransform(fitTransform(containerSize));
    setPositionOverrides({});
  };

  if (!dataset) return null;

  const target = nodesById.get('__target__');

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-splc-bg"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,153,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,153,0,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        cursor: isPanning ? 'grabbing' : 'grab',
      }}
      onPointerDown={handleBackgroundPointerDown}
      onClick={handleBackgroundClick}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="splc-target-gradient" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#ffc266" />
            <stop offset="100%" stopColor="#ff9900" />
          </radialGradient>
          <marker id="splc-arrow-supplier" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#ff9900" />
          </marker>
          <marker id="splc-arrow-customer" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#38bdf8" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          <rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="transparent" />

          {suppliers.map((entry) => {
            const node = nodesById.get(entry.id);
            if (!node) return null;
            return (
              <GraphEdge
                key={`edge-${entry.id}`}
                entry={entry}
                from={node}
                to={target}
                direction="in"
                isHighlighted={hover?.entry?.id === entry.id || selectedNodeId === entry.id}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
              />
            );
          })}
          {customers.map((entry) => {
            const node = nodesById.get(entry.id);
            if (!node) return null;
            return (
              <GraphEdge
                key={`edge-${entry.id}`}
                entry={entry}
                from={target}
                to={node}
                direction="out"
                isHighlighted={hover?.entry?.id === entry.id || selectedNodeId === entry.id}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
              />
            );
          })}

          {[...suppliers, ...customers, ...competitors].map((entry) => {
            const node = nodesById.get(entry.id);
            if (!node) return null;
            return (
              <GraphNode
                key={entry.id}
                entry={entry}
                x={node.x}
                y={node.y}
                isSelected={selectedNodeId === entry.id}
                onSelect={setSelectedNodeId}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
                onDragStart={handleNodeDragStart}
              />
            );
          })}

          {target && (
            <GraphNode
              entry={target.entry}
              x={target.x}
              y={target.y}
              isSelected={selectedNodeId === '__target__'}
              onSelect={setSelectedNodeId}
              onHoverStart={(e, evt) => setHover({ entry: e, clientX: evt.clientX, clientY: evt.clientY })}
              onHoverEnd={() => setHover(null)}
              onDragStart={handleNodeDragStart}
            />
          )}
        </g>
      </svg>

      {hover && <GraphTooltip entry={hover.entry} clientX={hover.clientX} clientY={hover.clientY} />}

      <div className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-md border border-splc-border bg-splc-panel-raised/90 font-splc-mono text-sm text-splc-text shadow-lg">
        <button type="button" className="px-3 py-1.5 hover:bg-splc-amber/10 hover:text-splc-amber" onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
        <button
          type="button"
          className="border-t border-splc-border px-3 py-1.5 hover:bg-splc-amber/10 hover:text-splc-amber"
          onClick={() => zoomBy(0.8)}
          title="Zoom out"
        >
          &minus;
        </button>
        <button
          type="button"
          className="border-t border-splc-border px-3 py-1.5 text-[10px] uppercase tracking-wider hover:bg-splc-amber/10 hover:text-splc-amber"
          onClick={resetView}
          title="Reset view"
        >
          Fit
        </button>
      </div>

      <div className="pointer-events-none absolute left-4 top-4 font-splc-mono text-[10px] uppercase tracking-widest text-splc-muted">
        Drag canvas to pan &middot; Scroll to zoom &middot; Drag a node to reposition
      </div>
    </div>
  );
}
