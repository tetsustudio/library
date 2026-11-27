Run `npx changeset` in every PR that changes a published package, then
`npx changeset version` before merging. The release workflow on main publishes
whatever version is not on npm yet and mirrors it to GitHub Packages.
