#!/usr/bin/env node
/* global process, console */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { zeusDistribution as d } from './desktop-distribution.mjs';

// 仅显式启动的同步工作流可以写分支；本地命令只输出配置。
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== d.repository) {
  console.log(`上游：${d.upstreamRepository}；集成分支：${d.integrationBranch}。请运行 Sync upstream 工作流。`);
} else {
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (...args) => run('git', args);
  const release = JSON.parse(run('gh', ['api', `repos/${d.upstreamRepository}/releases/latest`]));
  const tag = release.tag_name;
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/u.test(tag)) throw new Error('上游最新 Release 不是稳定版本。');
  git('fetch', '--no-tags', `https://github.com/${d.upstreamRepository}.git`, `refs/tags/${tag}`);
  const upstreamSha = git('rev-parse', 'FETCH_HEAD^{commit}');
  const branch = `sync/upstream-${tag}`;
  if (git('branch', '--show-current') !== d.integrationBranch || git('status', '--porcelain')) throw new Error('同步必须从干净的集成分支开始。');
  const merged = git('merge-base', 'HEAD', upstreamSha) === upstreamSha;
  if (merged) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'changed=false\n');
    console.log('已包含上游最新稳定版。');
  } else {
    const existing = git('ls-remote', 'origin', `refs/heads/${branch}`);
    if (!existing) {
      git('config', 'user.name', 'Zeus Upstream Bot');
      git('config', 'user.email', 'actions@users.noreply.github.com');
      git('switch', '-c', branch);
      try {
        git('merge', '--no-commit', '--no-ff', upstreamSha);
      } catch {
        const conflicts = git('diff', '--name-only', '--diff-filter=U');
        git('merge', '--abort');
        throw new Error(`上游同步存在冲突，请本地解决后推送 ${branch}，不会强制选择任何一侧：\n${conflicts}`);
      }
      // 上游通常不含本发行配置；若双方修改，交由真实冲突处理，不做静默覆盖。
      mkdirSync('releases', { recursive: true });
      writeFileSync('releases/upstream-baseline.json', JSON.stringify({ repository: d.upstreamRepository, tag, commit: upstreamSha }, null, 2) + '\n');
      git('add', 'releases/upstream-baseline.json');
      git('commit', '-m', `同步上游 ${tag}`);
      git('push', 'origin', `HEAD:refs/heads/${branch}`);
    }
    mkdirSync('.tmp', { recursive: true });
    writeFileSync(
      '.tmp/upstream-pr.md',
      `同步上游 ${tag}（${upstreamSha}）。\n\n合并前运行 pnpm verify:publish，并在 Dev 验证临时会话、导航、搜索、扩展管理及更新来源。二开发行配置不得回到上游渠道。\n\n本 PR 不自动合并，不发布安装包。GITHUB_TOKEN 创建的 PR 可能不会触发其他工作流；请手动运行 CI。\n`,
    );
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=true\nbranch=${branch}\n`);
  }
}
