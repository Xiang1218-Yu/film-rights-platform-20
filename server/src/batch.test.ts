import test from 'node:test';
import assert from 'node:assert/strict';
import { approvals, approvalBlockers, appendAudit, createApproval, executeBatch, listAudit, previewBatch, type BatchInput } from './domain.js';

let counter = 0;
const key = (name: string) => `test-${name}-${Date.now()}-${counter++}`;
const seedPending = (projectId: string, entityType: 'budget' | 'asset' | 'delivery', entityId: string, title: string) =>
  createApproval({ projectId, entityType, entityId, title, requestedBy: '测试申请人', approver: '测试审批人' });

test('批量预览展示跨项目实体摘要、当前状态与版权/预算阻断', () => {
  const a = seedPending('PRJ-001', 'budget', 'BUD-001-V3', '测试-预算超支');
  const b = seedPending('PRJ-002', 'delivery', 'DEL-TEST', '测试-交付无阻断');
  const preview = previewBatch([a.id, b.id]);
  assert.equal(preview.items.length, 2);
  const projects = new Set(preview.items.map(item => item.projectId));
  assert.ok(projects.has('PRJ-001') && projects.has('PRJ-002'), '队列必须允许跨项目选择');

  const budgetItem = preview.items.find(item => item.approvalId === a.id)!;
  assert.equal(budgetItem.status, 'pending');
  assert.equal(budgetItem.entitySummary?.kind, 'budget');
  assert.ok(budgetItem.blockers.some(item => item.code === 'BUDGET_OVERRUN_RISK'), '高风险超支科目应产生预算阻断');

  const deliveryItem = preview.items.find(item => item.approvalId === b.id)!;
  assert.equal(deliveryItem.entitySummary?.kind, 'delivery');
  if (deliveryItem.entitySummary?.kind === 'delivery') assert.equal(deliveryItem.entitySummary.packageId, 'DEL-TEST');
  assert.equal(deliveryItem.blockers.length, 0);

  // 母版 AST-001 与已锁定的 AST-003 共享音乐同步许可 + 同地域 + 窗口重叠 → critical
  const master = previewBatch(['APR-02']).items[0];
  assert.ok(master.blockers.some(item => item.code === 'RIGHTS_CONFLICT' && item.severity === 'critical'), master.blockers.map(item => item.code).join(','));
});

test('空选择被拒绝；未知 id 返回 not_found 而不是静默成功', async () => {
  assert.throws(() => previewBatch([]), /至少一条/);
  await assert.rejects(executeBatch({ idempotencyKey: key('empty'), decision: 'approve', ids: [] }), /至少一条/);
  await assert.rejects(executeBatch({ idempotencyKey: '', decision: 'approve', ids: ['NOPE'] }), /幂等键/);
  const { record } = await executeBatch({ idempotencyKey: key('notfound'), decision: 'approve', ids: ['APR-NO-SUCH-ID'], delayMs: 0 });
  assert.equal(record.results[0].outcome, 'not_found');
  assert.equal(record.counts.approved, 0);
  assert.equal(record.counts.notFound, 1);
});

test('安全批量通过：有阻断的项被跳过且未执行项绝不能标记完成', async () => {
  const blocked = seedPending('PRJ-001', 'asset', 'AST-001', '测试-母版冲突');
  const clean = seedPending('PRJ-002', 'delivery', 'DEL-OK', '测试-可通过交付');
  const before = approvals.find(item => item.id === blocked.id)!;
  assert.equal(before.status, 'pending');

  const { record, joined } = await executeBatch({ idempotencyKey: key('safe'), decision: 'approve', ids: [blocked.id, clean.id], delayMs: 0 });
  assert.equal(joined, false, '首次提交不是加入他人批次');
  assert.equal(record.results.length, 2);
  assert.equal(record.results[0].outcome, 'skipped_blocked');
  assert.ok(record.results[0].blockers.length > 0, '跳过时必须回传阻断原因');
  assert.equal(record.results[1].outcome, 'approved');
  assert.equal(record.counts.approved, 1);
  assert.equal(record.counts.blocked, 1);

  assert.equal(approvals.find(item => item.id === blocked.id)!.status, 'pending', '未执行项保持 pending，不能被标为完成');
  assert.equal(approvals.find(item => item.id === clean.id)!.status, 'approved');

  // 只有实际通过的 clean 写逐项 APPROVE 审计；blocked 不写 APPROVE
  const audits = listAudit({ chronological: true }).filter(event => event.batchKey === record.key);
  assert.ok(!audits.some(event => event.action === 'APPROVE' && event.entityId === 'AST-001'));
  assert.ok(audits.some(event => event.action === 'APPROVE' && event.entityId === 'DEL-OK'));
});

test('强制覆盖阻断需要意见，并为实际执行写逐项审计', async () => {
  const blocked = seedPending('PRJ-001', 'asset', 'AST-001', '测试-覆盖母版');
  await assert.rejects(
    executeBatch({ idempotencyKey: key('override-missing-comment'), decision: 'approve', ids: [blocked.id], override: true, comment: '', delayMs: 0 }),
    (error: Error & { code?: string }) => error.code === 'OVERRIDE_REQUIRES_COMMENT',
  );
  const { record } = await executeBatch({ idempotencyKey: key('override'), decision: 'approve', ids: [blocked.id], override: true, comment: '总制片人确认侵权风险已缓释', delayMs: 0 });
  assert.equal(record.results[0].outcome, 'approved');
  assert.ok(record.results[0].blockers.length > 0, '结果中保留被覆盖的阻断留痕');
  assert.equal(approvals.find(item => item.id === blocked.id)!.status, 'approved');
  const itemAudit = listAudit({ chronological: true }).find(event => event.batchKey === record.key && event.action === 'APPROVE');
  assert.ok(itemAudit && itemAudit.details.includes('覆盖阻断 1 项'));
});

test('并发批次按全局顺序串行落库：后提交者遇到过期状态并跳过，审计不交错', async () => {
  const shared = seedPending('PRJ-002', 'delivery', 'DEL-RACE', '测试-竞态共享项');
  const extra1 = seedPending('PRJ-001', 'delivery', 'DEL-E1', '测试-竞态补充1');
  const extra2 = seedPending('PRJ-002', 'delivery', 'DEL-E2', '测试-竞态补充2');

  const first = executeBatch({ idempotencyKey: key('race-a'), decision: 'approve', ids: [shared.id, extra1.id], delayMs: 20 });
  await Promise.resolve(); await Promise.resolve(); // 让 first 先占用全局锁与状态
  const second = executeBatch({ idempotencyKey: key('race-b'), decision: 'approve', ids: [shared.id, extra2.id], delayMs: 20 });
  const [r1, r2] = await Promise.all([first, second]);

  assert.equal(r1.record.results.find(item => item.approvalId === shared.id)?.outcome, 'approved');
  assert.equal(r2.record.results.find(item => item.approvalId === shared.id)?.outcome, 'skipped_stale', '共享申请已被前一批处理，后批必须判定为过期');
  assert.equal(r2.record.results.find(item => item.approvalId === extra2.id)?.outcome, 'approved');
  assert.equal(approvals.find(item => item.id === shared.id)!.status, 'approved');

  const audit = listAudit({ chronological: true });
  for (const batchKey of [r1.record.key, r2.record.key]) {
    const seqRange = audit.filter(event => event.batchKey === batchKey).map(event => event.seq);
    const start = seqRange[0], finish = seqRange[seqRange.length - 1];
    for (const seq of seqRange) {
      assert.equal(audit.find(event => event.seq === seq)!.batchKey, batchKey, `批次 ${batchKey} 的审计序列 [${start}-${finish}] 内出现其他批次事件，顺序交错`);
    }
  }
});

test('超时重试：相同幂等键并发合并、完成后重放只执行一次', async () => {
  const item = seedPending('PRJ-002', 'delivery', 'DEL-RETRY', '测试-超时重试');
  const idem = key('retry');
  const input: BatchInput = { idempotencyKey: idem, decision: 'approve', ids: [item.id], delayMs: 40 };

  const inFlight = Promise.all([executeBatch(input), executeBatch(input), executeBatch(input)]);
  const results = await inFlight;
  assert.equal(results.filter(r => r.fresh).length, 1, '同键并发只有一个发起者，其余合并到运行中批次');
  assert.ok(results.filter(r => r.joined).length >= 1, '运行中合并应返回 joined（对应 HTTP 202）');

  // 模拟客户端超时后重试 / 刷新后恢复：服务端重放同一份逐项结果，不重复执行
  const replay = await executeBatch(input);
  assert.equal(replay.fresh, false);
  assert.equal(replay.joined, false, '已完成批次的重放是 200 而不是 202');
  assert.equal(replay.record.results.length, 1);
  assert.equal(replay.record.results[0].outcome, 'approved');
  assert.equal(approvals.filter(a => a.id === item.id).length, 1);
  const approves = listAudit({ chronological: true }).filter(event => event.batchKey === idem && event.action === 'APPROVE');
  assert.equal(approves.length, 1, '重放不能产生重复审计');
  const lifecycle = listAudit({ chronological: true }).filter(event => event.batchKey === idem).map(event => event.action);
  assert.deepEqual(lifecycle, ['BATCH_START', 'APPROVE', 'BATCH_FINISH']);
});

test('重复点击与重复 id：重复项被计为 duplicate 且不写执行审计', async () => {
  const item = seedPending('PRJ-001', 'delivery', 'DEL-DUP', '测试-重复');
  const { record } = await executeBatch({ idempotencyKey: key('duplicate'), decision: 'reject', ids: [item.id, item.id, item.id], delayMs: 0 });
  assert.equal(record.counts.total, 3);
  assert.equal(record.counts.rejected, 1);
  assert.equal(record.counts.duplicate, 2);
  assert.equal(approvals.find(a => a.id === item.id)!.status, 'rejected');
  const rejects = listAudit({ chronological: true }).filter(event => event.batchKey === record.key && event.action === 'REJECT');
  assert.equal(rejects.length, 1);
});

test('审计顺序：单调 seq 且全局追加，批量事件包夹逐项事件', async () => {
  const item = seedPending('PRJ-001', 'delivery', 'DEL-AUD', '测试-审计顺序');
  const { record } = await executeBatch({ idempotencyKey: key('audit-order'), decision: 'approve', ids: [item.id], delayMs: 0 });
  const events = listAudit({ chronological: true }).filter(event => event.batchKey === record.key);
  assert.deepEqual(events.map(event => event.action), ['BATCH_START', 'APPROVE', 'BATCH_FINISH']);
  const allSeq = listAudit({ chronological: true }).map(event => event.seq);
  assert.deepEqual(allSeq, [...allSeq].sort((a, b) => a - b));
  // 批次进行中插入的其他审计不会破坏 seq 单调（appendAudit 全局递增）
  appendAudit('NOTE', 'test', 'x', '外部事件');
  const last = listAudit({ chronological: true }).at(-1)!;
  assert.equal(last.action, 'NOTE');
});
