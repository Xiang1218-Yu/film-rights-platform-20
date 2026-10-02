export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; updatedAt?: string; comment?: string; version?: number; }
export interface AuditEvent { id: string; seq: number; action: string; entity: string; entityId: string; actor: string; at: string; details: string; batchKey?: string; }

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const ACTOR = '当前审批人';
/** 预测超基线 5% 以上的高风险科目构成预算阻断 */
const BUDGET_OVERRUN_TOLERANCE = 1.05;

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];
export const budgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
];
export const contracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
export const assets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];
export const approvals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1), updatedAt: iso(-1) },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2), updatedAt: iso(-2) },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), updatedAt: iso(-4), comment: '已补充航拍授权凭证' }
];

/* ---------------------------------- 审计 ---------------------------------- */

let auditSeq = 0;
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', seq: auditSeq, action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目' }];

export function appendAudit(action: string, entity: string, entityId: string, details: string, batchKey?: string, actor = ACTOR): AuditEvent {
  auditSeq += 1;
  const event: AuditEvent = { id: `AUD-${auditSeq}`, seq: auditSeq, action, entity, entityId, actor, at: new Date().toISOString(), details, ...(batchKey ? { batchKey } : {}) };
  // 内存表按新→旧保存；seq 单调递增，是审计顺序的唯一权威
  auditEvents.unshift(event);
  return event;
}

export function listAudit(options: { chronological?: boolean; limit?: number } = {}): AuditEvent[] {
  const chronological = [...auditEvents].sort((a, b) => a.seq - b.seq);
  const list = options.chronological ? chronological : chronological.reverse();
  return options.limit ? list.slice(0, options.limit) : list;
}

/* --------------------------------- 汇总查询 -------------------------------- */

export function projectSummary(projectId = projects[0].id) {
  const lines = budgetLines.filter(line => line.projectId === projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return { project: projects.find(project => project.id === projectId), planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflicts(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: { severity: 'critical' | 'warning'; assetA: string; assetB: string; reason: string }[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const sameTag = a.rightsTags.some(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (sameTag && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${a.rightsTags.filter(tag => b.rightsTags.includes(tag)).join('、')}` });
  }
  return conflicts;
}

/* ------------------------------ 审批阻断与实体摘要 ----------------------------- */

export interface Blocker { code: string; severity: 'critical' | 'warning'; message: string; }
export type EntitySummary =
  | { kind: 'budget'; budgetVersion: string; planned: number; forecast: number; variance: number; variancePct: number; highRiskCount: number; highRiskLines: { subcategory: string; overrunPct: number }[] }
  | { kind: 'asset'; assetId: string; name: string; type: string; version: number; status: string; owner: string; checksum: string; territories: string[]; availableFrom: string; availableTo: string; rightsTags: string[] }
  | { kind: 'delivery'; packageId: string; deliveryDate: string };

/** 版权（冲突/窗口过期，critical）与预算（高风险超支，warning）阻断；执行时会重新计算一次 */
export function approvalBlockers(approval: Approval, on = today()): Blocker[] {
  const blockers: Blocker[] = [];
  if (approval.entityType === 'asset') {
    const asset = assets.find(item => item.id === approval.entityId);
    if (asset) {
      if (asset.availableTo < on) blockers.push({ code: 'RIGHTS_WINDOW_EXPIRED', severity: 'critical', message: `授权窗口已于 ${asset.availableTo} 到期（${asset.territories.join('、')}）` });
      for (const conflict of rightsConflicts(approval.projectId)) {
        if (conflict.assetA !== asset.name && conflict.assetB !== asset.name) continue;
        const other = conflict.assetA === asset.name ? conflict.assetB : conflict.assetA;
        blockers.push({ code: 'RIGHTS_CONFLICT', severity: conflict.severity, message: `与「${other}」存在${conflict.severity === 'critical' ? '严重' : '窗口'}版权冲突：${conflict.reason}` });
      }
    }
  }
  if (approval.entityType === 'budget') {
    for (const line of budgetLines.filter(item => item.projectId === approval.projectId && item.risk === 'high' && item.forecast > item.planned * BUDGET_OVERRUN_TOLERANCE)) {
      blockers.push({ code: 'BUDGET_OVERRUN_RISK', severity: 'warning', message: `高风险科目「${line.subcategory}」预测 ${line.forecast} 超出基线 ${Math.round((line.forecast / line.planned - 1) * 100)}%` });
    }
  }
  return blockers;
}

export function entitySummary(approval: Approval): EntitySummary | undefined {
  const project = projects.find(item => item.id === approval.projectId);
  if (approval.entityType === 'asset') {
    const asset = assets.find(item => item.id === approval.entityId);
    if (!asset) return undefined;
    return { kind: 'asset', assetId: asset.id, name: asset.name, type: asset.type, version: asset.version, status: asset.status, owner: asset.owner, checksum: asset.checksum, territories: asset.territories, availableFrom: asset.availableFrom, availableTo: asset.availableTo, rightsTags: asset.rightsTags };
  }
  if (approval.entityType === 'budget') {
    const summary = projectSummary(approval.projectId);
    return { kind: 'budget', budgetVersion: approval.entityId, planned: summary.planned, forecast: summary.forecast, variance: summary.variance, variancePct: summary.planned ? Math.round(summary.variance / summary.planned * 100) : 0, highRiskCount: summary.highRiskLines.length, highRiskLines: summary.highRiskLines.map(line => ({ subcategory: line.subcategory, overrunPct: Math.round((line.forecast / line.planned - 1) * 100) })) };
  }
  return { kind: 'delivery', packageId: approval.entityId, deliveryDate: project?.deliveryDate ?? '—' };
}

export interface QueueItem {
  id: string; projectId: string; projectCode: string; projectTitle: string;
  entityType: Approval['entityType']; entityId: string; title: string;
  requestedBy: string; approver: string; status: ApprovalStatus; createdAt: string; updatedAt?: string; comment?: string;
  blockers: Blocker[]; entitySummary?: EntitySummary;
}

export function approvalQueue(): QueueItem[] {
  return approvals.map(approval => {
    const project = projects.find(item => item.id === approval.projectId);
    return { ...approval, projectCode: project?.code ?? approval.projectId, projectTitle: project?.title ?? '未知项目', blockers: approvalBlockers(approval), entitySummary: entitySummary(approval) };
  });
}

/* -------------------------------- 单项审批 --------------------------------- */

export function approve(id: string, status: ApprovalStatus, comment = '') {
  const item = approvals.find(approval => approval.id === id); if (!item) return undefined;
  item.status = status; item.comment = comment; item.updatedAt = new Date().toISOString();
  appendAudit(status.toUpperCase(), item.entityType, item.entityId, comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}`);
  return item;
}
export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) { const item: Approval = { ...input, id: `APR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; approvals.unshift(item); return item; }
export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }

/* -------------------------------- 批量审批 --------------------------------- */

export type BatchDecision = 'approve' | 'reject';
export type BatchOutcome = 'approved' | 'rejected' | 'skipped_blocked' | 'skipped_stale' | 'skipped_duplicate' | 'not_found';

export interface BatchItemResult {
  approvalId: string; projectId: string; entityType: Approval['entityType'] | ''; title: string;
  outcome: BatchOutcome; blockers: Blocker[]; at?: string;
}
export interface BatchCounts { total: number; approved: number; rejected: number; blocked: number; stale: number; duplicate: number; notFound: number; }
export interface BatchRecord {
  key: string; decision: BatchDecision; override: boolean; comment: string;
  status: 'running' | 'completed'; requestedAt: string; finishedAt?: string;
  results: BatchItemResult[]; counts: BatchCounts;
}

export class BatchError extends Error { constructor(public code: string, message: string) { super(message); } }

export interface BatchInput { idempotencyKey: string; decision: BatchDecision; ids: string[]; override?: boolean; comment?: string; delayMs?: number; }
export interface BatchPreviewItem extends Partial<QueueItem> { approvalId: string; blockers: Blocker[]; outcome?: 'not_found'; }

const EMPTY_COUNTS: BatchCounts = { total: 0, approved: 0, rejected: 0, blocked: 0, stale: 0, duplicate: 0, notFound: 0 };

export function previewBatch(rawIds: string[]): { generatedAt: string; items: BatchPreviewItem[] } {
  const ids = (rawIds ?? []).filter(Boolean);
  if (!ids.length) throw new BatchError('EMPTY_SELECTION', '请先选择至少一条申请');
  const items: BatchPreviewItem[] = [];
  for (const id of new Set(ids)) {
    const approval = approvals.find(item => item.id === id);
    if (!approval) { items.push({ approvalId: id, blockers: [], outcome: 'not_found' }); continue; }
    const project = projects.find(item => item.id === approval.projectId);
    items.push({ id: approval.id, approvalId: approval.id, projectId: approval.projectId, projectCode: project?.code ?? approval.projectId, projectTitle: project?.title ?? '未知项目', entityType: approval.entityType, entityId: approval.entityId, title: approval.title, requestedBy: approval.requestedBy, approver: approval.approver, status: approval.status, createdAt: approval.createdAt, updatedAt: approval.updatedAt, blockers: approvalBlockers(approval), entitySummary: entitySummary(approval) });
  }
  return { generatedAt: new Date().toISOString(), items };
}

/* 全局串行锁：任何时刻只有一个批次在落库，保证跨并发批次的审计事件不交错、状态判定确定 */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const batchStore = new Map<string, { record: BatchRecord; promise: Promise<BatchRecord>; fresh: boolean }>();

export function getBatch(key: string): BatchRecord | undefined { return batchStore.get(key)?.record; }

/**
 * 同步登记批量请求：保证同一微任务内并发到达的同键调用（超时重试、双击）全部合并到同一批次。
 * fresh=true 表示本次调用是该批次的发起者；false 表示挂到了已存在（运行中或已完成）的批次。
 */
export function enqueueBatch(input: BatchInput): { record: BatchRecord; promise: Promise<BatchRecord>; fresh: boolean } {
  const ids = Array.isArray(input?.ids) ? input.ids.filter(Boolean) : [];
  if (!ids.length) throw new BatchError('EMPTY_SELECTION', '请先选择至少一条申请');
  if (input.decision !== 'approve' && input.decision !== 'reject') throw new BatchError('INVALID_DECISION', '决策必须是 approve 或 reject');
  const key = (input.idempotencyKey ?? '').trim();
  if (!key) throw new BatchError('MISSING_IDEMPOTENCY_KEY', '缺少幂等键');
  const override = Boolean(input.override);
  const comment = (input.comment ?? '').trim();
  if (override && !comment) throw new BatchError('OVERRIDE_REQUIRES_COMMENT', '强制覆盖版权/预算阻断必须填写审批意见');

  const existing = batchStore.get(key);
  if (existing) return { ...existing, fresh: false };

  const fromEnv = Number(process.env.BATCH_ITEM_DELAY_MS);
  const delayMs = Math.max(0, Math.min(Number.isFinite(input.delayMs) ? Number(input.delayMs) : Number.isFinite(fromEnv) ? fromEnv : 120, 8000));
  const record: BatchRecord = { key, decision: input.decision, override, comment, status: 'running', requestedAt: new Date().toISOString(), results: [], counts: { ...EMPTY_COUNTS, total: ids.length } };
  // 同步入店（本函数在首个 await 之前完成）：随后到达的同键调用一定能看到运行中的批次
  const entry = { record, promise: serialize(() => processBatch(record, ids, delayMs)), fresh: true };
  batchStore.set(key, entry);
  return entry;
}

/**
 * 执行批量审批（幂等）：
 * - 相同 idempotencyKey 的并发调用挂到同一批次（HTTP 202），完成后重放返回同一结果（200）
 * - 逐项在持锁状态下重新判定：不存在 / 重复项 / 已被他人处理（过期）/ 阻断未覆盖 → 全部跳过
 * - 仅实际发生的通过/驳回写状态与逐项审计；BATCH_START、逐项事件、BATCH_FINISH 严格有序
 */
export async function executeBatch(input: BatchInput): Promise<{ record: BatchRecord; joined: boolean; fresh: boolean }> {
  const { record, promise, fresh } = enqueueBatch(input); // 同步去重，先于任何 await
  // joined = 本次调用挂到了另一个仍在运行的批次（HTTP 202）；完成后的重放 joined=false（HTTP 200）
  const joined = !fresh && record.status === 'running';
  await promise;
  return { record, joined, fresh };
}

async function processBatch(record: BatchRecord, ids: string[], delayMs: number): Promise<BatchRecord> {
  const projectCount = new Set(ids.map(id => approvals.find(item => item.id === id)?.projectId).filter(Boolean)).size;
  appendAudit('BATCH_START', 'approval_batch', record.key, `批量${record.decision === 'approve' ? '通过' : '驳回'} ${ids.length} 项申请 · 跨 ${projectCount} 个项目 · 强制覆盖：${record.override ? '是' : '否'}`, record.key);

  const seen = new Set<string>();
  for (const id of ids) {
    if (delayMs) await sleep(delayMs); // 模拟逐项落库/外部台账调用，使并发与超时重试可观测
    const item = approvals.find(approval => approval.id === id);
    if (!item) { record.results.push({ approvalId: id, projectId: '', entityType: '', title: id, outcome: 'not_found', blockers: [] }); continue; }
    const base = { approvalId: item.id, projectId: item.projectId, entityType: item.entityType, title: item.title };
    if (seen.has(id)) { record.results.push({ ...base, outcome: 'skipped_duplicate', blockers: [] }); continue; }
    seen.add(id);
    // 过期状态：批次排队/重试期间已被单项操作或其他批次处理
    if (item.status !== 'pending') { record.results.push({ ...base, outcome: 'skipped_stale', blockers: [] }); continue; }
    // 执行时重新计算阻断，避免预览与执行之间状态漂移（TOCTOU）
    const blockers = approvalBlockers(item);
    if (record.decision === 'approve' && blockers.length > 0 && !record.override) {
      record.results.push({ ...base, outcome: 'skipped_blocked', blockers });
      continue;
    }
    const status = record.decision === 'approve' ? 'approved' : 'rejected';
    item.status = status;
    item.updatedAt = new Date().toISOString();
    if (record.comment) item.comment = record.comment;
    const verb = status === 'approved' ? '通过' : '驳回';
    appendAudit(status === 'approved' ? 'APPROVE' : 'REJECT', item.entityType, item.entityId, `${item.title} 批量${verb}${record.comment ? `：${record.comment}` : ''}${blockers.length ? `（覆盖阻断 ${blockers.length} 项）` : ''}`, record.key);
    record.results.push({ ...base, outcome: status, blockers, at: item.updatedAt });
  }

  record.status = 'completed';
  record.finishedAt = new Date().toISOString();
  record.counts = countResults(record.results);
  appendAudit('BATCH_FINISH', 'approval_batch', record.key,
    `批量完成：通过 ${record.counts.approved} · 驳回 ${record.counts.rejected} · 阻断 ${record.counts.blocked} · 过期 ${record.counts.stale} · 重复 ${record.counts.duplicate} · 不存在 ${record.counts.notFound}`, record.key);
  return record;
}

function countResults(results: BatchItemResult[]): BatchCounts {
  const counts = { ...EMPTY_COUNTS, total: results.length };
  for (const result of results) {
    if (result.outcome === 'approved') counts.approved += 1;
    else if (result.outcome === 'rejected') counts.rejected += 1;
    else if (result.outcome === 'skipped_blocked') counts.blocked += 1;
    else if (result.outcome === 'skipped_stale') counts.stale += 1;
    else if (result.outcome === 'skipped_duplicate') counts.duplicate += 1;
    else if (result.outcome === 'not_found') counts.notFound += 1;
  }
  return counts;
}
