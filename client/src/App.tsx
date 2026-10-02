import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Project = { id: string; title: string; status: string; deliveryDate: string };
type Summary = {
  planned: number; forecast: number; actual: number; variance: number; utilization: number; committed: number;
  contractExposure: number; assetCount: number; pendingApprovals: number;
  highRiskLines: { subcategory: string; forecast: number; planned: number }[];
  lines: { id: string; category: string; subcategory: string; planned: number; forecast: number; actual: number; risk: string }[];
  contracts: { vendor: string; scope: string; committed: number; paid: number; milestones: { name: string; due: string; status: string }[] }[];
  assets: { id: string; name: string; type: string; version: number; status: string; availableTo: string }[];
  approvals: { id: string; title: string; status: string; approver: string }[];
  project: Project;
};
type Conflict = { severity: string; assetA: string; assetB: string; reason: string };
type Blocker = { code: string; severity: 'critical' | 'warning'; blocking: boolean; message: string };
type EntitySummary = { kind: 'budget' | 'asset' | 'delivery'; label: string; detail: Record<string, unknown> };
type Approval = { id: string; projectId: string; entityType: string; entityId: string; title: string; requestedBy: string; approver: string; status: string; createdAt: string; version: number };
type ApprovalView = { approval: Approval; projectId: string; projectTitle: string; entity: EntitySummary; blockers: Blocker[] };
type BatchItemStatus = 'queued' | 'approved' | 'rejected' | 'blocked' | 'stale' | 'busy' | 'failed';
type BatchItem = { approvalId: string; index: number; expectedVersion: number; status: BatchItemStatus; blockers?: Blocker[]; auditId?: string; beforeVersion?: number; afterVersion?: number; reason?: string; at?: string };
type Batch = { id: string; status: 'processing' | 'completed'; decision: 'approved' | 'rejected'; comment: string; items: BatchItem[]; executed: number; pending: number; recoverable: number; finishedAt?: string };

const money = (n: number) => `¥${(n / 10000).toFixed(0)}万`;
const api = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || `请求失败 (${response.status})`), { status: response.status, code: body.code });
  return body as T;
}

const ITEM_STATUS: Record<BatchItemStatus, { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'muted' },
  approved: { label: '已通过', tone: 'ok' },
  rejected: { label: '已驳回', tone: 'ok' },
  blocked: { label: '已阻断', tone: 'bad' },
  stale: { label: '状态过期', tone: 'warn' },
  busy: { label: '占用冲突', tone: 'warn' },
  failed: { label: '瞬时失败', tone: 'warn' },
};
const RECOVERABLE = new Set<BatchItemStatus>(['blocked', 'stale', 'busy', 'failed']);

type ModalState =
  | { phase: 'preview'; views: ApprovalView[]; idempotencyKey: string; comment: string }
  | { phase: 'running'; views: ApprovalView[]; idempotencyKey: string; comment: string; batch: Batch }
  | { phase: 'result'; views: ApprovalView[]; batch: Batch };

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState('PRJ-001');
  const [summary, setSummary] = useState<Summary>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [queue, setQueue] = useState<ApprovalView[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'overview' | 'budget' | 'rights'>('overview');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const modalRef = useRef(modal);
  modalRef.current = modal;

  const load = useCallback(async (id = 'PRJ-001') => {
    setLoading(true); setError('');
    try {
      const items = await request<Project[]>('/projects');
      const active = items.find(item => item.id === id) ?? items[0];
      if (!active) throw new Error('服务端没有返回项目数据');
      const [s, c, q] = await Promise.all([
        request<Summary>(`/projects/${active.id}/summary`),
        request<Conflict[]>(`/projects/${active.id}/rights-conflicts`),
        request<ApprovalView[]>('/approvals/pending'),
      ]);
      setProjects(items); setSelected(active.id); setSummary(s); setConflicts(c); setQueue(q);
      // 选择集自动剔除已不在待办中的申请（跨项目切换也保留有效选择）
      setPicked(prev => new Set([...prev].filter(pid => q.some(view => view.approval.id === pid))));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接制作服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reloadQueue = useCallback(async () => {
    const q = await request<ApprovalView[]>('/approvals/pending');
    setQueue(q);
    return q;
  }, []);

  // 单项通过：带版本号，处理中/被他人先处理时 409，不重复写审计
  const approveOne = async (view: ApprovalView) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request(`/approvals/${view.approval.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', comment: '在控制台完成复核', expectedVersion: view.approval.version }),
      });
      setPicked(prev => { const next = new Set(prev); next.delete(view.approval.id); return next; });
      setMessage('审批已通过，审计事件已写入');
      await load(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审批操作失败');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openBatch = async () => {
    if (!picked.size || busy) return;
    setBusy(true); setError('');
    try {
      // 打开预览即向服务端取最新实体摘要/阻断/版本（本地勾选不作数）
      const { items } = await request<{ items: ApprovalView[] }>('/approvals/batch/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...picked] }),
      });
      setModal({ phase: 'preview', views: items, idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, comment: '批量审批复核通过' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法生成批量预览');
    } finally {
      setBusy(false);
    }
  };

  // 8s 客户端超时后用同一幂等键重试一次（服务端返回同一批次，绝不重复执行）
  const postBatchOnce = (decision: 'approved' | 'rejected', views: ApprovalView[], key: string, comment: string, attempt = 0): Promise<Batch> =>
    new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      fetch(`${api}/approvals/batch`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ decision, comment, items: views.map(view => ({ approvalId: view.approval.id, expectedVersion: view.approval.version })) }),
      }).then(async response => {
        clearTimeout(timer);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) reject(Object.assign(new Error(body.message || `请求失败 (${response.status})`), { code: body.code }));
        else resolve(body as Batch);
      }).catch(err => {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError' && attempt === 0) {
          setError('提交超时，正在用同一凭据安全重试…');
          resolve(postBatchOnce(decision, views, key, comment, attempt + 1));
        } else reject(err instanceof Error ? err : new Error('批量提交失败'));
      });
    });

  const pollBatch = async (id: string): Promise<Batch> => {
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 400));
      const current = modalRef.current;
      if (!current) break;
      const batch = await request<Batch>(`/approvals/batch/${id}`);
      setModal({ ...current, phase: 'running', batch } as ModalState);
      if (batch.status === 'completed') return batch;
    }
    throw new Error('批次处理超时，请稍后刷新结果（已执行项不会重复）');
  };

  const submitBatch = async (decision: 'approved' | 'rejected') => {
    if (!modal || modal.phase !== 'preview' || busy) return;
    setBusy(true); setError('');
    try {
      const batch = await postBatchOnce(decision, modal.views, modal.idempotencyKey, modal.comment);
      setModal({ phase: 'running', views: modal.views, idempotencyKey: modal.idempotencyKey, comment: modal.comment, batch });
      const completed = await pollBatch(batch.id);
      setModal({ phase: 'result', views: modal.views, batch: completed });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批量提交失败');
    } finally {
      setBusy(false);
    }
  };

  // 接受逐项结果：先刷新拿最新版本，只重试未执行项（已通过/驳回原样保留）
  const resumeUnfinished = async () => {
    if (!modal || modal.phase !== 'result' || busy) return;
    setBusy(true); setError('');
    try {
      const fresh = await reloadQueue();
      const versions: Record<string, number> = {};
      for (const item of modal.batch.items) {
        if (!RECOVERABLE.has(item.status)) continue;
        const view = fresh.find(v => v.approval.id === item.approvalId);
        if (view) versions[item.approvalId] = view.approval.version;
      }
      const batch = await request<Batch>(`/approvals/batch/${modal.batch.id}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versions }),
      });
      setModal({ phase: 'running', views: modal.views, idempotencyKey: `idem-${Date.now()}`, comment: modal.batch.comment, batch });
      const completed = await pollBatch(batch.id);
      setModal({ phase: 'result', views: modal.views, batch: completed });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复重试失败');
    } finally {
      setBusy(false);
    }
  };

  const closeModal = async (andRefresh: boolean) => {
    setModal(null);
    setPicked(new Set());
    if (andRefresh) await load(selected);
  };

  const variancePct = useMemo(() => summary ? Math.round(summary.variance / summary.planned * 100) : 0, [summary]);
  const groupedQueue = useMemo(() => {
    const groups = new Map<string, ApprovalView[]>();
    for (const view of queue) { const list = groups.get(view.projectTitle) ?? []; list.push(view); groups.set(view.projectTitle, list); }
    return [...groups.entries()];
  }, [queue]);
  const pickedProjects = useMemo(() => new Set(queue.filter(v => picked.has(v.approval.id)).map(v => v.projectTitle)).size, [queue, picked]);

  if (loading && !summary) return <main className="connection-state"><div className="loading">正在载入制作控制台…</div><small>正在通过 Vite API 代理连接本地制作服务</small></main>;
  if (!summary) return <main className="connection-state"><h2>无法连接制作服务</h2><p>{error || '服务端没有返回项目数据。'}</p><p>请从项目根目录运行 <code>npm run dev</code>，确认前端和 API 4104 均已启动。</p><button onClick={() => void load(selected)}>重新连接</button></main>;

  return <main>
    <header>
      <div>
        <div className="eyebrow">STUDIO OPS / RIGHTS & FINANCE CONTROL</div>
        <h1>FrameLedger <span>影视制作预算与资产版权协同</span></h1>
        <p>将预算承诺、供应商付款、资产版本与跨地域版权窗口串成可审计的交付链路。</p>
      </div>
      <div className="header-actions">
        <select value={selected} onChange={e => { setSelected(e.target.value); void load(e.target.value); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <span className="live"><i /> LIVE CONTROL</span>
      </div>
    </header>
    {message && <div className="toast" onClick={() => setMessage('')}>{message} ×</div>}
    {error && <div className="toast error-toast" onClick={() => setError('')}>{error} ×</div>}

    <section className="kpis">
      <div><small>FORECAST COST</small><b>{money(summary.forecast)}</b><span>预算偏差 <em className={summary.variance > 0 ? 'bad' : ''}>{variancePct}%</em></span></div>
      <div><small>COMMITTED</small><b>{money(summary.committed)}</b><span>已锁定供应商与合同</span></div>
      <div><small>ASSET REGISTER</small><b>{summary.assetCount}<em> 个</em></b><span>版本与交付状态纳管</span></div>
      <div><small>RISK QUEUE</small><b>{summary.pendingApprovals + conflicts.length}<em> 项</em></b><span>{conflicts.length} 条版权冲突 / {summary.pendingApprovals} 个本项目待办</span></div>
    </section>

    <nav className="tabs">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>项目驾驶舱</button>
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('budget')}>预算与合同</button>
      <button className={tab === 'rights' ? 'active' : ''} onClick={() => setTab('rights')}>资产版权图谱</button>
      <span>交付日 {summary.project.deliveryDate}</span>
    </nav>

    {tab === 'overview' && <div className="grid">
      <section className="panel hero">
        <div className="panel-head">
          <div><div className="eyebrow">PROJECT HEALTH / {summary.project.id}</div><h2>{summary.project.title}</h2></div>
          <span className="badge amber">{summary.project.status.toUpperCase()}</span>
        </div>
        <div className="progress-label"><span>成本消耗 {Math.round(summary.utilization * 100)}%</span><b>{money(summary.actual)} / {money(summary.planned)}</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, summary.utilization * 100)}%` }} /></div>
        <div className="split">
          <div><small>合同暴露额</small><strong>{money(summary.contractExposure)}</strong></div>
          <div><small>高风险预算项</small><strong className="bad">{summary.highRiskLines.length}</strong></div>
          <div><small>版权冲突</small><strong className={conflicts.length ? 'bad' : ''}>{conflicts.length}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>待审批队列（跨项目）</h3>
          <span>{queue.length} PENDING</span>
        </div>
        <div className={`batch-bar ${picked.size ? '' : 'disabled'}`}>
          <label><input type="checkbox" checked={picked.size === queue.length && queue.length > 0} onChange={() => setPicked(picked.size === queue.length ? new Set() : new Set(queue.map(v => v.approval.id)))} /> 全选</label>
          <span>已选 <b>{picked.size}</b> 项 · 跨 {pickedProjects} 个项目</span>
          <button className="primary" disabled={!picked.size || busy} onClick={openBatch}>批量预览与审批</button>
        </div>
        {groupedQueue.map(([projectTitle, views]) => <div className="queue-group" key={projectTitle}>
          <div className="queue-project">{projectTitle}</div>
          {views.map(view => <div className="approval" key={view.approval.id}>
            <input type="checkbox" checked={picked.has(view.approval.id)} onChange={() => toggle(view.approval.id)} aria-label={`选择 ${view.approval.title}`} />
            <span className="status pending" />
            <div>
              <b>{view.approval.title}</b>
              <small>{view.approval.approver} · {view.approval.id} · v{view.approval.version}</small>
              {view.blockers.map(b => <span key={b.code} className={`chip ${b.blocking ? 'chip-critical' : 'chip-warning'}`}>{b.blocking ? '⛔ ' : '⚠ '}{b.message}</span>)}
            </div>
            {view.approval.status === 'pending'
              ? <button disabled={busy} onClick={() => approveOne(view)}>通过</button>
              : <em>已完成</em>}
          </div>)}
        </div>)}
        {!queue.length && <div className="empty">所有项目的待办均已处理。</div>}
      </section>

      <section className="panel wide">
        <div className="panel-head"><h3>交付风险雷达</h3><span>基于版本、授权窗口与预算预测</span></div>
        {conflicts.length ? conflicts.map((c, i) => <div className="risk-row" key={i}>
          <strong className={c.severity}>{c.severity === 'critical' ? 'CRITICAL' : 'WARNING'}</strong>
          <div><b>{c.assetA}</b><small>↔ {c.assetB} · {c.reason}</small></div>
        </div>) : <div className="empty">当前项目未发现版权窗口冲突。</div>}
      </section>
    </div>}

    {tab === 'budget' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>预算版本 V3 / 成本基线</h3><span>实际 + 承诺 + 预测</span></div>
        <div className="table">
          <div className="tr th"><span>科目</span><span>预算</span><span>已承诺</span><span>实际</span><span>预测</span><span>风险</span></div>
          {summary.lines.map(line => <div className="tr" key={line.id}>
            <span><b>{line.category}</b><small>{line.subcategory}</small></span>
            <span>{money(line.planned)}</span><span>{money(line.planned ? line.planned : 0)}</span><span>{money(line.actual)}</span>
            <span className={line.forecast > line.planned ? 'bad' : ''}>{money(line.forecast)}</span>
            <span className={`risk ${line.risk}`}>{line.risk}</span>
          </div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>供应商付款里程碑</h3></div>
        {summary.contracts.map(c => <div className="contract" key={c.vendor}>
          <b>{c.vendor}</b><small>{c.scope}</small>
          <div className="contract-bar"><i style={{ width: `${Math.round(c.paid / c.committed * 100)}%` }} /></div>
          <span>{money(c.paid)} / {money(c.committed)}</span>
          <em>{c.milestones.filter(m => m.status !== 'paid').length} 个待结点</em>
        </div>)}
      </section>
    </div>}

    {tab === 'rights' && <div className="grid">
      <section className="panel wide">
        <div className="panel-head"><h3>资产版本登记</h3><span>{summary.assets.length} assets / checksum tracked</span></div>
        <div className="table">
          <div className="tr th"><span>资产</span><span>版本</span><span>状态</span><span>授权截止</span></div>
          {summary.assets.map(a => <div className="tr" key={a.id}>
            <span><b>{a.name}</b><small>{a.id} · {a.type}</small></span>
            <span>v{a.version}</span><span className={`pill ${a.status}`}>{a.status}</span><span>{a.availableTo}</span>
          </div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>授权冲突</h3><span>{conflicts.length} detected</span></div>
        {conflicts.map((c, i) => <div className="conflict" key={i}><strong>{c.severity}</strong><b>{c.assetA}</b><small>{c.reason}</small></div>)}
      </section>
    </div>}

    {modal && <BatchModal
      state={modal} busy={busy}
      onClose={() => void closeModal(false)}
      onRefreshClose={() => void closeModal(true)}
      onSubmit={(decision) => void submitBatch(decision)}
      onResume={() => void resumeUnfinished()}
      onComment={(comment) => setModal(modal.phase === 'preview' ? { ...modal, comment } : modal)}
    />}

    <footer>FrameLedger baseline · 内存仓储 + REST API · 批量审批：版本校验 / 幂等批次 / 逐项独立审计 / 可恢复部分失败</footer>
  </main>;
}

function EntityDetail({ entity }: { entity: EntitySummary }) {
  const d = entity.detail;
  if (entity.kind === 'budget') return <div className="entity-detail">
    <span>基线 {money(Number(d.planned))}</span><span>预测 {money(Number(d.forecast))}</span>
    <span className={Number(d.variance) > 0 ? 'bad' : ''}>偏差 {money(Number(d.variance))}</span>
    {Array.isArray(d.highRiskOverrun) && d.highRiskOverrun.length > 0 && <span className="bad">{d.highRiskOverrun.length} 个高风险超支</span>}
  </div>;
  if (entity.kind === 'asset') return <div className="entity-detail">
    <span>{String(d.type)} v{String(d.version)} · {String(d.status)}</span>
    <span title={String(d.checksum)}>{String(d.checksum)}</span>
    <span>{[...(d.territories as string[])].join('/')} · {[...(d.platforms as string[])].join('/')}</span>
    <span>{String(d.window)}</span>
  </div>;
  return <div className="entity-detail">
    <span>交付日 {String(d.deliveryDate)}</span><span>{Number(d.openMilestones)} 个未付结点</span>
    {Array.isArray(d.overdueMilestones) && d.overdueMilestones.length > 0 && <span className="bad">逾期 {d.overdueMilestones.length} 个</span>}
  </div>;
}

function BatchModal({ state, busy, onClose, onRefreshClose, onSubmit, onResume, onComment }: {
  state: ModalState; busy: boolean; onClose: () => void; onRefreshClose: () => void;
  onSubmit: (decision: 'approved' | 'rejected') => void; onResume: () => void; onComment: (c: string) => void;
}) {
  const views = state.views;
  const viewOf = (id: string) => views.find(v => v.approval.id === id);
  const batch = state.phase === 'preview' ? null : state.batch;

  const counts = useMemo(() => {
    if (!batch) return null;
    const ok = batch.items.filter(i => i.status === 'approved' || i.status === 'rejected').length;
    const blocked = batch.items.filter(i => i.status === 'blocked').length;
    const recoverable = batch.items.filter(i => RECOVERABLE.has(i.status) && i.status !== 'blocked').length;
    return { ok, blocked, recoverable };
  }, [batch]);

  return <div className="modal-overlay" onMouseDown={onClose}>
    <div className="modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head">
        <h2>{state.phase === 'preview' ? '批量审批预览' : state.phase === 'running' ? '正在逐项执行…' : '批量结果（逐项）'}</h2>
        <button className="ghost" onClick={onClose} disabled={state.phase === 'running'}>×</button>
      </div>

      {state.phase === 'preview' && <>
        <p className="modal-note">执行时服务端会重新计算状态与版权/预算阻断；带 ⛔ 的申请在“全成”时会被拦截且保持待办，驳回不受阻断限制。</p>
        <div className="modal-rows">
          {views.map(view => <div className="modal-row" key={view.approval.id}>
            <div className="modal-row-main">
              <b>{view.approval.title} <em className="row-version">v{view.approval.version}</em></b>
              <small>{view.projectTitle} · {view.approval.approver} · {view.approval.id}</small>
              <EntityDetail entity={view.entity} />
            </div>
            <div className="modal-row-side">
              {view.blockers.length === 0 && <span className="chip chip-ok">✓ 无阻断</span>}
              {view.blockers.map(b => <span key={b.code} className={`chip ${b.blocking ? 'chip-critical' : 'chip-warning'}`}>{b.blocking ? '⛔ ' : '⚠ '}{b.message}</span>)}
            </div>
          </div>)}
        </div>
        <label className="comment-line">审批意见 <input value={state.comment} onChange={e => onComment(e.target.value)} /></label>
        <div className="modal-actions">
          <span>{views.length} 项 · 跨 {new Set(views.map(v => v.projectTitle)).size} 个项目</span>
          <span className="spacer" />
          <button disabled={busy} onClick={() => onSubmit('rejected')}>驳回所选</button>
          <button className="primary" disabled={busy} onClick={() => onSubmit('approved')}>全部通过（{views.length}）</button>
        </div>
      </>}

      {state.phase === 'running' && batch && <div className="modal-rows">
        {batch.items.map(item => { const v = viewOf(item.approvalId); return <div className="modal-row result" key={item.approvalId}>
          <div className="modal-row-main"><b>{v?.approval.title ?? item.approvalId}</b><small>{v?.projectTitle} · {item.approvalId}</small></div>
          <span className={`result-badge tone-${ITEM_STATUS[item.status].tone}`}>{ITEM_STATUS[item.status].label}</span>
        </div>; })}
      </div>}

      {state.phase === 'result' && batch && <>
        <p className="modal-note">
          成功 {counts!.ok} 项{counts!.blocked ? ` · 阻断 ${counts!.blocked} 项（仍在待办，未写审批审计）` : ''}{counts!.recoverable ? ` · 可恢复 ${counts!.recoverable} 项` : ''}。
          每个实际审批都写了独立审计事件，未执行项未标记完成。
        </p>
        <div className="modal-rows">
          {batch.items.map(item => { const v = viewOf(item.approvalId); const st = ITEM_STATUS[item.status]; return <div className="modal-row result" key={item.approvalId}>
            <div className="modal-row-main">
              <b>{v?.approval.title ?? item.approvalId} <em className="row-version">v{item.expectedVersion}{item.afterVersion ? ` → v${item.afterVersion}` : ''}</em></b>
              <small>{v?.projectTitle} · {item.approvalId}{item.auditId ? ` · 审计 ${item.auditId}` : ''}</small>
              {item.reason && <small className="reason">{item.reason}</small>}
            </div>
            <span className={`result-badge tone-${st.tone}`}>{st.label}</span>
          </div>; })}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>关闭（保留待办）</button>
          <span className="spacer" />
          {counts!.recoverable > 0 && <button disabled={busy} onClick={onResume}>重试未完成项（{counts!.recoverable}）</button>}
          {counts!.blocked > 0 && <em className="hint">阻断项请先处理预算/版权风险后，刷新再重试</em>}
          <button className="primary" onClick={onRefreshClose}>刷新并接受结果</button>
        </div>
      </>}
    </div>
  </div>;
}
