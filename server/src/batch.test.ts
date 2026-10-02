process.env.BATCH_ITEM_DELAY_MS = '5';
import test from 'node:test';
import assert from 'node:assert/strict';
import { __testing, approvals, auditEvents, createBatch, dashboard, decideOne, getBatch, listAudit, previewBatch, resumeBatch } from './domain.js';

const byId = (id: string) => approvals.find(item => item.id === id)!;
const pendingOf = (projectId: string) => approvals.filter(item => item.projectId === projectId && item.status === 'pending').length;
const fresh = (ids: string[]) => previewBatch(ids).map(item => ({ approvalId: item.approval.id, expectedVersion: item.approval.version }));
const key = () => `key-${Math.random().toString(36).slice(2)}`;

test.beforeEach(() => __testing.reset());

test('跨项目批量：阻断项不执行，其余按选择顺序逐项审批并独立写审计', async () => {
  const ids = ['APR-01', 'APR-02', 'APR-04', 'APR-05', 'APR-06'];
  const { batch } = createBatch({ idempotencyKey: key(), decision: 'approved', comment: '批量复核', items: fresh(ids) });
  await __testing.settle(batch.id);
  const done = getBatch(batch.id);

  assert.deepEqual(done.items.map(item => item.status), ['blocked', 'blocked', 'approved', 'approved', 'approved']);
  // 未执行项保持 pending，绝不能被标为完成
  assert.equal(byId('APR-01').status, 'pending');
  assert.equal(byId('APR-02').status, 'pending');
  assert.equal(byId('APR-04').status, 'approved');
  assert.equal(byId('APR-05').status, 'approved');
  assert.equal(byId('APR-06').status, 'approved');

  // 阻断原因：预算高风险超支 / 关键版权窗口冲突
  assert.equal(done.items[0].blockers?.some(b => b.code === 'BUDGET_HIGH_RISK' && b.blocking), true);
  assert.equal(done.items[1].blockers?.some(b => b.code === 'RIGHTS_CRITICAL' && b.blocking), true);
  assert.equal(done.items[2].blockers?.filter(b => b.blocking).length, 0); // PRJ-002 无超支
  // 逾期结点只产生 warning，不拦截交付审批
  assert.equal(done.items[4].blockers?.some(b => b.code === 'DELIVERY_MILESTONE_OVERDUE' && !b.blocking), true);

  // 每个实际审批一条独立审计，顺序与选择顺序一致，seq 全局单调
  const events = listAudit({ batchId: batch.id });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.batchIndex), [4, 3, 2]); // seq 降序：最新在前，执行顺序仍是 2→3→4
  const seqs = events.map(e => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
  for (const id of ['APR-04', 'APR-05', 'APR-06']) {
    assert.equal(events.find(e => e.approvalId === id)?.entity, byId(id).entityType);
  }
  // 阻断项没有审批审计、版本不变
  assert.equal(byId('APR-01').version, 3);
  assert.equal(done.items[0].auditId, undefined);
  // 已执行项版本 +1
  assert.equal(byId('APR-04').version, 4);
});

test('空选择与重复选择被拒绝', () => {
  assert.throws(() => createBatch({ idempotencyKey: key(), decision: 'approved', items: [] }), /未选择任何申请/);
  assert.throws(() => createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-04', 'APR-04']) }), /重复申请/);
});

test('预览版本过期：创建批次即被拒，要求刷新', () => {
  assert.throws(
    () => createBatch({ idempotencyKey: key(), decision: 'approved', items: [{ approvalId: 'APR-04', expectedVersion: 99 }] }),
    (err: Error & { code?: string }) => err.message.includes('状态已过期') && err.code === 'STALE_PREVIEW'
  );
});

test('执行期间状态被他人改变：该项 stale，不覆盖他人结果', async () => {
  // 模拟另一个通道已提交裁决（状态在本批次执行到该项前漂移）
  const { batch } = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-04', 'APR-05']) });
  const stolen = byId('APR-05');
  stolen.status = 'rejected'; stolen.version += 1; stolen.comment = '他人先驳回';
  await __testing.settle(batch.id);
  const done = getBatch(batch.id);
  assert.equal(done.items[0].status, 'approved');
  assert.equal(done.items[1].status, 'stale');
  assert.match(done.items[1].reason ?? '', /v\d/);
  assert.equal(byId('APR-05').comment, '他人先驳回');
  // 批次只对第一项写了一次审计
  assert.equal(listAudit({ batchId: batch.id }).length, 1);
});

test('并发批次：处理中重复点击 → busy；恢复后成功且已执行项不重复', async () => {
  const first = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-04', 'APR-05']) }).batch;
  const second = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-04']) }).batch;
  await __testing.settle();
  const doneFirst = getBatch(first.id);
  const doneSecond = getBatch(second.id);
  assert.equal(doneFirst.items.map(i => i.status).join(','), 'approved,approved');
  assert.equal(doneSecond.items[0].status, 'busy');
  const auditsBefore = auditEvents.length;

  const resumed = resumeBatch(second.id, { 'APR-04': byId('APR-04').version });
  await __testing.settle(resumed.id);
  const after = getBatch(second.id);
  // APR-04 已被第一批次裁决 → 恢复时为 stale（绝不再写审计、不覆盖）
  assert.equal(after.items[0].status, 'stale');
  assert.equal(auditEvents.length, auditsBefore);
});

test('超时重试：同一幂等键返回同一批次，审计只写一次', async () => {
  const k = key();
  const payload = { decision: 'approved' as const, items: fresh(['APR-04']) };
  const first = createBatch({ ...payload, idempotencyKey: k }).batch;
  const retry = createBatch({ ...payload, idempotencyKey: k });
  assert.equal(retry.replay, true);
  assert.equal(retry.batch.id, first.id);
  await __testing.settle(first.id);
  const third = createBatch({ ...payload, idempotencyKey: k });
  assert.equal(third.batch.id, first.id);
  assert.equal(listAudit({ batchId: first.id }).length, 1);
  assert.throws(
    () => createBatch({ idempotencyKey: k, decision: 'rejected', items: fresh(['APR-04']) }),
    (err: Error & { code?: string }) => err.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('瞬时故障可恢复：failed 项重试成功，其余结果保留', async () => {
  __testing.armTransientFailure('APR-05');
  const { batch } = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-04', 'APR-05']) });
  await __testing.settle(batch.id);
  const failed = getBatch(batch.id);
  assert.equal(failed.items[0].status, 'approved');
  assert.equal(failed.items[1].status, 'failed');
  const auditsSoFar = listAudit({ batchId: batch.id }).length;

  const resumed = resumeBatch(batch.id);
  await __testing.settle(resumed.id);
  const recovered = getBatch(batch.id);
  assert.deepEqual(recovered.items.map(i => i.status), ['approved', 'approved']);
  assert.equal(listAudit({ batchId: batch.id }).length, auditsSoFar + 1);
});

test('阻断解除后恢复：blocked 项通过，已通过项不再执行', async () => {
  const { batch } = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-01', 'APR-06']) });
  await __testing.settle(batch.id);
  const initial = getBatch(batch.id);
  assert.deepEqual(initial.items.map(i => i.status), ['blocked', 'approved']);
  assert.equal(pendingOf('PRJ-001'), 2); // APR-01、APR-02 仍在待办

  // 预算负责人处理掉高风险超支（阻断解除），随后恢复批次；阻断始终按当前数据重算
  const { budgetLines } = await import('./domain.js');
  const high = budgetLines.find(l => l.id === 'BL-103')!;
  high.forecast = high.planned;
  const resumed = resumeBatch(batch.id);
  await __testing.settle(resumed.id);
  const after = getBatch(batch.id);
  assert.deepEqual(after.items.map(i => i.status), ['approved', 'approved']);
  assert.equal(after.items[0].afterVersion, 4);
  // 全批次恰好 2 条审计（每实际审批一条）
  assert.equal(listAudit({ batchId: batch.id }).length, 2);
});

test('单项重复点击返回 409，不产生第二条审计', async () => {
  const first = decideOne('APR-04', 'approved', 'ok', byId('APR-04').version);
  await assert.rejects(() => decideOne('APR-04', 'approved', 'ok', byId('APR-04').version), (err: Error & { code?: string }) => err.code === 'BUSY');
  await first;
  await assert.rejects(() => decideOne('APR-04', 'approved'), (err: Error & { code?: string }) => err.code === 'STATUS_CHANGED');
  assert.equal(auditEvents.filter(e => e.approvalId === 'APR-04').length, 1);
});

test('待办计数与风险雷达在部分失败后保持一致', async () => {
  const { batch } = createBatch({ idempotencyKey: key(), decision: 'approved', items: fresh(['APR-01', 'APR-02', 'APR-04', 'APR-05', 'APR-06']) });
  await __testing.settle(batch.id);
  // PRJ-001：APR-01/02 被阻断未执行 → 仍 2 个待办；PRJ-002：APR-04/05 通过 → 0 待办（APR-03 已完成）
  assert.equal(pendingOf('PRJ-001'), 2);
  assert.equal(pendingOf('PRJ-002'), 0);
  const board = dashboard();
  assert.equal(board.find(p => p.id === 'PRJ-001')?.pendingApprovals, 2);
  assert.equal(board.find(p => p.id === 'PRJ-002')?.pendingApprovals, 0);
  // 风险雷达仍有 1 条冲突（音乐同步许可窗口重叠）
  assert.equal(board.find(p => p.id === 'PRJ-001')?.rightsConflicts, 1);
  // 批次汇总数字与逐项状态一致
  const done = getBatch(batch.id);
  assert.equal(done.executed, 3);
  assert.equal(done.recoverable, 2);
});
