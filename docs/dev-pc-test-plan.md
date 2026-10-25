# Factory test plan for a Claude session on dev-pc (start from the alpha release)

You are a Claude Code session on the owner's dev-pc. Run this plan against this repo (`deresegetachew/factory-sandbox`,
a throwaway project with the software factory installed) and write down exactly what happens. The goal is to find out
whether the factory works end to end on a real machine, and what it costs in tokens. Do not fix the factory here: record
each problem; the owner turns them into issues in `deresegetachew/my-skills`.

## Rules for you
- Never push to `main`, never force-push, never print or commit a secret, never edit anything under `.claude/`, `CLAUDE.md`.
- Do not change the plan's steps to make them pass. If a step fails, record it, then carry on with the next step.
- Record numbers as the tools print them. Do not estimate or invent any.
- Work in a fresh clone: `git clone https://github.com/deresegetachew/factory-sandbox && cd factory-sandbox && git checkout alpha-test`.

## Talking to the dev manager
The dev manager (a Claude session in the cloud, which wrote this plan) will read messages from you. Issue #6 in this repo is the channel.
- A question, a blocker or an interim report: comment on issue #6 with a first line `<!-- factory-question -->` or `<!-- factory-report -->`, and name the plan step you are on.
- Check issue #6 for a comment starting `<!-- factory-answer -->` at the start of each step and whenever you are stuck.
- The dev manager does not watch live. Do not wait for an answer unless you are fully blocked: record the problem and go on to the next step.
- If you can message other Claude sessions on your machine, you may also try a message to the name `claude-5b`; do not rely on it.
- Do not paste secrets, tokens or the contents of `~/.claude.json` in the channel.

## What was already found on a cloud machine (do not re-report, but say whether dev-pc is different)
1. A clone of an empty repo has no `origin/main`, so the loop crashed with a traceback. Check: `git branch -r` shows `origin/main`.
2. Claude Code ignored the allow list because the folder was not trusted. Check: does a headless run print
   "Ignoring ... permissions.allow entries ... has not been trusted"?
3. A headless `claude -p` run stopped to ask for approval of edits and chained shell commands. Check: does your normal
   permission setup on dev-pc let the loop edit files and run `python3 tests/test_textkit.py` without a prompt?
4. The reviewer subagent could not run Bash, and the PR gate hook errored on `gh` (no GraphQL in that cloud box).
   Check: do both work on dev-pc?

## Step A: install the factory from the alpha release (this branch has no factory in it)
This branch, `alpha-test`, is the sandbox project without the factory. Install `v0.1.0-alpha.1` of my-skills the way a
project would. If the release does not exist yet (`gh release view v0.1.0-alpha.1 -R deresegetachew/my-skills` fails),
stop and tell the owner: the tag `v0.1.0-alpha.1` on my-skills has not been pushed.
```
git clone https://github.com/deresegetachew/factory-sandbox && cd factory-sandbox && git checkout alpha-test
git config --add remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin
mkdir -p /tmp/alpha && cd /tmp/alpha
gh release download v0.1.0-alpha.1 -R deresegetachew/my-skills -p 'software-factory-*.tar.gz' -p SHA256SUMS
sha256sum -c SHA256SUMS && tar xzf software-factory-*.tar.gz && cd -
python3 /tmp/alpha/software-factory-0.1.0-alpha.1/hooks/factory_release.py update --release
./factory version && ./factory releases && ./factory doctor
```
Record every command's output. Then set the project up: `./factory settings set tasks.source issues`, `./factory settings set mainBranch alpha-test`,
`./factory settings set commands.test "python3 tests/test_textkit.py"` and blank the other `commands.*`; run `./factory issues setup`.
(If a `settings set` name is wrong, use `./factory settings list` and record that the name was not what the plan said.)
Commit the install on a branch `install-alpha` and push it; open a PR into `alpha-test` and leave it for the owner.
Record anything that was hard, unclear, or needed a workaround: that is the most valuable finding of this step.
Issues #1 to #3 already exist in the repo and carry `factory:ready` once `factory issues setup` has made the labels (add the label yourself if it is missing: `gh issue edit N --add-label factory:ready`).
All pull requests from now on go into `alpha-test`, not `main`.

## Step 0: machine report (read-only)
Run `./factory doctor` and paste the whole output. Also: `claude --version`, `gh auth status`, `python3 --version`,
`docker --version`, `git branch -r`, and the value of `permissions.defaultMode` in `~/.claude/settings.json` if it exists
(do not paste anything else from that file).

## Step 1: dry runs (no tokens, nothing written)
```
./factory coding-agent taytu loop --once --dry-run
./factory dev-manager loop --once --dry-run
./factory product-owner loop --once --dry-run
./factory next
./factory issues
```
Record each output. Expected: the coding agent would take issue 1; `factory next` says it does not claim.

## Step 2: one coding-agent task, with tokens measured
Issue #1 asks for `truncate(text, n)`. Decision for the open question (the dev manager took the simplest option; the owner can change it): for `n <= 0` return an empty string and add a test.
Post that decision as a comment on issue #1 first (`gh issue comment 1 --body "Decision: n <= 0 returns an empty string, with a test."`).
Then run:
```
./factory coding-agent taytu loop --once
./factory usage
```
Record: the full terminal output (trim long tool output to the last 60 lines), how long it took, whether it stopped to
ask anything (quote the question), the PR it opened (number, branch, whether `Closes #1` is in the body, whether the tests
were committed before the implementation), and the `factory usage` table (replies, fresh input, cache read, output,
cache hit). Say which model each role used (`factory doctor` prints it).

## Step 3: the manager and CI
1. Wait for CI on that PR with `./factory wait ci <pr>`; note how long and whether it passed. Record whether a check run exists at all.
2. Run `./factory dev-manager loop --once`. Record what it did with the PR: reviewed, approved, merged, or asked the owner.
3. Run `./factory usage --by role` and record it.

## Step 4: the product owner
Run `./factory product-owner loop --once`. Record what it did (for example: triaged the queue, proposed issues, edited
the PRD) and its token use from `./factory usage --by role`. Do not approve anything it proposes; leave that to the owner.

## Step 5: token-saving checks
For the PR from step 2, record from its comments and from `./factory usage --task 1 --markdown` whether the task's tokens
were posted. Then answer from what you saw, with evidence (a line of output each), not opinion:
- Was check output quiet (long test output cut to a few lines)?
- Did the reviewer re-review only what changed after a fix (if there was a fix round)?
- Did any wait (CI, merge) happen without model tokens (`./factory wait` prints no model calls)?
- Was the lessons file read or written (`.claude/factory/lessons.md`)?
- Cache hit percentage per task, and which role used the most fresh input tokens.

## Step 6: report
Create a branch `report/dev-pc-<date>` and add `docs/test-results/dev-pc-<date>.md` with: the machine report, each step
(command, result, pass or fail, one line on why), the token table, every problem as `{command, what happened, what you
expected, the exact message}`, and a ranked list of the five things most worth fixing. Push the branch and open a PR
titled `Test results: dev-pc <date>` (`gh pr create`); do not merge it. Reply in the chat with the PR link and the ranked list.
