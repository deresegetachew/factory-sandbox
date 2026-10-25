# What this role reads
#
# One document per line: `path` or `path#section`, then a dash and why. The role's skill reads this list
# first and nothing else up front, so a pass does not load the whole PRD or the repo's docs. A section lets
# the role `grep -n` for it. `factory doctor` checks that every path exists. Lines starting with # are notes.

- CLAUDE.md - the project's rules
- docs/build-plan.md - the build plan: the task's section
- docs/decisions - decision records the task names
