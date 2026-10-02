import express from 'express';
import { approve, assets, budgetLines, contracts, createApproval, dashboard, executeBatch, getBatch, listAudit, previewBatch, projectSummary, approvalQueue, projects, rightsConflicts } from './domain.js';
import type { BatchError } from './domain.js';
const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));

// 跨项目待审批队列（含实体摘要、当前状态、版权/预算阻断）
app.get('/api/approvals/queue', (_req, res) => res.json(approvalQueue()));
// 批量预览：不执行任何状态变更，供用户确认实体、阻断与最终选择
app.post('/api/approvals/batch/preview', (req, res) => {
  try { res.json(previewBatch(req.body?.ids ?? [])); }
  catch (error) { sendBatchError(res, error); }
});
// 批量执行：同幂等键合并（运行中 → 202），完成后重放返回同一结果（200）
app.post('/api/approvals/batch', async (req, res) => {
  try { const { record, joined } = await executeBatch({ idempotencyKey: req.body?.idempotencyKey, decision: req.body?.decision, ids: req.body?.ids ?? [], override: Boolean(req.body?.override), comment: req.body?.comment ?? '', delayMs: req.body?.delayMs }); res.status(joined ? 202 : 200).json(record); }
  catch (error) { sendBatchError(res, error); }
});
// 批次恢复/轮询：刷新页面后凭幂等键找回逐项结果
app.get('/api/approvals/batch/:key', (req, res) => { const record = getBatch(req.params.key); if (!record) return res.status(404).json({ message: '批次不存在或已随服务重启清空' }); res.status(record.status === 'running' ? 202 : 200).json(record); });
// 审计按 seq 顺序返回（默认新→旧，?order=asc 为发生顺序）
app.get('/api/audit', (req, res) => res.json(listAudit({ chronological: req.query.order === 'asc' })));

app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

function sendBatchError(res: express.Response, error: unknown) {
  const code = (error as BatchError)?.code ?? 'BATCH_FAILED';
  const status = code === 'OVERRIDE_REQUIRES_COMMENT' ? 422 : 400;
  res.status(status).json({ code, message: error instanceof Error ? error.message : '批量操作失败' });
}
const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
