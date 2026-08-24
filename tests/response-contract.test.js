const assert = require('assert');
const {
  inferExpectedImageCount,
  inferStageOutputContract,
  responseLooksDeferred,
} = require('../server').__test;

function stage(prompt, fileCount = 0) {
  return {
    prompt,
    files: Array.from({ length: fileCount }, (_, index) => `image-${index + 1}.png`),
  };
}

assert.deepStrictEqual(
  inferStageOutputContract(stage('好的，稍等，准备生图，切记开启你的逐张生成图片系统。')),
  { type: 'text', expectedImages: 0 },
);

assert.deepStrictEqual(
  inferStageOutputContract(stage('请告诉我下一轮需要什么提示词可以生成剩下的图片。')),
  { type: 'text', expectedImages: 0 },
);

assert.deepStrictEqual(
  inferStageOutputContract(stage(
    '对上传的所有产品图片进行商业精修，生成高质量产品白底图，逐张输出。',
    5,
  )),
  { type: 'images', expectedImages: 5 },
);

assert.deepStrictEqual(
  inferStageOutputContract(stage(
    '基于页面蓝图分批生成结果图。本轮生成：【图1-图10】，总共10张独立图片。',
  )),
  { type: 'images', expectedImages: 10 },
);

assert.deepStrictEqual(
  inferStageOutputContract(stage(
    '请接着逐张生成剩下的图【图11-图15】，总共5张独立图片。',
  )),
  { type: 'images', expectedImages: 5 },
);

assert.strictEqual(inferExpectedImageCount('本轮生成：【图11-图15】'), 5);
assert.strictEqual(inferExpectedImageCount('本轮生成：【图1-图10】'), 10);
assert.strictEqual(inferExpectedImageCount('逐张输出全部图片', 7), 7);

assert.strictEqual(
  responseLooksDeferred('收到，执行方式已经锁定。等待你的开始指令。'),
  true,
);
assert.strictEqual(
  responseLooksDeferred('请继续提交下一轮提示词，我会按顺序执行。'),
  true,
);
assert.strictEqual(
  responseLooksDeferred('已完成本轮全部图片生成。'),
  false,
);

console.log('response-contract tests passed');
