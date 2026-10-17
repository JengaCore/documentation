# documentation

Instructions for AI coding agents working in this repository.

## Supply-chain safety for AI agents and people

In September and October 2026 forged commits were force-pushed to `main` of
several JengaCore repositories. Each hid an obfuscated loader in a build
config file (`next.config.*`, `eslint.config.*`), behind a long run of
spaces after the default export. Running the repository (`install`, `dev`,
`build`, `lint`, `test`) executed it, stole credentials and installed an
implant (incident ROAD-765, Probo FND-053). An AI agent helped it run once,
by regenerating a lockfile to "fix" CI for a dependency nobody had asked
for. These rules apply to every agent and every person working here.

- **Look before you run.** Before the first install, build, dev server,
  lint or test run in a checkout, check the config files for hidden code:
  any line over 1000 characters, code after a long run of spaces,
  `createRequire`, `child_process`, `eval` or `new Function` in a config,
  arrays of encoded strings. Also check `git log` for commits on `main` that
  no pull request contains. If you find any of these, stop: run nothing in
  that checkout and report it.
- **Obfuscated code is an incident, not a lint error.** Do not decode it by
  running it, do not "clean it up" quietly, do not push a fix before a
  person has been told. Report the file, the commit, its author and the
  pusher.
- **No unexplained dependencies.** Never add a dependency, or regenerate a
  lockfile to accept one, to make CI pass. If a dependency appears that no
  change explains (for example `axios` in a repository that does not use
  it), treat it as part of an attack and ask.
- **History is not rewritten on shared branches.** Never force-push `main`
  or a release branch, and never run `git push --force` for someone else.
  A force push to `main` by anyone is an incident.
- **Secrets stay out of reach.** Do not read, print or copy kubeconfigs,
  tokens, `.env` files or SSH keys unless the task needs that exact secret.
  Never paste a secret into a prompt, a commit, a log or a ticket.
- **Indicators to report at once:** `~/.vs_cache`, `unixkernalloader`,
  `main.vbs`, a `node` process talking to `api.trongrid.io`, BNB Smart Chain
  RPC endpoints or jsonkeeper.com. The read-only check is
  `scripts/check-compromise.sh` in JengaCore/coder-workspace.
