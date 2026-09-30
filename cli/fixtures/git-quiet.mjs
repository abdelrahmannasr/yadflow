// Imported FIRST by every cli/test*.mjs file, so it runs before any of them copies `process.env` (each file's
// GIT_ENV) and before any git process starts.
//
// It turns off git's automatic clean-up for every git the suite runs — the tests' own and the CLI code they
// call in-process. A recent git (2.55 on the macOS runner) may start `gc` / `git maintenance` in the
// BACKGROUND after a commit, a fetch or a received push. That job writes a lock file into the repository,
// and a test deleting its temporary repository at that moment fails with ENOTEMPTY — which is what made
// PR #297's macOS job red (the E43 capture test). Tests make tiny repositories and delete them straight
// away, so nothing is lost by never cleaning them up.
//
// Through GIT_CONFIG_PARAMETERS (the channel `git -c key=value` uses), not GIT_CONFIG_COUNT: a few tests
// set GIT_CONFIG_COUNT themselves and delete it afterwards, which would take this with it. The
// 'key=value' quoting is the form every git version reads. A value already there is kept.
const QUIET = ["'maintenance.auto=false'", "'receive.autogc=false'", "'gc.auto=0'"].join(' ');
process.env.GIT_CONFIG_PARAMETERS = [process.env.GIT_CONFIG_PARAMETERS, QUIET].filter(Boolean).join(' ');
