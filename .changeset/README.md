Run `npx changeset` in every PR that changes a published package. The release
workflow turns pending changesets into a "Version packages" PR; merging it
publishes to npm (trusted publishing) and mirrors to GitHub Packages.
