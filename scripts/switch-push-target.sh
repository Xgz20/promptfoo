#!/usr/bin/env bash
# AStudio 视觉评测工程的双远端配置。
# 当前开发分支始终从公司 Gitee 拉取，参数控制 origin 的推送地址。
set -euo pipefail

usage() {
  cat <<'EOF'
用法
  bash scripts/switch-push-target.sh both
  bash scripts/switch-push-target.sh gitee
  bash scripts/switch-push-target.sh github
  bash scripts/switch-push-target.sh both --dry-run

选项
  --branch <分支>  为指定的本地开发分支配置上游
  --dry-run        展示配置计划
  -h, --help       显示帮助

GITEE_URL 和 GITHUB_URL 可通过环境变量覆盖已有地址。
所有模式均保留 origin 的公司 Gitee 拉取地址。
EOF
}

fail() {
  echo "$*" >&2
  exit 1
}

TARGET=""
BRANCH=""
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    both | gitee | github)
      [ -z "$TARGET" ] || fail "每次只能指定一个推送目标"
      TARGET="$1"
      shift
      ;;
    --branch)
      [ "$#" -ge 2 ] || fail "--branch 需要分支名"
      BRANCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "未知参数 $1" ;;
  esac
done
if [ -z "$TARGET" ]; then
  usage >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "请在 Git 工程中执行"
cd "$REPO_ROOT"
if [ -z "$BRANCH" ]; then
  BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || fail "请用 --branch 指定本地开发分支"
fi
git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || fail "分支名无效"
case "$BRANCH" in
  main | master) fail "请切换到开发分支，或通过 --branch 指定开发分支" ;;
esac
git show-ref --verify --quiet "refs/heads/$BRANCH" || fail "本地开发分支不存在 $BRANCH"

GITEE_URL="${GITEE_URL:-$(git config --get astudiovisioneval.gitee-url || true)}"
GITHUB_URL="${GITHUB_URL:-$(git config --get remote.github.url || true)}"
if [ -z "$GITEE_URL" ]; then
  GITEE_URL="$(git config --get remote.origin.url || true)"
fi
if [ -z "$GITHUB_URL" ]; then
  GITHUB_URL="$(git config --get astudiovisioneval.github-url || true)"
fi
[ -n "$GITEE_URL" ] || fail "请通过 GITEE_URL 提供公司仓库地址"
[ -n "$GITHUB_URL" ] || fail "请通过 GITHUB_URL 提供个人 GitHub 仓库地址"
[ "$GITEE_URL" != "$GITHUB_URL" ] || fail "两个目标需要使用不同仓库地址"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "开发分支 $BRANCH"
  echo "拉取远端 origin，地址 $GITEE_URL"
  case "$TARGET" in
    both) echo "推送目标 $GITEE_URL 和 $GITHUB_URL" ;;
    gitee) echo "推送目标 $GITEE_URL" ;;
    github) echo "推送目标 $GITHUB_URL" ;;
  esac
  exit 0
fi

# 使用 Git 的配置锁，将一次切换作为一个原子配置更新发布。
CONFIG_PATH="$(git rev-parse --git-path config)"
CONFIG_LOCK="${CONFIG_PATH}.lock"
(
  set -o noclobber
  : > "$CONFIG_LOCK"
) 2>/dev/null || fail "Git 配置正在被其他进程使用，请稍后重试"
cleanup_config_lock() {
  [ ! -f "$CONFIG_LOCK" ] || unlink "$CONFIG_LOCK"
  [ ! -f "${CONFIG_LOCK}.lock" ] || unlink "${CONFIG_LOCK}.lock"
}
trap cleanup_config_lock EXIT
cp -p "$CONFIG_PATH" "$CONFIG_LOCK"

config_set() {
  git config --file "$CONFIG_LOCK" --replace-all "$1" "$2"
}

config_set remote.origin.url "$GITEE_URL"
config_set remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
config_set remote.github.url "$GITHUB_URL"
config_set remote.github.fetch '+refs/heads/*:refs/remotes/github/*'
config_set remote.github.pushurl "$GITHUB_URL"
config_set astudiovisioneval.gitee-url "$GITEE_URL"
config_set astudiovisioneval.github-url "$GITHUB_URL"
config_set astudiovisioneval.push-target "$TARGET"
config_set "branch.${BRANCH}.remote" origin
config_set "branch.${BRANCH}.merge" "refs/heads/$BRANCH"
config_set "branch.${BRANCH}.pushRemote" origin
config_set push.default simple

case "$TARGET" in
  both)
    config_set remote.origin.pushurl "$GITEE_URL"
    git config --file "$CONFIG_LOCK" --add remote.origin.pushurl "$GITHUB_URL"
    ;;
  gitee) config_set remote.origin.pushurl "$GITEE_URL" ;;
  github) config_set remote.origin.pushurl "$GITHUB_URL" ;;
esac
mv "$CONFIG_LOCK" "$CONFIG_PATH"

echo "已配置开发分支 ${BRANCH}，推送模式 $TARGET"
echo "拉取地址 $(git remote get-url origin)"
echo "推送地址"
git remote get-url --push --all origin | sed 's/^/  /'
echo "默认拉取上游 origin/$BRANCH"
