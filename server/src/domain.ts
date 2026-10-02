export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type Decision = 'approved' | 'rejected';
export type BlockerSeverity = 'critical' | 'warning';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; /** 乐观并发版本：每次实际裁决 +1，预览携带、执行时核对 */
  version: number; updatedAt?: string; }
export interface AuditEvent { id: string; seq: number; action: string; entity: string; entityId: string; actor: string; at: string; details: string; approvalId?: string; batchId?: string; batchIndex?: number; }

export interface Blocker { code: string; severity: BlockerSeverity; /** blocking=true 的项在“全成”时会被服务端拦截，且不写审批审计 */
  blocking: boolean; message: string; }
export interface EntitySummary { kind: 'budget' | 'asset' | 'delivery'; label: string; detail: Record<string, unknown>; }
export interface ApprovalView { approval: Approval; projectId: string; projectTitle: string; entity: EntitySummary; blockers: Blocker[]; }

export type BatchItemStatus = 'queued' | 'approved' | 'rejected' | 'blocked' | 'stale' | 'busy' | 'failed';
export interface BatchItem { approvalId: string; index: number; expectedVersion: number; status: BatchItemStatus; blockers?: Blocker[]; auditId?: string; beforeVersion?: number; afterVersion?: number; reason?: string; at?: string; }
export interface Batch { id: string; idempotencyKey: string; decision: Decision; comment: string; actor: string; status: 'processing' | 'completed'; createdAt: string; finishedAt?: string; items: BatchItem[]; }
export class HttpError extends Error { constructor(public status: number, message: string, public code = 'BAD_REQUEST') { super(message); } }

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);

const seedProjects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];
const seedBudgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
];
const seedContracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '初剪验收提交', due: iso(-10), amount: 600000, status: 'invoiced' }, { name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
const seedAssets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];
const seedApprovals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1), version: 3 },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2), version: 7 },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证', version: 1 },
  { id: 'APR-04', projectId: 'PRJ-002', entityType: 'asset', entityId: 'AST-004', title: 'Orbit E02 卫星素材母版', requestedBy: '视觉总监', status: 'pending', approver: '总制片人', createdAt: iso(-1), version: 3 },
  { id: 'APR-05', projectId: 'PRJ-002', entityType: 'budget', entityId: 'BUD-002-V2', title: '跨国拍摄预算 V2', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-3), version: 2 },
  { id: 'APR-06', projectId: 'PRJ-001', entityType: 'delivery', entityId: 'DEL-009', title: '母版验收交付节点', requestedBy: '后期制片', status: 'pending', approver: '法务负责人', createdAt: iso(0), version: 1 }
];
const seedAudit: AuditEvent[] = [{ id: 'AUD-01', seq: 1, action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目' }];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export let projects: Project[] = clone(seedProjects);
export let budgetLines: BudgetLine[] = clone(seedBudgetLines);
export let contracts: Contract[] = clone(seedContracts);
export let assets: Asset[] = clone(seedAssets);
export let approvals: Approval[] = clone(seedApprovals);
export let auditEvents: AuditEvent[] = clone(seedAudit);
let auditSeq = Math.max(...auditEvents.map(event => event.seq), 0) + 1;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const itemDelay = () => Number(process.env.BATCH_ITEM_DELAY_MS ?? 120);
/** 测试钩子：下一回合处理这些申请时模拟一次瞬时下游失败（一次性） */
const armedTransientFailures = new Set<string>();

// ---------- 项目 / 预算 / 版权冲突（单一事实来源） ----------

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

type InternalConflict = ReturnType<typeof shapeConflict>;
function shapeConflict(a: Asset, b: Asset, tags: string[]) {
  return { severity: (a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning') as BlockerSeverity, assetAId: a.id, assetBId: b.id, assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${tags.join('、')}` };
}
function conflictsFor(projectId: string) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const result: InternalConflict[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const overlapTags = a.rightsTags.filter(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (overlapTags.length && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) result.push(shapeConflict(a, b, overlapTags));
  }
  return result;
}
export function rightsConflicts(projectId = projects[0].id) {
  return conflictsFor(projectId).map(({ severity, assetA, assetB, reason }) => ({ severity, assetA, assetB, reason }));
}

// ---------- 实体摘要与版权/预算阻断（预览与执行时各算一次） ----------

const today = () => new Date().toISOString().slice(0, 10);

function entitySummaryFor(approval: Approval): EntitySummary | undefined {
  if (approval.entityType === 'budget') {
    const lines = budgetLines.filter(line => line.projectId === approval.projectId);
    const planned = lines.reduce((sum, line) => sum + line.planned, 0);
    const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
    const highRiskOverrun = lines.filter(line => line.risk === 'high' && line.forecast > line.planned).map(line => ({ id: line.id, subcategory: line.subcategory, amount: line.forecast - line.planned }));
    return { kind: 'budget', label: `预算版本 ${approval.entityId}`, detail: { planned, forecast, variance: forecast - planned, highRiskOverrun } };
  }
  if (approval.entityType === 'asset') {
    const asset = assets.find(item => item.id === approval.entityId);
    if (!asset) return undefined;
    return { kind: 'asset', label: asset.name, detail: { type: asset.type, version: asset.version, status: asset.status, checksum: asset.checksum, territories: asset.territories, platforms: asset.platforms, window: `${asset.availableFrom} ~ ${asset.availableTo}`, rightsTags: asset.rightsTags } };
  }
  const project = projects.find(item => item.id === approval.projectId);
  const milestones = contracts.filter(contract => contract.projectId === approval.projectId).flatMap(contract => contract.milestones.map(milestone => ({ ...milestone, vendor: contract.vendor })));
  return { kind: 'delivery', label: `交付 ${approval.entityId}`, detail: { deliveryDate: project?.deliveryDate, openMilestones: milestones.filter(milestone => milestone.status !== 'paid').length, overdueMilestones: milestones.filter(milestone => milestone.status !== 'paid' && milestone.due < today()).map(milestone => `${milestone.vendor} · ${milestone.name}（${milestone.due}）`) } };
}

/** 关键规则：阻断永远基于当前数据现算，预览结果不能当执行凭据 */
export function blockersFor(approval: Approval): Blocker[] {
  const blockers: Blocker[] = [];
  if (approval.entityType === 'asset') {
    for (const conflict of conflictsFor(approval.projectId)) {
      if (conflict.assetAId === approval.entityId || conflict.assetBId === approval.entityId) {
        const critical = conflict.severity === 'critical';
        blockers.push({ code: critical ? 'RIGHTS_CRITICAL' : 'RIGHTS_WARNING', severity: conflict.severity, blocking: critical, message: critical ? `版权阻断：${conflict.reason}` : `版权提示：${conflict.reason}` });
      }
    }
  } else if (approval.entityType === 'budget') {
    const lines = budgetLines.filter(line => line.projectId === approval.projectId);
    const overrun = lines.filter(line => line.risk === 'high' && line.forecast > line.planned);
    if (overrun.length) blockers.push({ code: 'BUDGET_HIGH_RISK', severity: 'critical', blocking: true, message: `预算阻断：${overrun.length} 个高风险科目预测超支（${overrun.map(line => line.subcategory).join('、')}）` });
    const planned = lines.reduce((sum, line) => sum + line.planned, 0);
    const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
    if (forecast > planned) blockers.push({ code: 'BUDGET_VARIANCE', severity: 'warning', blocking: false, message: `预算提示：整体预测高于基线 ${(((forecast - planned) / planned) * 100).toFixed(1)}%` });
  } else {
    const overdue = contracts.filter(contract => contract.projectId === approval.projectId).flatMap(contract => contract.milestones.filter(milestone => milestone.status !== 'paid' && milestone.due < today()).map(milestone => `${contract.vendor} · ${milestone.name}`));
    if (overdue.length) blockers.push({ code: 'DELIVERY_MILESTONE_OVERDUE', severity: 'warning', blocking: false, message: `交付提示：存在逾期未付结点 ${overdue.length} 个（${overdue.join('、')}）` });
  }
  return blockers;
}

export function describeApproval(approval: Approval): ApprovalView {
  const project = projects.find(item => item.id === approval.projectId);
  const entity = entitySummaryFor(approval);
  if (!entity) throw new HttpError(404, `审批 ${approval.id} 关联实体已不存在`, 'ENTITY_MISSING');
  return { approval, projectId: approval.projectId, projectTitle: project?.title ?? approval.projectId, entity, blockers: blockersFor(approval) };
}

export function previewBatch(ids: string[]): ApprovalView[] {
  if (!ids.length) throw new HttpError(400, '未选择任何申请', 'EMPTY_SELECTION');
  return ids.map(id => {
    const approval = approvals.find(item => item.id === id);
    if (!approval) throw new HttpError(404, `审批 ${id} 不存在`, 'APPROVAL_NOT_FOUND');
    return describeApproval(approval);
  });
}

// ---------- 单项裁决（保留旧签名兼容既有测试/接口） ----------

function writeAudit(approval: Approval, decision: Decision, comment: string, batch?: { id: string; index: number }): AuditEvent {
  const event: AuditEvent = { id: `AUD-${auditSeq}`, seq: auditSeq, action: decision.toUpperCase(), entity: approval.entityType, entityId: approval.entityId, actor: '当前审批人', at: new Date().toISOString(), details: comment || `${approval.title} 已${decision === 'approved' ? '通过' : '驳回'}`, approvalId: approval.id, batchId: batch?.id, batchIndex: batch?.index };
  auditSeq += 1;
  auditEvents.unshift(event);
  return event;
}
function applyDecision(approval: Approval, decision: Decision, comment: string, batch?: { id: string; index: number }) {
  approval.status = decision;
  approval.version += 1;
  approval.updatedAt = new Date().toISOString();
  if (comment) approval.comment = comment;
  return writeAudit(approval, decision, comment, batch);
}

/** @deprecated 旧接口：直接裁决，无锁无版本校验。新代码请用 decideOne */
export function approve(id: string, status: ApprovalStatus, comment = '') {
  const item = approvals.find(approval => approval.id === id);
  if (!item) return undefined;
  if (status !== 'pending') {
    item.status = status; item.comment = comment;
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    writeAudit(item, status, comment);
  }
  return item;
}
export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) { const item: Approval = { ...input, id: `APR-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString(), version: 1 }; approvals.unshift(item); return item; }

// ---------- 批量审批：锁、幂等批次、可恢复逐项结果 ----------

const locks = new Set<string>();
const batches = new Map<string, Batch>();
const idempotencyIndex = new Map<string, string>();
const running = new Map<string, Promise<void>>();

const TERMINAL: ReadonlySet<BatchItemStatus> = new Set(['approved', 'rejected']);
/** 可恢复：阻断解除、状态刷新、锁释放、瞬时故障恢复后都可重试；已执行项永不再执行 */
const RECOVERABLE: ReadonlySet<BatchItemStatus> = new Set(['queued', 'blocked', 'stale', 'busy', 'failed']);

export function isTerminal(status: BatchItemStatus) { return TERMINAL.has(status); }
export function isRecoverable(status: BatchItemStatus) { return RECOVERABLE.has(status); }

export interface CreateBatchInput { decision: Decision; comment?: string; items: { approvalId: string; expectedVersion?: number }[]; idempotencyKey: string; actor?: string; }

export function createBatch(input: CreateBatchInput): { batch: Batch; replay: boolean } {
  const decision = input.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'decision 只能是 approved / rejected');
  const entries = input.items ?? [];
  if (!entries.length) throw new HttpError(400, '未选择任何申请', 'EMPTY_SELECTION');
  const ids = entries.map(item => item.approvalId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, '批量请求包含重复申请', 'DUPLICATE_ITEMS');

  const fingerprint = JSON.stringify({ decision, comment: input.comment ?? '', items: entries.map(item => item.approvalId) });
  const existingId = idempotencyIndex.get(input.idempotencyKey);
  if (existingId) {
    const existing = batches.get(existingId)!;
    const existingFingerprint = JSON.stringify({ decision: existing.decision, comment: existing.comment, items: existing.items.map(item => item.approvalId) });
    if (existingFingerprint !== fingerprint) throw new HttpError(409, '幂等键已用于不同的批量请求', 'IDEMPOTENCY_CONFLICT');
    return { batch: existing, replay: true }; // 超时重试：返回同一批次，绝不重复执行
  }

  for (const id of ids) {
    const approval = approvals.find(item => item.id === id);
    if (!approval) throw new HttpError(404, `审批 ${id} 不存在`, 'APPROVAL_NOT_FOUND');
  }

  const batch: Batch = {
    id: `BAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: input.idempotencyKey, decision, comment: input.comment ?? '', actor: input.actor ?? '当前审批人',
    status: 'processing', createdAt: new Date().toISOString(),
    items: ids.map((approvalId, index) => {
      const provided = entries[index].expectedVersion;
      const current = approvals.find(item => item.id === approvalId)!.version;
      if (provided !== undefined && provided !== current) throw new HttpError(409, `审批 ${approvalId} 状态已过期，请刷新后重试（当前 v${current}）`, 'STALE_PREVIEW');
      return { approvalId, index, expectedVersion: current, status: 'queued' as const };
    })
  };
  batches.set(batch.id, batch);
  idempotencyIndex.set(input.idempotencyKey, batch.id);
  void runBatch(batch.id);
  return { batch, replay: false };
}

export function getBatch(id: string) {
  const batch = batches.get(id);
  if (!batch) throw new HttpError(404, '批量任务不存在', 'BATCH_NOT_FOUND');
  return withSummary(batch);
}

/** 恢复批次：只重试未执行项，approved/rejected 原样返回（审计不重复写） */
export function resumeBatch(id: string, versions: Record<string, number> = {}): Batch & { recoverable: number; executed: number } {
  const batch = batches.get(id);
  if (!batch) throw new HttpError(404, '批量任务不存在', 'BATCH_NOT_FOUND');
  if (batch.status === 'processing' || running.has(id)) throw new HttpError(409, '批量任务仍在处理中，请稍后刷新', 'BATCH_RUNNING');
  for (const item of batch.items) {
    if (versions[item.approvalId] !== undefined) item.expectedVersion = versions[item.approvalId];
  }
  void runBatch(batch.id);
  return withSummary(batch);
}

async function runBatch(id: string) {
  const existing = running.get(id);
  if (existing) return existing;
  const task = (async () => {
    const batch = batches.get(id)!;
    batch.status = 'processing';
    for (const item of batch.items) {
      if (TERMINAL.has(item.status)) continue; // 恢复时已实际裁决的项不再执行
      await processItem(batch, item);
    }
    batch.status = 'completed';
    batch.finishedAt = new Date().toISOString();
  })();
  running.set(id, task);
  try { await task; } finally { running.delete(id); }
}

async function processItem(batch: Batch, item: BatchItem): Promise<void> {
  if (locks.has(item.approvalId)) { item.status = 'busy'; item.reason = '该申请正被其他操作占用，可稍后重试本项'; return; }
  locks.add(item.approvalId);
  const before = approvals.find(approval => approval.id === item.approvalId)?.version;
  item.beforeVersion = before;
  try {
    await delay(itemDelay()); // 模拟写台账/下游调用，并让并发窗口真实存在
    if (armedTransientFailures.delete(item.approvalId)) throw new Error('下游台账服务瞬时不可用');
    const approval = approvals.find(entry => entry.id === item.approvalId);
    if (!approval) { item.status = 'failed'; item.reason = '审批已不存在'; return; }
    if (approval.status !== 'pending') { item.status = 'stale'; item.reason = `申请在执行前已是 ${approval.status}（v${approval.version}），未覆盖他人结果`; return; }
    if (approval.version !== item.expectedVersion) { item.status = 'stale'; item.reason = `版本过期：预览 v${item.expectedVersion}，当前 v${approval.version}`; return; }
    // 阻断在执行时刻重算：预览放行不代表执行放行
    const blockers = blockersFor(approval);
    item.blockers = blockers;
    if (batch.decision === 'approved' && blockers.some(blocker => blocker.blocking)) { item.status = 'blocked'; item.reason = blockers.filter(blocker => blocker.blocking).map(blocker => blocker.message).join('；'); item.at = new Date().toISOString(); return; }
    const event = applyDecision(approval, batch.decision, batch.comment, { id: batch.id, index: item.index });
    item.status = batch.decision;
    item.auditId = event.id;
    item.afterVersion = approval.version;
    item.at = event.at;
  } catch (error) {
    item.status = 'failed';
    item.reason = error instanceof Error ? error.message : '未知故障';
  } finally {
    locks.delete(item.approvalId);
  }
}

/** 单项在线裁决：同样走锁与版本校验，重复点击返回 409 而不是再写一次审计 */
export async function decideOne(id: string, decision: Decision, comment = '', expectedVersion?: number) {
  if (locks.has(id)) throw new HttpError(409, '该申请正在处理中，请勿重复点击', 'BUSY');
  locks.add(id);
  try {
    await delay(Math.min(itemDelay(), 60));
    const approval = approvals.find(entry => entry.id === id);
    if (!approval) throw new HttpError(404, '审批不存在', 'APPROVAL_NOT_FOUND');
    if (approval.status !== 'pending') throw new HttpError(409, `申请已为 ${approval.status}（v${approval.version}），请刷新`, 'STATUS_CHANGED');
    if (expectedVersion !== undefined && approval.version !== expectedVersion) throw new HttpError(409, `版本过期：v${expectedVersion} → v${approval.version}，请刷新`, 'STALE_VERSION');
    const blockers = blockersFor(approval);
    if (decision === 'approved' && blockers.some(blocker => blocker.blocking)) throw new HttpError(422, blockers.filter(blocker => blocker.blocking).map(blocker => blocker.message).join('；'), 'BLOCKED');
    const event = applyDecision(approval, decision, comment);
    return { approval, auditId: event.id };
  } finally {
    locks.delete(id);
  }
}

export function withSummary(batch: Batch) {
  return Object.assign(batch, {
    executed: batch.items.filter(item => TERMINAL.has(item.status)).length,
    pending: batch.items.filter(item => item.status === 'queued').length,
    recoverable: batch.items.filter(item => RECOVERABLE.has(item.status) && item.status !== 'queued').length
  });
}

export function listAudit(filter: { batchId?: string; entityId?: string } = {}) {
  return auditEvents.filter(event => (!filter.batchId || event.batchId === filter.batchId) && (!filter.entityId || event.entityId === filter.entityId)).sort((a, b) => b.seq - a.seq);
}

export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }

// ---------- 测试支持 ----------

export const __testing = {
  reset() {
    projects = clone(seedProjects); budgetLines = clone(seedBudgetLines); contracts = clone(seedContracts);
    assets = clone(seedAssets); approvals = clone(seedApprovals); auditEvents = clone(seedAudit);
    auditSeq = Math.max(...auditEvents.map(event => event.seq), 0) + 1;
    locks.clear(); batches.clear(); idempotencyIndex.clear(); running.clear(); armedTransientFailures.clear();
  },
  armTransientFailure(...ids: string[]) { ids.forEach(id => armedTransientFailures.add(id)); },
  async settle(id?: string) {
    if (id) { await running.get(id); return; }
    while (running.size) await Promise.all([...running.values()]);
  },
  isLocked: (id: string) => locks.has(id),
  listBatches: () => [...batches.values()].map(withSummary)
};
