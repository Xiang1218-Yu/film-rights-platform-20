import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type EntitySummary =
  | { kind: 'budget'; budgetVersion: string; planned: number; forecast: number; variancePct: number; highRiskCount: number; highRiskLines: { subcategory: string; overrunPct: number }[] }
  | { kind: 'asset'; assetId: string; name: string; type: string; version: number; status: string; owner: string; checksum: string; territories: string[]; availableFrom: string; availableTo: string; rightsTags: string[] }
  | { kind: 'delivery'; packageId: string; deliveryDate: string };
type Blocker = { code: string; severity: 'critical' | 'warning'; message: string };
type QueueItem = { id: string; projectId: string; projectCode: string; projectTitle: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; approver: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; updatedAt?: string; comment?: string; blockers: Blocker[]; entitySummary?: EntitySummary };
type BatchOutcome = 'approved' | 'rejected' | 'skipped_blocked' | 'skipped_stale' | 'skipped_duplicate' | 'not_found';
type BatchResult = { approvalId: string; projectId: string; entityType: string; title: string; outcome: BatchOutcome; blockers: Blocker[]; at?: string };
type BatchCounts = { total: number; approved: number; rejected: number; blocked: number; stale: number; duplicate: number; notFound: number };
type BatchRecord = { key: string; decision: 'approve' | 'reject'; override: boolean; comment: string; status: 'running' | 'completed'; requestedAt: string; finishedAt?: string; results: BatchResult[]; counts: BatchCounts };
type PreviewItem = Omit<QueueItem, 'id'> & { id?: string; approvalId: string; outcome?: 'not_found'; blockers: Blocker[] };
type Project = { id: string; title: string; status: string; deliveryDate: string };
type Summary = { planned: number; forecast: number; actual: number; variance: number; utilization: number; committed: number; contractExposure: number; assetCount: number; pendingApprovals: number; highRiskLines: { subcategory: string; forecast: number; planned: number }[]; lines: { id: string; category: string; subcategory: string; planned: number; forecast: number; actual: number; risk: string }[]; contracts: { vendor: string; scope: string; committed: number; paid: number; milestones: { name: string; due: string; status: string }[] }[]; assets: { id: string; name: string; type: string; version: number; status: string; availableTo: string }[]; approvals: { id: string; title: string; status: string; approver: string }[]; project: Project };
type Conflict = { severity: string; assetA: string; assetB: string; reason: string };

const money = (n: number) => `¥${(n / 10000).toFixed(0)}万`;
const api = '/api';
const SELECTION_KEY = 'frameledger.batchSelection.v1';
const PENDING_KEY = 'frameledger.pendingBatches.v1';
const TYPE_LABEL: Record<string, string> = { budget: '预算', asset: '资产', delivery: '交付' };

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${api}${path}`, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({} as T));
    if (!response.ok && response.status !== 202) throw new Error((body as { message?: string }).message || `请求失败 (${response.status})`);
    return { status: response.status, body: body as T };
  } finally { clearTimeout(timer); }
}
async function jsonRequest<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const { body } = await request<T>(path, init, timeoutMs);
  return body;
}
function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

const OUTCOME_LABEL: Record<BatchOutcome, string> = {
  approved: '已通过', rejected: '已驳回', skipped_blocked: '阻断跳过', skipped_stale: '已过期跳过', skipped_duplicate: '重复项跳过', not_found: '申请不存在',
};
const outcomeClass = (outcome: BatchOutcome) => outcome === 'approved' || outcome === 'rejected' ? `result-${outcome}` : 'result-skipped';

function EntitySummaryView({ entity }: { entity?: EntitySummary }) {
  if (!entity) return <small className="summary-empty">实体台账暂不可用，请核对申请单</small>;
  if (entity.kind === 'budget') return (
    <div className="entity-summary">
      <small>预算版本 {entity.budgetVersion} · 高风险科目 {entity.highRiskCount}</small>
      <span>{money(entity.planned)} → <b className={entity.variancePct > 0 ? 'bad' : ''}>{money(entity.forecast)}</b><em>（偏差 {entity.variancePct}%）</em></span>
      {entity.highRiskLines.length > 0 && <small>{entity.highRiskLines.map(line => `${line.subcategory} +${line.overrunPct}%`).join('；')}</small>}
    </div>);
  if (entity.kind === 'asset') return (
    <div className="entity-summary">
      <small>{entity.type} · v{entity.version} · {entity.status} · {entity.owner}</small>
      <span>{entity.territories.join('、')} · {entity.availableFrom} ~ {entity.availableTo}</span>
      <small>{entity.rightsTags.join('、')} · <code>{entity.checksum}</code></small>
    </div>);
  return <div className="entity-summary"><small>交付包 {entity.packageId} · 计划交付 {entity.deliveryDate}</small></div>;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkedIds, setCheckedIds] = useState<string[]>(() => readStorage(SELECTION_KEY, []));
  const [batchOpen, setBatchOpen] = useState(false);
  const [recoveredKey, setRecoveredKey] = useState('');
  const [recoverNote, setRecoverNote] = useState('');
  const reloadVersion = useRef(0);

  const load = useCallback(async (id = 'PRJ-001') => {
    setLoading(true); setError('');
    try {
      const items = await jsonRequest<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c, q] = await Promise.all([
        jsonRequest<Summary>(`/projects/${active.id}/summary`),
        jsonRequest<Conflict[]>(`/projects/${active.id}/rights-conflicts`),
        jsonRequest<QueueItem[]>('/approvals/queue'),
      ]);
      setProjects(items); setSelected(active.id); setSummary(s); setConflicts(c); setQueue(q);
      // 选择集与台账对账：已处理/消失的项自动移除，保证计数和待办一致
      setCheckedIds(prev => prev.filter(pid => q.some(row => row.id === pid && row.status === 'pending')));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接制作服务');
    } finally { setLoading(false); }
  }, []);

  // 启动时恢复刷新前在途/刚完成的批次（凭 localStorage 中的幂等键向服务端索回逐项结果）
  useEffect(() => {
    const pending = readStorage<{ key: string; ids: string[]; at: string }[]>(PENDING_KEY, []);
    if (!pending.length) return;
    let cancelled = false;
    Promise.all(pending.map(async entry => {
      try {
        const { status, body } = await request<BatchRecord>(`/approvals/batch/${entry.key}`, undefined, 6000);
        if (cancelled) return;
        if (body.status === 'completed') {
          setRecoverNote(`已恢复批次 ${entry.key.slice(0, 12)}… 的结果：通过 ${body.counts.approved} · 驳回 ${body.counts.rejected} · 阻断 ${body.counts.blocked} · 过期 ${body.counts.stale}`);
          setRecoveredKey(entry.key);
          const rest = pending.filter(p => p.key !== entry.key);
          localStorage.setItem(PENDING_KEY, JSON.stringify(rest));
        } else if (status === 202) {
          setRecoverNote(`有一个批次仍在处理中（${entry.key.slice(0, 12)}…），可在审批队列中继续查看`);
          setRecoveredKey(entry.key);
        }
      } catch { /* 服务重启导致批次丢失：清掉本地记录，稍后按当前状态重试 */ }
    })).then(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem(SELECTION_KEY, JSON.stringify(checkedIds)); }, [checkedIds]);

  const pendingQueue = useMemo(() => queue.filter(item => item.status === 'pending'), [queue]);
  const selectedItems = useMemo(() => checkedIds.map(id => pendingQueue.find(item => item.id === id)).filter((item): item is QueueItem => Boolean(item)), [checkedIds, pendingQueue]);
  const selectedBlockedCount = selectedItems.filter(item => item.blockers.length > 0).length;
  const crossProjectPending = pendingQueue.length;
  const pendingByProject = useMemo(() => {
    const groups = new Map<string, QueueItem[]>();
    for (const item of pendingQueue) groups.set(item.projectId, [...(groups.get(item.projectId) ?? []), item]);
    return groups;
  }, [pendingQueue]);

  const toggle = (id: string) => setCheckedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  const toggleProject = (items: QueueItem[]) => {
    const ids = items.map(item => item.id);
    const allOn = ids.every(id => checkedIds.includes(id));
    setCheckedIds(prev => allOn ? prev.filter(id => !ids.includes(id)) : Array.from(new Set(prev.concat(ids))));
  };
  const approveOne = async (id: string) => {
    try {
      await jsonRequest(`/approvals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', comment: '在控制台完成复核' }) });
      setMessage('审批已通过，审计事件已写入');
      setCheckedIds(prev => prev.filter(item => item !== id));
      await load(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审批操作失败'); }
  };

  const variancePct = summary ? Math.round(summary.variance / summary.planned * 100) : 0;
  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{error || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端 5173 和 API 4104 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  return <main><header><div><div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div><h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1><p>将预算承诺、供应商付款、资产版本与跨地域版权窗口串成可审计的交付链路。</p></div><div className="header-actions"><select value={selected} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select><span className="live"><i /> LIVE CONTROL</span></div></header>
    {message && <div className="toast" onClick={() => setMessage('')}>{message} ×</div>}
    {error && <div className="toast error-toast" onClick={() => setError('')}>{error} ×</div>}
    {recoverNote && <div className="toast recover-toast" onClick={() => { setRecoverNote(''); setRecoveredKey(''); }}>↻ {recoverNote}（点击关闭） ×</div>}

    <section className="kpis"><div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div><div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>已锁定供应商与合同</span></div><div><small>ASSET REGISTER</small><b>{summary.assetCount}<em> 个</em></b><span>版本与交付状态纳管</span></div><div><small>RISK QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{conflicts.length} 条版权冲突 / {crossProjectPending} 个待办（跨项目）</span></div></section>
    <nav className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button><button className={tab === 'budget' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button><button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>资产版权图谱</button><span>交付日 {summary.project.deliveryDate}</span></nav>

    {tab === 'overview' && <div className="grid"><section className="panel hero"><div className="panel-head"><div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div><span className="badge amber">{summary.project.status.toUpperCase()}</span></div><div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div><div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div><div className="split"><div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div><div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div><div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div></div></section>

      <section className="panel wide queue-panel">
        <div className="panel-head"><h3>跨项目待审批队列</h3><span>{crossProjectPending} PENDING · {projects.length} 个项目 · 勾选后批量处理</span></div>
        {pendingQueue.length === 0 && <div className="empty">所有申请均已处理，无待办项。</div>}
        {[...pendingByProject.entries()].map(([projectId, items]) => {
          const project = items[0];
          return <div className="queue-group" key={projectId}>
            <label className="project-toggle"><input type="checkbox" checked={items.every(item => checkedIds.includes(item.id))} onChange={() => toggleProject(items)} /><b>{project.projectTitle}</b><small>{project.projectCode} · {items.length} 项待办</small></label>
            {items.map(item => <label className={`approval queue-row ${checkedIds.includes(item.id) ? 'selected' : ''}`} key={item.id}>
              <input type="checkbox" checked={checkedIds.includes(item.id)} onChange={() => toggle(item.id)} />
              <span className={`status ${item.status}`} />
              <div className="queue-main"><b>{item.title}</b><small>{TYPE_LABEL[item.entityType]} · {item.entityId} · {item.approver} 提审 · {item.id}</small>
                <EntitySummaryView entity={item.entitySummary} />
                {item.blockers.length > 0 && <div className="blockers">{item.blockers.map(blocker => <span key={blocker.code} className={`blocker ${blocker.severity}`}>⛔ {blocker.message}</span>)}</div>}
              </div>
              <button onClick={event => { event.preventDefault(); void approveOne(item.id); }}>单项通过</button>
            </label>)}
          </div>;
        })}
        {queue.filter(item => item.status !== 'pending').length > 0 && <div className="queue-done">最近已处理：{queue.filter(item => item.status !== 'pending').slice(0, 3).map(item => `${item.title}（${item.status === 'approved' ? '已通过' : '已驳回'}）`).join('；')}</div>}
      </section>

      <section className="panel wide"><div className="panel-head"><h3>交付风险雷达</h3><span>基于版本、授权窗口与预算预测 · 与待办计数同源刷新</span></div>{conflicts.length ? conflicts.map((c, i) => <div className="risk-row" key={i}><strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong><div><b>{c.assetA}</b><small>↔ {c.assetB} · {c.reason}</small></div></div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}</section>
    </div>}

    {tab === 'budget' && <div className="grid"><section className="panel wide"><div className="panel-head"><h3>预算版本 V3 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div><div className="table"><div className="tr th"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>{summary.lines.map(line => <div className="tr" key={line.id}><span><b>{line.category}</b><small>{line.subcategory}</small></span><span>{money(line.planned)}</span><span>{money(line.planned ? line.planned : 0)}</span><span>{money(line.actual)}</span><span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span><span className={`risk ${line.risk}`}>{line.risk}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h3>供应商付款里程碑</h3></div>{summary.contracts.map(c => <div className="contract" key={c.vendor}><b>{c.vendor}</b><small>{c.scope}</small><div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div><span>{money(c.paid)} / {money(c.committed)}</span><em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点</em></div>)}</section></div>}

    {tab === 'rights' && <div className="grid"><section className="panel wide"><div className="panel-head"><h3>资产版本登记</h3><span>{summary.assets.length} assets / checksum tracked</span></div><div className="table"><div className="tr th"><span>资产</span><span>版本</span><span>状态</span><span>授权截止</span></div>{summary.assets.map(a => <div className="tr" key={a.id}><span><b>{a.name}</b><small>{a.id} · {a.type}</small></span><span>v{a.version}</span><span className={`pill ${a.status}`}>{a.status}</span><span>{a.availableTo}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h3>授权冲突</h3><span>{conflicts.length} detected</span></div>{conflicts.map((c, i) => <div className="conflict" key={i}><strong>{c.severity}</strong><b>{c.assetA}</b><small>{c.reason}</small></div>)}</section></div>}

    {selectedItems.length > 0 && <div className="batch-bar">
      <div><b>已选 {selectedItems.length} 项</b><span>{new Set(selectedItems.map(item => item.projectId)).size} 个项目 · {selectedBlockedCount} 项含版权/预算阻断</span></div>
      <div className="batch-actions"><button onClick={() => { setCheckedIds([]); }}>清空</button><button className="primary" onClick={() => setBatchOpen(true)}>批量审批…</button></div>
    </div>}

    {batchOpen && <BatchDialog items={selectedItems} blockedCount={selectedBlockedCount} onClose={() => setBatchOpen(false)} onSettled={async () => { setBatchOpen(false); setCheckedIds([]); await load(selected); }} onError={setError} onRecovered={setRecoveredKey} recoveredKey={recoveredKey} />}
    <footer>FrameLedger baseline · 内存仓储 + REST API · 批量审批逐项独立审计，幂等键可恢复</footer></main>;
}

function BatchDialog(props: { items: QueueItem[]; blockedCount: number; onClose: () => void; onSettled: () => Promise<void> | void; onError: (msg: string) => void; onRecovered: (key: string) => void; recoveredKey: string }) {
  const { items, blockedCount } = props;
  const [phase, setPhase] = useState<'preview' | 'running' | 'done'>('preview');
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [override, setOverride] = useState(false);
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [record, setRecord] = useState<BatchRecord>();
  const [localError, setLocalError] = useState('');
  const idemKey = useMemo(() => `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, []);
  const overrideInvalid = override && !comment.trim();
  const cannotApprove = decision === 'approve' && blockedCount > 0 && !override;

  useEffect(() => {
    let cancelled = false;
    jsonRequest<{ items: PreviewItem[] }>('/approvals/batch/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: items.map(item => item.id) }) })
      .then(data => { if (!cancelled) setPreview(data.items); })
      .catch(reason => { if (!cancelled) setLocalError(reason instanceof Error ? reason.message : '批量预览失败'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [items]);

  const persistPending = useCallback((key: string) => {
    const list = readStorage<{ key: string; ids: string[]; at: string }[]>(PENDING_KEY, []);
    if (!list.some(entry => entry.key === key)) list.push({ key, ids: items.map(item => item.id), at: new Date().toISOString() });
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  }, [items]);
  const clearPending = useCallback((key: string) => {
    localStorage.setItem(PENDING_KEY, JSON.stringify(readStorage<{ key: string }[]>(PENDING_KEY, []).filter(entry => entry.key !== key)));
  }, []);

  const poll = useCallback(async (key: string): Promise<BatchRecord> => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 600));
      try {
        const { status, body } = await request<BatchRecord>(`/approvals/batch/${key}`, undefined, 6000);
        if (body.status === 'completed' || (status !== 202 && body.results)) return body;
      } catch { /* 网络抖动时继续轮询，批次由服务端幂等键保证不重复执行 */ }
    }
    throw new Error('批次仍在处理中，已保留幂等键，稍后将自动恢复');
  }, []);

  const submit = async () => {
    if (overrideInvalid) return;
    setLocalError(''); setPhase('running');
    const body = JSON.stringify({ idempotencyKey: idemKey, decision, ids: items.map(item => item.id), override, comment: comment.trim() });
    persistPending(idemKey);
    try {
      // 短超时模拟客户端等待：超时不放弃，转而用幂等键轮询（服务端绝不会重复执行同一批次）
      const { status: postStatus, body: batch } = await request<BatchRecord>('/approvals/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 8000);
      const finalRecord = postStatus === 202 || batch.status === 'running' ? await poll(idemKey) : batch;
      setRecord(finalRecord); setPhase('done'); clearPending(idemKey); props.onRecovered(idemKey);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : '批量请求失败，可稍后凭批次键恢复');
      setPhase('preview'); // 保留弹窗与选择，允许重试
    }
  };

  const retrySkipped = async () => {
    if (!record) return;
    const retryIds = record.results.filter(result => result.outcome === 'skipped_blocked').map(result => result.approvalId);
    if (!retryIds.length) { await props.onSettled(); return; }
    const key = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setPhase('running'); persistPending(key);
    try {
      const { body: batch } = await request<BatchRecord>('/approvals/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: key, decision: 'approve', ids: retryIds, override, comment: comment.trim() || '已逐项确认阻断并接受风险' }) }, 8000);
      const finalRecord = batch.status === 'running' ? await poll(key) : batch;
      setRecord(finalRecord); setPhase('done'); clearPending(key);
    } catch (reason) { setLocalError(reason instanceof Error ? reason.message : '重试失败'); setPhase('done'); }
  };

  return <div className="modal-backdrop" onClick={props.onClose}>
    <section className="modal" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><h2>{phase === 'done' ? '批量结果（逐项）' : phase === 'running' ? '正在执行批量审批' : '批量审批确认'}</h2><span>{items.length} 项 · 幂等键 <code>{idemKey.slice(0, 18)}…</code></span></div>

      {phase === 'preview' && <>
        <div className="decision-row">
          <label><input type="radio" name="decision" checked={decision === 'approve'} onChange={() => setDecision('approve')} /> 全部通过（safe approve）</label>
          <label><input type="radio" name="decision" checked={decision === 'reject'} onChange={() => setDecision('reject')} /> 全部驳回</label>
        </div>
        <div className="modal-list">
          {previewLoading ? <div className="empty">正在重新获取服务端实体摘要与阻断状态…</div> : preview.map(item =>
            item.outcome === 'not_found'
              ? <div className="batch-item missing" key={item.approvalId}><b>{item.approvalId}</b><span className="result-not_found">申请在服务端已不存在，执行时将记为 not_found</span></div>
              : <div className={`batch-item ${item.status !== 'pending' ? 'stale-preview' : ''}`} key={item.approvalId}>
                <div className="batch-item-head"><span className={`pill ${item.entityType}`}>{TYPE_LABEL[item.entityType]}</span><b>{item.title}</b><span className={`status ${item.status}`} /><small>{item.projectTitle} · {item.approver} · {item.id}</small></div>
                <EntitySummaryView entity={item.entitySummary} />
                <div className="blockers">{item.status !== 'pending' && <span className="blocker stale">当前状态已为 {item.status}，执行时将判定为过期并跳过</span>}
                  {item.blockers.map(blocker => <span key={blocker.code} className={`blocker ${blocker.severity}`}>⛔ {blocker.message}</span>)}</div>
              </div>)}
        </div>
        <label className="override-row"><input type="checkbox" checked={override} disabled={decision !== 'approve'} onChange={event => setOverride(event.target.checked)} /> 我已知悉版权/预算阻断，强制通过（{blockedCount} 项阻断将被覆盖，必须填写意见）</label>
        <textarea placeholder={override ? "强制覆盖审批意见（必填，会写入逐项审计）" : "审批意见（可选）"} value={comment} onChange={event => setComment(event.target.value)} rows={2} />
        {localError && <div className="modal-error">{localError}</div>}
        <div className="modal-foot"><span className="hint">{cannotApprove ? `⚠ ${blockedCount} 项被阻断：安全批量通过会跳过它们，可改用驳回或勾选强制覆盖` : '未执行项不会被标记为完成，结果逐项返回'}</span><div><button onClick={props.onClose}>取消</button><button className="primary" disabled={previewLoading || cannotApprove || overrideInvalid} onClick={() => void submit()}>{decision === 'approve' ? '批量通过' : '批量驳回'}</button></div></div>
      </>}

      {phase === 'running' && <div className="running-view"><div className="spinner" /><p>正在逐项提交并等待审计回执…请求超时会自动转为轮询，重复点击不会产生重复审批。</p><small>{items.map(item => item.title).join(' · ')}</small></div>}

      {phase === 'done' && record && <>
        <div className="result-summary">
          {record.counts.approved > 0 && <span className="chip ok">通过 {record.counts.approved}</span>}
          {record.counts.rejected > 0 && <span className="chip rejected">驳回 {record.counts.rejected}</span>}
          {record.counts.blocked > 0 && <span className="chip warn">阻断跳过 {record.counts.blocked}</span>}
          {record.counts.stale > 0 && <span className="chip warn">过期跳过 {record.counts.stale}</span>}
          {record.counts.duplicate > 0 && <span className="chip warn">重复 {record.counts.duplicate}</span>}
          {record.counts.notFound > 0 && <span className="chip danger">不存在 {record.counts.notFound}</span>}
        </div>
        <div className="modal-list">
          {record.results.map(result => <div className="batch-item result" key={`${result.approvalId}-${result.outcome}`}>
            <div className="batch-item-head"><b>{result.title}</b><small>{result.approvalId} · {result.projectId || '—'}</small><span className={`result-pill ${outcomeClass(result.outcome)}`}>{OUTCOME_LABEL[result.outcome]}</span></div>
            {result.blockers.length > 0 && <div className="blockers">{result.blockers.map(b => <span key={b.code} className={`blocker ${b.severity}`}>{b.message}</span>)}</div>}
            {result.at && <small>实际执行时间 {new Date(result.at).toLocaleTimeString()} · 已写独立审计</small>}
          </div>)}
        </div>
        <div className="modal-foot"><span className="hint">实际执行 {record.counts.approved + record.counts.rejected} 项 / 共 {record.counts.total} 项；跳过项保持 pending</span><div>
          {record.counts.blocked > 0 && <button onClick={() => void retrySkipped()}>仅重试阻断项（{record.counts.blocked}）</button>}
          <button className="primary" onClick={() => void props.onSettled()}>接受结果并刷新</button>
        </div></div>
      </>}
    </section>
  </div>;
}
