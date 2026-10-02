import express, { type NextFunction, type Request, type Response } from 'express';
import { approvals, approve, assets, budgetLines, contracts, createApproval, dashboard, decideOne, getBatch, HttpError, listAudit, previewBatch, projectSummary, projects, createBatch, resumeBatch, rightsConflicts } from './domain.js';

const app = express();
app.use(express.json());

const wrap = (handler: (req: Request, res: Response) => unknown | Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try { await handler(req, res); } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message, code: error.code });
    next(error);
  }
};

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));

// 全局待办：跨项目批量选择的数据源（携带实体摘要、当前版本与阻断）
app.get('/api/approvals/pending', wrap((_req, res) => {
  res.json(approvals.filter(item => item.status === 'pending').map(item => previewBatch([item.id])[0]));
}));
// 批量预览：实体摘要 + 当前状态 + 版权/预算阻断（阻断执行时会重算）
app.post('/api/approvals/batch/preview', wrap((req, res) => res.json({ items: previewBatch((req.body?.ids ?? []) as string[]) })));
// 发起批量；超时/网络重试时带同一个 Idempotency-Key
app.post('/api/approvals/batch', wrap((req, res) => {
  const key = req.header('Idempotency-Key') ?? req.body?.idempotencyKey;
  if (!key) throw new HttpError(400, '缺少 Idempotency-Key', 'IDEMPOTENCY_REQUIRED');
  const { batch, replay } = createBatch({ idempotencyKey: key, decision: req.body?.decision, comment: req.body?.comment, items: req.body?.items ?? [] });
  res.status(replay ? 200 : 202).json(getBatch(batch.id));
}));
// 轮询批次结果
app.get('/api/approvals/batch/:id', wrap((req, res) => res.json(getBatch(String(req.params.id)))));
// 恢复：只重试未执行项（blocked/stale/busy/failed），已执行项原样返回
app.post('/api/approvals/batch/:id/resume', wrap((req, res) => res.status(202).json(resumeBatch(String(req.params.id), req.body?.versions ?? {}))));
app.get('/api/audits', wrap((req, res) => res.json(listAudit({ batchId: req.query.batchId as string, entityId: req.query.entityId as string }))));

app.post('/api/approvals', wrap((req, res) => res.status(201).json(createApproval(req.body))));
// 单项裁决：版本校验 + 处理中拒绝重复点击；旧客户端不带版本时按当前状态裁决
app.patch('/api/approvals/:id', wrap(async (req, res) => {
  const status = req.body?.status;
  if (status !== 'approved' && status !== 'rejected') throw new HttpError(400, 'status 只能是 approved / rejected');
  const result = await decideOne(String(req.params.id), status, req.body?.comment ?? '', req.body?.expectedVersion);
  res.json({ ...result.approval, auditId: result.auditId });
}));

// 兼容旧测试与旧客户端的无版本接口（不推荐，保留过渡）
app.post('/api/approvals/:id/legacy', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { console.error(error); res.status(500).json({ message: '服务内部错误', code: 'INTERNAL' }); });

const port = Number(process.env.PORT || 4104);
if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`film rights API listening on ${port}`));
export default app;
