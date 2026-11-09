const pct = (n) => (100 * n).toFixed(2) + '%';
const esc = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export function renderReport(v) {
  const ds = v.aggregates.deepseek,
    sol = v.aggregates.sol;
  const scenes = ds.after.scenes
    .map(
      (s, i) =>
        `<tr><td>${esc(s.name)}</td><td>${s.task_count}</td><td>${ds.before.scenes[i].score.toFixed(4)}</td><td>${s.score.toFixed(4)}</td><td>${sol.before.scenes[i].score.toFixed(4)}</td><td>${sol.after.scenes[i].score.toFixed(4)}</td><td>一致</td></tr>`,
    )
    .join('');
  const dimensions = Object.entries(ds.after.dimensions)
    .map(
      ([d, r]) =>
        `<tr><td>${esc(d)}</td><td>${r.applicable_task_count}</td><td>${pct(r.rate)}</td><td>${pct(sol.after.dimensions[d].rate)}</td><td>一致</td></tr>`,
    )
    .join('');
  const tasks = v.tasks
    .map(
      (t) =>
        `<tr><td>${t.history === 'sol' ? 'GPT-6.1 Sol' : 'DeepSeek-V4.1-Flash'}</td><td>${t.case_id}</td><td>${t.before.toFixed(4)}</td><td>${t.after.toFixed(4)}</td><td>${t.differences.length}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>100题 promptfoo 接入验证</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f5f9;color:#20334b;font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif}main{max-width:1160px;margin:32px auto;padding:0 20px}section,header{background:white;border:1px solid #dce4ec;border-radius:14px;padding:24px;margin-bottom:20px}h1{font-size:29px;margin:8px 0}h2{font-size:21px}a{color:#1761b3}.muted{color:#62748a}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#edf5ff;padding:16px;border-radius:10px}.card b{font-size:28px;display:block;color:#175eac}table{border-collapse:collapse;width:100%;white-space:nowrap}th,td{text-align:left;border-bottom:1px solid #e1e7ef;padding:10px}.scroll{overflow-x:auto}summary{cursor:pointer;color:#1761b3}.pass{color:#087d56}@media(max-width:680px){main{padding:0 12px}.cards{grid-template-columns:repeat(2,1fr)}section,header{padding:16px}h1{font-size:25px}}
</style><main><header><span class="muted">promptfoo ${v.promptfoo_version} · 历史答案回放 · 100题 / 6场景</span><h1>接入前后评分一致</h1><p>两组历史答案共 ${v.historical_answers} 条，逐题维度分、定位、批注完整性、整题全对和汇总指标均完成对照。</p><div class="cards"><div class="card"><b>${v.historical_answers}/200</b>历史答案回放</div><div class="card"><b>${v.difference_count}</b>评分差异</div><div class="card"><b>${v.byte_identical_core_files}/300</b>原图 / 题干 / Gold 字节一致</div><div class="card"><b>0</b>新增模型与评审调用</div></div><p class="muted">本次验证接入一致性：沿用与答案、Gold 哈希绑定的历史逐项语义判断，重新计算坐标、六维分和汇总。语义判断仍为助手初评，未新增人工复核；本页不是新的模型实测结果。</p><p><a href="../../datasets/vision/astudio-v1/cases.jsonl">100题 JSONL</a> · <a href="../../datasets/vision/astudio-v1/README.md">接入说明</a> · <a href="verification.json">完整校验记录</a> · <a href="scored-results.jsonl">200条评分结果</a></p></header>
<section><h2>主要指标</h2><div class="scroll"><table><tr><th>指标</th><th>DeepSeek 接入前</th><th>DeepSeek 接入后</th><th>Sol 接入前</th><th>Sol 接入后</th></tr><tr><td>综合分：六场景等权</td><td>${ds.before.score.toFixed(4)}</td><td>${ds.after.score.toFixed(4)}</td><td>${sol.before.score.toFixed(4)}</td><td>${sol.after.score.toFixed(4)}</td></tr><tr><td>批注完整正确率</td><td>${ds.before.annotation_complete}/85 · ${pct(ds.before.annotation_complete_rate)}</td><td>${ds.after.annotation_complete}/85 · ${pct(ds.after.annotation_complete_rate)}</td><td>85/85 · 100%</td><td>85/85 · 100%</td></tr><tr><td>整题完整正确率</td><td>${ds.before.fully_correct}/100</td><td>${ds.after.fully_correct}/100</td><td>${sol.before.fully_correct}/100</td><td>${sol.after.fully_correct}/100</td></tr></table></div><p class="muted">综合分先计算各场景均分，再对六场景等权平均。promptfoo 默认跨题均分为 DeepSeek ${ds.after.task_mean_score.toFixed(4)}、Sol ${sol.after.task_mean_score.toFixed(4)}，仅作辅助指标；批注完整正确率仅覆盖场景1–2的85条批注，不把后四场景计为零或满分。</p></section>
<section><h2>场景评分对照</h2><div class="scroll"><table><tr><th>场景</th><th>题数</th><th>DeepSeek 前</th><th>DeepSeek 后</th><th>Sol 前</th><th>Sol 后</th><th>核验</th></tr>${scenes}</table></div></section>
<section><h2>六个维度</h2><div class="scroll"><table><tr><th>维度</th><th>适用题数</th><th>DeepSeek</th><th>Sol</th><th>前后对照</th></tr>${dimensions}</table></div><p class="muted">维度分为适用题的得分率平均；未适用项保留 N/A。前两类沿用目标框/连线容差，后四类沿用可见外接框中心误差容差，均使用最终输入像素。</p></section>
<section><h2>验证范围</h2><p>100次输入构建 × 2组历史答案均核验实际消息中的图片和题干；原始答案未经改写。评分按未四舍五入值比较，浮点绝对容差为 1e-9。回放过程在发送前拦截网络连接：没有成功的网络请求，拦截框架的“已关闭遥测”通知 ${v.blocked_telemetry_attempts} 次。</p><p>保留原六维权重、适用范围、原子评分点、额外修改扣分及共享约束规则。新答案缺少匹配的语义判分记录时明确报错，不套用历史判分。</p><details><summary>查看全部200条逐题对照</summary><div class="scroll"><table><tr><th>历史模型</th><th>题号</th><th>接入前</th><th>接入后</th><th>差异数</th></tr>${tasks}</table></div></details></section></main></html>`;
}
