# Changesets

Run `pnpm changeset` for every pull request that changes a published package.
Choose the highest SemVer impact introduced by the pull request and write a
consumer-facing summary. Documentation-only and repository-maintenance changes
do not require a changeset.

All five `@datafe/markdown-chart*` packages are a fixed group and therefore
share one version. The release workflow turns accumulated changesets into a
Version Packages pull request and publishes after that pull request is merged.
