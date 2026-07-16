# Releasing

The five public packages are versioned as one fixed group and are published to
the public npm registry. Feature branches never publish packages.

## First release bootstrap

The first release must create the npm package pages before Trusted Publishing
can be configured.

1. Join the npm `datafe` organization with a role that can publish public
   packages, enable 2FA, and accept the organization invitation.
2. Merge the repository release configuration to `main`. The Release workflow
   creates a **Version Packages** pull request that changes all package versions
   from `0.0.0` to `0.1.0`.
3. Review and merge that Version Packages pull request, then use a clean and
   up-to-date `main` checkout.
4. Authenticate directly against the public npm registry:

   ```sh
   npm login --registry=https://registry.npmjs.org/ --auth-type=web
   npm whoami --registry=https://registry.npmjs.org/
   ```

5. Validate and publish the initial `0.1.0` packages:

   ```sh
   pnpm install --frozen-lockfile
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm check:pack
   pnpm -r publish --access public
   ```

   Each package pins `publishConfig.registry` to the public npm registry, so a
   local mirror configuration cannot redirect publishing.

6. Confirm that all five packages are public:

   ```sh
   npm view @datafe/markdown-chart version --registry=https://registry.npmjs.org/
   npm view @datafe/markdown-chart-echarts version --registry=https://registry.npmjs.org/
   npm view @datafe/markdown-chart-markdown-it version --registry=https://registry.npmjs.org/
   npm view @datafe/markdown-chart-react version --registry=https://registry.npmjs.org/
   npm view @datafe/markdown-chart-vue version --registry=https://registry.npmjs.org/
   ```

## Enable Trusted Publishing

After the first release, open **Settings → Trusted Publisher** on each of the
five npm package pages and configure:

- Provider: GitHub Actions
- Organization or user: `datafe`
- Repository: `markdown-chart`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`
- Environment: leave empty

The workflow uses GitHub OIDC and does not require an `NPM_TOKEN` secret. Run
the Release workflow manually once after all five package settings are saved;
it should complete without publishing an unchanged version.

## Regular releases

1. Run `pnpm changeset` in every pull request that changes a published package.
   Select the appropriate patch, minor, or major impact and write a
   consumer-facing summary. Repository-only changes do not need a changeset.
2. Merge normal pull requests into `main`. The Release workflow creates or
   updates a **Version Packages** pull request.
3. Review and merge the Version Packages pull request. The next Release run
   publishes every unpublished package version and creates the corresponding
   Git tags and GitHub Releases.

npm versions are immutable. If a release is wrong, publish a corrected patch;
do not attempt to overwrite an existing version.
