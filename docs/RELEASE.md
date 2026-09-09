# Release Process

1. Decide the version bump (semver) for both `apps/desktop-ui/package.json` and
   `services/desktop-agent/SmartPrinter.Agent/SmartPrinter.Agent.csproj` (the agent and
   UI are versioned independently per ARCHITECTURE.md/blueprint §15, but keep them in
   step for a normal release unless you have a specific reason not to).
2. Update `CHANGELOG` entries (not scaffolded in this repo - add one if you want a
   user-facing changelog).
3. Run the full test suite:
   ```powershell
   cd services\desktop-agent
   dotnet test
   cd ..\..\apps\desktop-ui
   npm run typecheck
   ```
4. Build and sign (see [DEPLOYMENT.md](./DEPLOYMENT.md)).
5. Manually run the [First End-to-End Test](../README.md#first-end-to-end-test) on a
   clean Windows VM using the freshly built installer - not just `dotnet run`/`npm run
   dev`.
6. Run the [Manual Hardware Test Checklist](./WINDOWS-PRINTERS.md#manual-hardware-test-checklist).
7. Upload the installer + generated `latest.yml` to your release channel (`beta/` first,
   then `stable/` after a pilot period - see DEPLOYMENT.md "Release channels").
8. Tag the release in git: `git tag vX.Y.Z && git push --tags`. `.github/workflows/release.yml`
   is configured to build on tag push - review its output artifacts before promoting to
   `stable/`.
9. Monitor `device_events`/`audit_logs` and Edge Function logs in the Supabase dashboard
   for the first 24-48 hours after a stable release for any spike in errors.

## Versioning the database schema separately

Supabase migrations (`supabase/migrations/*.sql`) are applied independently of app
releases via `supabase db push` - do not couple a schema migration to an app release
unless the app release actually depends on the new schema. Prefer additive,
backward-compatible migrations (new nullable columns, new tables) that old app versions
can safely ignore, so an in-progress rollout never has a version mismatch that breaks
older, not-yet-updated shop PCs.
