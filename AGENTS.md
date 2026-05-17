# Project Collaboration Notes

- After every feature change, fix, or optimization in this project, include clickable local preview links in the final response so the user can immediately check the result on their phone.
- Use a single long-running dev server during development/testing so hot reload can update the same phone preview URL after every edit. Before starting `npm run dev`, check whether a project dev server is already listening and reuse its latest Local/LAN URLs. Do not start another dev server just to verify new changes.
- Start the dev server with `npm run dev` only when no usable project dev server is already running. It auto-detects an open port (starting at 8002) and the LAN IP, prints both URLs and a QR code at startup. Use the URLs from the running server's latest banner output for previews.
- During normal development/testing, there should be exactly one active preview port for this project. If multiple old dev servers are found, stop the stale ones and keep only one current server instead of allowing ports to keep incrementing.
- The dev server provides hot reload (HTML/CSS/JS/products.json) and local upload endpoints. Saving in `admin.html` writes to local files and (on the `test` branch only) auto-commits & pushes to `origin/test`.
- Do not hardcode IPs or ports anywhere — always pull them from the running server's banner output.
- Code changes for ongoing development happen on the `test` branch. `main` is the stable branch and is merged into only after `test` is verified.
- This service targets all mobile phone platforms. Every mobile-facing feature, fix, or optimization must account for both iOS and Android behavior, including Safari, Chrome, and common in-app browsers, and should call out any platform-specific limitations or verification gaps.
