# node-red-contrib-hikvision-ultimate — notes for Claude

## Documentation: its home is www.maxsupervibe.com

Since 2026-11-26 the documentation of this project lives on Massimo's website, https://www.maxsupervibe.com/docs/hikvision-ultimate/ (English), next to the help of all his other nodes (index: https://www.maxsupervibe.com/docs/). Manage it there:

- The text is written in this repo, in docs/documentation.md (the full text). The website (repo SaccaniLiveStudioStack/SaccaniWebsite) copies it at every deploy with `scripts/sync-readme-docs.mjs`; after a change, publish it with `npm run deploy` in SaccaniWebsite and check the page on the site.
- The README stays a short introduction with the link to the site: write new documentation in the files above, not in the README.
- When linking to the documentation (README, node help, changelog, issues), use the www.maxsupervibe.com addresses, never supergiovane.github.io.
