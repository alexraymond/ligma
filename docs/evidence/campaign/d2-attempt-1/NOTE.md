# d2 attempt 1 — 2026-08-12, aborted at quota stall (error, not failed)

Chain booted clean; persona ran the full studio loop and promoted successfully
(promote→dispatch seam confirmed live: 18 tasks, all assigned to builder).
Two defects/costs observed:
1. The scenario was unbounded — persona chose an 8-screen booking app and the
   design loop ran twice (tasks.json shows two overlapping promote batches),
   burning the governor window to the reserve floor mid-chain.
2. Dispatcher + studio then deferred everything ("waiting on quota: reserve,
   retry in ~10,600s" — see daemon.log.tail); every link past d2a would have
   timed out. Aborted rather than letting three links error serially.

Fix forward: d2a-design-loop journey now pins a two-screen scenario with an
economical persona disposition. Re-run queued behind governor headroom.
