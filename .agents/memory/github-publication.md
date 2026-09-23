---
name: GitHub connector publication
description: Distinguishing GitHub connector API publication from authenticated Git transport
---

The workspace's GitHub connector can create repositories and GitHub Git objects through its API, but it does not necessarily authenticate `git push` over HTTPS. A repository populated through the API can contain the exact current source tree without containing the local commit history.

**Why:** A direct Git push failed authentication despite a working GitHub connector. Publishing the source through the GitHub API succeeded, but created a separate remote commit graph. Treating that as a normal Git push would mislead a future collaborator.

**How to apply:** When a user asks for GitHub publication, check Git transport separately. If it fails and the API is used instead, verify the remote tree against the local tree and clearly disclose that history and future Git CLI pushes need separate Git authentication.