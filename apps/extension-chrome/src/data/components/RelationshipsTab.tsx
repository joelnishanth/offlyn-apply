import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import { Maximize2, ZoomIn, ZoomOut, RotateCcw, Layers, Focus, Bug } from 'lucide-react';
import { nodeTypes } from '../graph/nodeTypes';
import { buildReactFlowElements, getBaseEdgeStyle, getFocusedEdgeStyle, getEdgeColor } from '../graph/layoutEngine';
import { NodeInspector } from './NodeInspector';
import { EmptyState } from './ui/EmptyState';
import type { GraphNode, GraphEdge, NodeType, EdgeType, AnswerPayload } from '../../shared/graph/types';

// ── Mode definitions ──────────────────────────────────────────────────────────

export type DisplayMode = 'overview' | 'focus' | 'advanced';

interface ModeDefinition {
  label:       string;
  icon:        React.ReactNode;
  description: string;
  // Which node types to include
  nodeTypes:   Set<NodeType>;
  // Which edge types to include
  edgeTypes:   Set<EdgeType>;
  // Minimum answer confidence to show (0 = all)
  minConfidence: number;
  // Whether to show edge type labels on the canvas
  showEdgeLabels: boolean;
}

const ALL_NODE_TYPES: NodeType[] = ['question', 'answer', 'field', 'correction', 'application'];
const ALL_EDGE_TYPES: EdgeType[] = ['ANSWERED_BY', 'MAPS_TO', 'CORRECTED_TO', 'USED_IN', 'SIMILAR_TO', 'DERIVED_FROM'];

const MODES: Record<DisplayMode, ModeDefinition> = {
  overview: {
    label:          'Overview',
    icon:           <Layers size={13} />,
    description:    'Key structure — fields, questions, high-confidence answers',
    nodeTypes:      new Set<NodeType>(['field', 'question', 'answer']),
    edgeTypes:      new Set<EdgeType>(['MAPS_TO', 'ANSWERED_BY']),
    minConfidence:  0.6,
    showEdgeLabels: false,
  },
  focus: {
    label:          'Focus',
    icon:           <Focus size={13} />,
    description:    'Select a node to reveal its local neighborhood',
    nodeTypes:      new Set<NodeType>(['field', 'question', 'answer', 'correction']),
    edgeTypes:      new Set<EdgeType>(['MAPS_TO', 'ANSWERED_BY', 'CORRECTED_TO', 'DERIVED_FROM']),
    minConfidence:  0,
    showEdgeLabels: false, // labels only on focused edges
  },
  advanced: {
    label:          'Advanced',
    icon:           <Bug size={13} />,
    description:    'Full graph — all nodes, all edges, all metadata',
    nodeTypes:      new Set<NodeType>(ALL_NODE_TYPES),
    edgeTypes:      new Set<EdgeType>(ALL_EDGE_TYPES),
    minConfidence:  0,
    showEdgeLabels: true,
  },
};

// ── Edge label style (Advanced mode) ─────────────────────────────────────────

const EDGE_LABEL_STYLE: React.CSSProperties = {
  fontSize:       9,
  fontFamily:     'SF Mono, Cascadia Code, ui-monospace, monospace',
  fill:           '#71717a',
  letterSpacing:  '0.03em',
};

const EDGE_LABEL_BG_STYLE: React.CSSProperties = {
  fill:        '#18181b',
  fillOpacity: 0.85,
};

// ── Edge colors ───────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  ANSWERED_BY:  '#22c55e',
  MAPS_TO:      '#f59e0b',
  CORRECTED_TO: '#ef4444',
  USED_IN:      '#3b82f6',
  SIMILAR_TO:   '#6366f1',
  DERIVED_FROM: '#8b5cf6',
};

// ── Node type display meta ────────────────────────────────────────────────────

const NODE_LABELS: Record<NodeType, string> = {
  question:    'Questions',
  answer:      'Answers',
  field:       'Fields',
  correction:  'Corrections',
  application: 'Apps',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNeighbors(nodeId: string, edges: Edge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    if (e.source === nodeId) s.add(e.target);
    if (e.target === nodeId) s.add(e.source);
  }
  return s;
}

function edgeShortLabel(type: string): string {
  switch (type) {
    case 'ANSWERED_BY':  return 'answered';
    case 'MAPS_TO':      return 'maps to';
    case 'CORRECTED_TO': return 'corrected';
    case 'USED_IN':      return 'used in';
    case 'SIMILAR_TO':   return 'similar';
    case 'DERIVED_FROM': return 'derived';
    default:             return type.toLowerCase();
  }
}

// ── Legend row ────────────────────────────────────────────────────────────────

function GraphLegend({ mode, typeCounts }: {
  mode: DisplayMode;
  typeCounts: Partial<Record<NodeType, number>>;
}) {
  const cfg = MODES[mode];
  return (
    <div className="graph-legend">
      {ALL_NODE_TYPES.map(t => {
        const on  = cfg.nodeTypes.has(t);
        const cnt = typeCounts[t];
        return (
          <span key={t} className={`graph-legend-item ${on ? '' : 'off'}`}>
            <span className="graph-legend-dot" style={{ background: `var(--node-${t})` }} />
            {NODE_LABELS[t]}
            {on && cnt ? <span className="graph-legend-count">{cnt}</span> : null}
          </span>
        );
      })}
      <span className="graph-legend-sep" />
      {ALL_EDGE_TYPES.map(t => {
        const on = cfg.edgeTypes.has(t);
        return (
          <span key={t} className={`graph-legend-item ${on ? '' : 'off'}`}
                style={{ color: on ? EDGE_COLORS[t] : undefined }}>
            <span className="graph-legend-line"
                  style={{ background: on ? EDGE_COLORS[t] : 'var(--surface-3)' }} />
            {edgeShortLabel(t)}
          </span>
        );
      })}
    </div>
  );
}

// ── Inner component ───────────────────────────────────────────────────────────

function RelationshipsInner({
  initialNodes, initialEdges, graphNodes, graphEdges,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
  graphNodes:   Record<string, GraphNode>;
  graphEdges:   Record<string, GraphEdge>;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, ,     onEdgesChange]     = useEdgesState(initialEdges);
  const { fitView, zoomIn, zoomOut }     = useReactFlow();

  const [mode,           setMode]           = useState<DisplayMode>('overview');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const modeDef    = MODES[mode];
  const hasSelection = !!selectedNodeId;

  // ── Precomputed counts ──────────────────────────────────────────────────────

  const typeCounts = useMemo(() => {
    const c: Partial<Record<NodeType, number>> = {};
    for (const n of Object.values(graphNodes)) c[n.type] = (c[n.type] || 0) + 1;
    return c;
  }, [graphNodes]);

  // ── Neighborhood (1-hop) ────────────────────────────────────────────────────

  const neighborIds = useMemo<Set<string>>(() => {
    if (!selectedNodeId) return new Set();
    return getNeighbors(selectedNodeId, edges);
  }, [selectedNodeId, edges]);

  // ── Build computed nodes ────────────────────────────────────────────────────

  const computedNodes: Node[] = useMemo(() => {
    return nodes.map(n => {
      const graphNode = graphNodes[n.id];
      const payload = graphNode?.payload as any;

      // Internal (debug/similarity) nodes are hidden in Overview and Focus modes
      if (graphNode?.internal && mode !== 'advanced') {
        return { ...n, hidden: true, data: { ...n.data, mode, dimmed: false, neighbor: false } };
      }

      // Type filter
      if (!modeDef.nodeTypes.has(n.type as NodeType)) {
        return { ...n, hidden: true, data: { ...n.data, mode, dimmed: false, neighbor: false } };
      }

      // Confidence filter for answer nodes
      if (n.type === 'answer' && modeDef.minConfidence > 0) {
        const conf = (payload as AnswerPayload)?.confidence ?? 0;
        if (conf < modeDef.minConfidence) {
          return { ...n, hidden: true, data: { ...n.data, mode, dimmed: false, neighbor: false } };
        }
      }

      // Focus / dimming state
      let dimmed   = false;
      let neighbor = false;

      // Only apply dimming in Focus mode (or Advanced with selection)
      if (hasSelection && (mode === 'focus' || mode === 'advanced')) {
        if (n.id === selectedNodeId)   { /* selected — no class */ }
        else if (neighborIds.has(n.id)) { neighbor = true; }
        else                            { dimmed   = true; }
      }

      return {
        ...n,
        hidden:   false,
        selected: n.id === selectedNodeId,
        data:     { ...n.data, mode, dimmed, neighbor },
      };
    });
  }, [nodes, graphNodes, selectedNodeId, neighborIds, modeDef, mode, hasSelection]);

  // ── Build computed edges ────────────────────────────────────────────────────

  const computedEdges: Edge[] = useMemo(() => {
    const visibleIds = new Set(computedNodes.filter(n => !n.hidden).map(n => n.id));

    return edges.map(e => {
      const edgeType = e.data?.edgeType as EdgeType;

      // Edge type filter
      if (!modeDef.edgeTypes.has(edgeType)) return { ...e, hidden: true };
      // Both endpoints must be visible
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return { ...e, hidden: true };

      const isFocused  = hasSelection && (e.source === selectedNodeId || e.target === selectedNodeId);
      const isDimmedE  = hasSelection && !isFocused && (mode === 'focus' || mode === 'advanced');

      // Edge label: only in advanced mode, and only when not dimmed
      const showLabel = modeDef.showEdgeLabels && !isDimmedE;

      return {
        ...e,
        hidden: false,
        label:          showLabel ? edgeShortLabel(edgeType) : undefined,
        labelStyle:     showLabel ? EDGE_LABEL_STYLE     : undefined,
        labelBgStyle:   showLabel ? EDGE_LABEL_BG_STYLE  : undefined,
        labelBgPadding: showLabel ? [3, 6] as [number, number] : undefined,
        labelBgBorderRadius: showLabel ? 4 : undefined,
        style: isFocused
          ? getFocusedEdgeStyle(edgeType)
          : isDimmedE
            ? { ...getBaseEdgeStyle(edgeType), strokeOpacity: 0.04 }
            : getBaseEdgeStyle(edgeType),
        markerEnd: {
          type:   'arrowclosed' as any,
          color:  isFocused ? EDGE_COLORS[edgeType] || '#52525b' : 'var(--surface-hover)',
          width:  isFocused ? 10 : 7,
          height: isFocused ? 10 : 7,
        },
      };
    });
  }, [edges, computedNodes, selectedNodeId, modeDef, mode, hasSelection]);

  // ── Selection state ─────────────────────────────────────────────────────────

  const selectedNode     = selectedNodeId ? graphNodes[selectedNodeId] ?? null : null;
  const linkedEdgesCount = useMemo(() => {
    if (!selectedNodeId) return { incoming: 0, outgoing: 0 };
    const list = Object.values(graphEdges);
    return {
      incoming: list.filter(e => e.to   === selectedNodeId).length,
      outgoing: list.filter(e => e.from === selectedNodeId).length,
    };
  }, [selectedNodeId, graphEdges]);

  // ── Event handlers ──────────────────────────────────────────────────────────

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  function switchMode(m: DisplayMode) {
    setMode(m);
    setSelectedNodeId(null);
    setTimeout(() => fitView({ padding: 0.18, duration: 500 }), 80);
  }

  function resetLayout() {
    const { nodes: fresh } = buildReactFlowElements(graphNodes, graphEdges);
    setNodes(fresh);
    setSelectedNodeId(null);
    setTimeout(() => fitView({ padding: 0.18, duration: 500 }), 80);
  }

  // ── Empty guard ─────────────────────────────────────────────────────────────

  if (Object.keys(graphNodes).length === 0) {
    return (
      <div className="de-tab-panel active panel-graph" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          title="No graph data yet"
          description="Use autofill on a job application to build your graph, or import data from another browser using the Import button above."
        />
      </div>
    );
  }

  const focusModeNoSelection = mode === 'focus' && !hasSelection;

  return (
    <div className="de-tab-panel active panel-graph">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="graph-toolbar">

        {/* Mode segmented control */}
        <div className="mode-switch">
          {(Object.entries(MODES) as [DisplayMode, ModeDefinition][]).map(([id, def]) => (
            <button
              key={id}
              className={`mode-switch-btn ${mode === id ? 'active' : ''}`}
              onClick={() => switchMode(id)}
              title={def.description}
            >
              {def.icon}
              {def.label}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        {/* Legend / filter status — read-only in this version */}
        <GraphLegend mode={mode} typeCounts={typeCounts} />

        {/* Right controls */}
        <div className="graph-toolbar-section" style={{ marginLeft: 'auto', gap: 4 }}>
          {hasSelection && (
            <button
              className="btn"
              onClick={() => setSelectedNodeId(null)}
              style={{ fontSize: 11, color: 'var(--text-faint)' }}
            >
              Clear focus
            </button>
          )}
          <button className="btn btn-icon" onClick={() => zoomOut()} title="Zoom out"><ZoomOut  size={13} /></button>
          <button className="btn btn-icon" onClick={() => zoomIn()}  title="Zoom in"> <ZoomIn   size={13} /></button>
          <button className="btn btn-icon" onClick={() => fitView({ padding: 0.18, duration: 400 })} title="Fit"><Maximize2 size={13} /></button>
          <button className="btn" onClick={resetLayout} style={{ gap: 5 }}>
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      <div className="graph-canvas-wrap">

        {/* Advanced mode badge */}
        {mode === 'advanced' && (
          <div className="graph-mode-badge">
            Advanced
          </div>
        )}

        {/* Focus mode: no-selection prompt */}
        {focusModeNoSelection && (
          <div className="graph-focus-overlay">
            <div className="graph-focus-overlay-inner">
              <Focus size={18} style={{ opacity: 0.5 }} />
              <span>Click any node to focus its neighborhood</span>
            </div>
          </div>
        )}

        {/* Overview: hint */}
        {mode === 'overview' && !hasSelection && (
          <div className="graph-focus-hint">
            Click a node to inspect it
          </div>
        )}

        <ReactFlow
          nodes={computedNodes}
          edges={computedEdges}
          nodeTypes={nodeTypes as NodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.06}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ animated: false }}
          // Edge labels need their own container in RF — don't suppress globally
          elevateEdgesOnSelect
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1}
            color="var(--surface-2)"
          />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={n => `var(--node-${n.type}, #52525b)`}
            maskColor="rgba(9,9,11,0.8)"
            style={{ opacity: 0.7 }}
          />
        </ReactFlow>

        <NodeInspector
          node={selectedNode}
          linkedEdgesCount={linkedEdgesCount}
          onClose={() => setSelectedNodeId(null)}
        />
      </div>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export function RelationshipsTab({ graphNodes, graphEdges }: { graphNodes: Record<string, GraphNode>; graphEdges: Record<string, GraphEdge> }) {
  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildReactFlowElements(graphNodes, graphEdges),
    [graphNodes, graphEdges]
  );

  return (
    <ReactFlowProvider>
      <RelationshipsInner
        initialNodes={initNodes}
        initialEdges={initEdges}
        graphNodes={graphNodes}
        graphEdges={graphEdges}
      />
    </ReactFlowProvider>
  );
}
