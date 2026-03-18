import React, { useState, useEffect, useCallback } from 'react';
import { Database, User, Brain, TrendingUp, Share2 } from 'lucide-react';
import { Header, type TabId } from './components/Header';
import { ProfileTab } from './components/ProfileTab';
import { GraphMemoryTab } from './components/GraphMemoryTab';
import { RLPatternsTab } from './components/RLPatternsTab';
import { RelationshipsTab } from './components/RelationshipsTab';
import type { UserProfile } from '../shared/profile';
import type { GraphNode, GraphEdge } from '../shared/graph/types';
import type { LearnedPattern, CorrectionEvent } from '../shared/learning-types';

// ── Storage keys ──────────────────────────────────────────────────────────────
const STORAGE = {
  profile:      'userProfile',
  graphNodes:   'graph_nodes',
  graphEdges:   'graph_edges',
  graphMeta:    'graph_meta',
  rlPatterns:   'rl_learned_patterns',
  rlCorrections:'rl_correction_events',
} as const;

// ── App data shape ────────────────────────────────────────────────────────────
interface AppData {
  profile:     UserProfile | null;
  graphNodes:  Record<string, GraphNode>;
  graphEdges:  Record<string, GraphEdge>;
  patterns:    LearnedPattern[];
  corrections: CorrectionEvent[];
}

// ── Import modal ──────────────────────────────────────────────────────────────
interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

function ImportModal({ onClose, onImported }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [opts, setOpts] = useState({ graph: true, rl: true, profile: true });
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  function handleFile(f: File) {
    if (!f.name.endsWith('.json')) { showToast('Please select a .json file', 'error'); return; }
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => setFileData(e.target?.result as string ?? null);
    reader.readAsText(f);
  }

  async function confirm() {
    if (!fileData) return;
    let parsed: any;
    try { parsed = JSON.parse(fileData); } catch { showToast('Invalid JSON', 'error'); return; }
    if (!parsed.version || !parsed.exportedAt) { showToast('Not a valid Offlyn export file', 'error'); return; }

    const writes: Record<string, unknown> = {};
    if (opts.graph && parsed.graph) {
      if (parsed.graph.nodes) writes[STORAGE.graphNodes] = parsed.graph.nodes;
      if (parsed.graph.edges) writes[STORAGE.graphEdges] = parsed.graph.edges;
      if (parsed.graph.meta)  writes[STORAGE.graphMeta]  = parsed.graph.meta;
    }
    if (opts.rl && parsed.rl) {
      if (parsed.rl.patterns)    writes[STORAGE.rlPatterns]    = parsed.rl.patterns;
      if (parsed.rl.corrections) writes[STORAGE.rlCorrections] = parsed.rl.corrections;
    }
    if (opts.profile && parsed.profile) {
      writes[STORAGE.profile] = parsed.profile;
    }

    if (!Object.keys(writes).length) { showToast('Nothing to import', 'error'); return; }

    setImporting(true);
    try {
      await browser.storage.local.set(writes);
      showToast('✓ Import successful — refreshing…', 'success');
      onImported();
      onClose();
    } catch (err) {
      showToast('Import failed: ' + String(err), 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <Database size={16} style={{ color: 'var(--accent)' }} />
          <span className="modal-title">Import Data</span>
        </div>
        <div className="modal-body">
          <p className="modal-desc">
            Import a previously exported Offlyn JSON file to restore your graph, profile, and RL patterns.
          </p>

          <div className="modal-opts">
            {(['graph', 'rl', 'profile'] as const).map(key => (
              <label key={key} className="modal-opt">
                <input
                  type="checkbox"
                  checked={opts[key]}
                  onChange={e => setOpts(o => ({ ...o, [key]: e.target.checked }))}
                />
                <div>
                  <div className="modal-opt-title">
                    {key === 'graph' ? 'Graph Memory' : key === 'rl' ? 'RL Patterns' : 'Profile'}
                  </div>
                  <div className="modal-opt-desc">
                    {key === 'graph' ? 'Nodes + edges from your knowledge graph' :
                     key === 'rl'    ? 'Learned patterns + correction history' :
                                       'Personal profile from your resume'}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div
            className="drop-zone"
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files[0]; if (f) handleFile(f); }}
            onClick={() => document.getElementById('de-file-input')?.click()}
            style={dragging ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : {}}
          >
            <input
              id="de-file-input"
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="drop-zone-text">
              {file ? `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)` : 'Click to select or drag & drop a .json file'}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!fileData || importing}
            onClick={confirm}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast helper ──────────────────────────────────────────────────────────────

let _toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  let el = document.getElementById('de-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'de-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${type}`;
  // Force reflow
  void el.offsetHeight;
  el.classList.add('show');
  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => el!.classList.remove('show'), 2500);
}

// ── Export helpers ────────────────────────────────────────────────────────────

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function csvRow(...cells: unknown[]): string {
  return cells.map(c => {
    const s = String(c ?? '').replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',');
}

async function exportJSON() {
  const stored = await browser.storage.local.get([
    STORAGE.profile, STORAGE.graphNodes, STORAGE.graphEdges,
    STORAGE.graphMeta, STORAGE.rlPatterns, STORAGE.rlCorrections,
  ]);
  const payload = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    profile: stored[STORAGE.profile] ?? null,
    graph: {
      nodes: stored[STORAGE.graphNodes] ?? {},
      edges: stored[STORAGE.graphEdges] ?? {},
      meta:  stored[STORAGE.graphMeta]  ?? {},
    },
    rl: {
      patterns:    stored[STORAGE.rlPatterns]    ?? [],
      corrections: stored[STORAGE.rlCorrections] ?? [],
    },
  };
  downloadFile(JSON.stringify(payload, null, 2), `offlyn-data-${datestamp()}.json`, 'application/json');
  showToast('✓ Full export downloaded', 'success');
}

async function exportAnswersCSV() {
  const stored = await browser.storage.local.get(STORAGE.graphNodes);
  const nodes = Object.values((stored[STORAGE.graphNodes] ?? {}) as Record<string, GraphNode>);
  if (!nodes.length) { showToast('No graph data to export', 'error'); return; }

  const header = csvRow('id', 'type', 'value/label', 'source', 'confidence', 'usageCount', 'createdAt');
  const rows = nodes.map(n => {
    const p = n.payload as any;
    return csvRow(
      n.id, n.type,
      p.value ?? p.normalizedText ?? p.canonicalField ?? p.company ?? p.correctedValue ?? '',
      p.source ?? '',
      p.confidence ?? '',
      p.usageCount ?? '',
      new Date(n.createdAt).toISOString(),
    );
  });
  downloadFile([header, ...rows].join('\n'), `offlyn-graph-nodes-${datestamp()}.csv`, 'text/csv');
  showToast(`✓ ${nodes.length} nodes exported`, 'success');
}

async function exportPatternsCSV() {
  const stored = await browser.storage.local.get([STORAGE.rlPatterns, STORAGE.rlCorrections]);
  const patterns    = (stored[STORAGE.rlPatterns]    ?? []) as LearnedPattern[];
  const corrections = (stored[STORAGE.rlCorrections] ?? []) as CorrectionEvent[];

  if (!patterns.length && !corrections.length) { showToast('No RL data to export', 'error'); return; }

  const pHeader = csvRow('id', 'fieldType', 'fieldLabel', 'learnedValue', 'originalValue', 'confidence', 'successCount', 'failureCount', 'lastUsed');
  const pRows = patterns.map(p => csvRow(p.id, p.fieldType, p.fieldLabel, p.learnedValue, p.originalValue, p.confidence, p.successCount, p.failureCount, new Date(p.lastUsed).toISOString()));
  const cHeader = csvRow('id', 'fieldType', 'autoFilledValue', 'userCorrectedValue', 'timestamp', 'company');
  const cRows = corrections.map(c => csvRow(c.id, c.fieldType, c.autoFilledValue, c.userCorrectedValue, new Date(c.timestamp).toISOString(), c.context?.company ?? ''));

  downloadFile(
    ['# RL LEARNED PATTERNS', pHeader, ...pRows, '', '# RL CORRECTION EVENTS', cHeader, ...cRows].join('\n'),
    `offlyn-rl-patterns-${datestamp()}.csv`,
    'text/csv'
  );
  showToast(`✓ ${patterns.length} patterns + ${corrections.length} corrections exported`, 'success');
}

// ── Main App ─────────────────────────────────────────────────────────────────

export function DataExplorer() {
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [data, setData] = useState<AppData>({
    profile: null,
    graphNodes: {},
    graphEdges: {},
    patterns: [],
    corrections: [],
  });
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const stored = await browser.storage.local.get([
        STORAGE.profile, STORAGE.graphNodes, STORAGE.graphEdges,
        STORAGE.rlPatterns, STORAGE.rlCorrections,
      ]);
      setData({
        profile:     stored[STORAGE.profile]       ?? null,
        graphNodes:  stored[STORAGE.graphNodes]     ?? {},
        graphEdges:  stored[STORAGE.graphEdges]     ?? {},
        patterns:    stored[STORAGE.rlPatterns]     ?? [],
        corrections: stored[STORAGE.rlCorrections]  ?? [],
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const nodeCount      = Object.keys(data.graphNodes).length;
  const edgeCount      = Object.keys(data.graphEdges).length;
  const patternCount   = data.patterns.length;
  const correctionCount = data.corrections.length;

  const tabs = [
    { id: 'profile'       as TabId, label: 'Profile',       icon: <User size={13} />,     count: data.profile ? undefined : 0 },
    { id: 'graph'         as TabId, label: 'Graph Memory',  icon: <Brain size={13} />,    count: nodeCount > 0 ? nodeCount : undefined },
    { id: 'rl'            as TabId, label: 'RL Patterns',   icon: <TrendingUp size={13} />, count: patternCount > 0 ? patternCount : undefined },
    { id: 'relationships' as TabId, label: 'Relationships', icon: <Share2 size={13} />,   count: edgeCount > 0 ? edgeCount : undefined },
  ];

  function handleExport(format: 'json' | 'csv-answers' | 'csv-patterns') {
    if (format === 'json')         exportJSON();
    else if (format === 'csv-answers')  exportAnswersCSV();
    else if (format === 'csv-patterns') exportPatternsCSV();
  }

  return (
    <div className="de-shell">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={tabs}
        onRefresh={loadData}
        onExport={handleExport}
        onImport={() => setShowImport(true)}
        isRefreshing={loading}
      />

      <div className="de-content">
        {/* Profile */}
        <div className={`de-tab-panel ${activeTab === 'profile' ? 'active' : ''}`} style={{ overflow: 'hidden auto', padding: 0 }}>
          {activeTab === 'profile' && <ProfileTab profile={data.profile} />}
        </div>

        {/* Graph Memory */}
        <div className={`de-tab-panel ${activeTab === 'graph' ? 'active' : ''}`} style={{ overflow: 'hidden auto', padding: 0 }}>
          {activeTab === 'graph' && (
            <GraphMemoryTab graphNodes={data.graphNodes} graphEdges={data.graphEdges} />
          )}
        </div>

        {/* RL Patterns */}
        <div className={`de-tab-panel ${activeTab === 'rl' ? 'active' : ''}`} style={{ overflow: 'hidden auto', padding: 0 }}>
          {activeTab === 'rl' && (
            <RLPatternsTab patterns={data.patterns} corrections={data.corrections} />
          )}
        </div>

        {/* Relationships graph */}
        <div className={`de-tab-panel panel-graph ${activeTab === 'relationships' ? 'active' : ''}`} style={{ padding: 0 }}>
          {activeTab === 'relationships' && (
            <RelationshipsTab graphNodes={data.graphNodes} graphEdges={data.graphEdges} />
          )}
        </div>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={loadData}
        />
      )}
    </div>
  );
}
