# AStudio 视觉评测工程的 Git 远端配置

本地工程位于 `/Users/gzx/Project/WorkProgram/xingchen/astroncode/dev/astudio-vision-eval`，开发分支为 `feature/astudio-vision-eval`。

| 远端   | 地址                                                                                    | 用途                                     |
| ------ | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| origin | `ssh://git@code.iflytek.com:30004/CYXH_Agent/AstronStudio-Eval/astudio-vision-eval.git` | 开发分支默认拉取来源，按模式配置推送地址 |
| github | `https://github.com/Xgz20/promptfoo.git`                                                | 沿用现有个人 Promptfoo fork              |

工程最初基于 Promptfoo main 的 `715e929298130cc32a6eab895f056ac32d0f15b4` 创建，开发分支由本地 main 拉出。首次推送前，本地 main 和开发分支已同步官方上游至 `414645ff0f8b52ad78bc427f9d5ca2ec23bd3725`。本地 main 用于保存官方基线，并跟踪个人 fork 的 `github/main`。项目定制在开发分支进行。

## 提交身份

当前用户已确认本项目的提交邮箱为 `xqzhou9@iflytek.com`。为该用户代为提交时，使用此邮箱，配置仅作用于本仓库；其他协作者使用本人在公司 Git 平台登记的邮箱。

```bash
git config --local user.email 'xqzhou9@iflytek.com'
git config --local --get user.email
```

公司仓库的远端 hook 会校验提交邮箱。若返回“未通过Commit邮箱校验”，检查待推送提交的作者和提交者邮箱；修改 `user.email` 只影响后续新提交，不会更改已有提交。

```bash
git show -s --format='Author: %an <%ae>%nCommitter: %cn <%ce>' HEAD
```

## 切换推送目标

从工程任意子目录执行脚本均可，以下命令以工程根目录为例。

```bash
# 默认模式，git push 和 IDE 的 origin 推送使用两个目标
bash scripts/switch-push-target.sh both

# 仅向公司 Gitee 推送
bash scripts/switch-push-target.sh gitee

# 仅向个人 GitHub 推送
bash scripts/switch-push-target.sh github

# 查看切换计划
bash scripts/switch-push-target.sh both --dry-run
```

三个模式均保留 `origin` 的 Gitee SSH 拉取地址，并将指定开发分支的 pull 上游设置为 `origin/feature/astudio-vision-eval`。`github` 模式的参数控制推送目标，日常 `git pull` 仍使用公司 Gitee。

`both` 使用 Git 原生的多个 `pushurl`。两个推送依次执行，各自返回状态。如果一个目标失败，应查看两个仓库的分支状态，再针对失败目标补推。

脚本只更新仓库本地配置，网络传输通过后续的 Git 命令执行。`--dry-run` 展示计划。配置更新使用 Git 配置锁与原子替换，脚本会拒绝将 main 或 master 作为待配置的开发分支。

## 克隆后的首次配置

Git 远端设置属于各个本地克隆。团队成员首次克隆公司仓库后，可指定自己的 GitHub fork。

```bash
GITEE_URL='ssh://git@code.iflytek.com:30004/CYXH_Agent/AstronStudio-Eval/astudio-vision-eval.git' \
GITHUB_URL='https://github.com/Xgz20/promptfoo.git' \
  bash scripts/switch-push-target.sh both
```

默认使用当前分支，可以通过 `--branch feature/astudio-vision-eval` 配置已有的指定本地分支。

## 初始化远程开发分支

公司仓库初始化时为空，首次实际推送后即可直接拉取开发分支。先提交需要同步的项目定制，再执行以下命令。

```bash
git push origin feature/astudio-vision-eval
git fetch origin
git pull --ff-only
```

在 both 模式下，第一条命令会依次推送到 Gitee 与 GitHub。检查当前配置可使用以下命令。

```bash
git remote -v
git remote get-url --push --all origin
git config --get branch.feature/astudio-vision-eval.remote
git config --get branch.feature/astudio-vision-eval.merge
```

## 后续同步 Promptfoo 上游

当前保留两个命名远端。需要同步官方上游时，可以按 URL 拉取 main，再检查并快进本地基线。

```bash
git fetch https://github.com/promptfoo/promptfoo.git main
git switch main
git merge --ff-only FETCH_HEAD
git switch feature/astudio-vision-eval
git merge main -m "chore(upstream): 同步 Promptfoo 上游更新"
```

main 用于保存官方基线，开发分支承载项目定制。同步上游后再验证开发分支中的评测数据、配置和脚本。
