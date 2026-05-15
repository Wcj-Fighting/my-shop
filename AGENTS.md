# Project Collaboration Notes

- After every feature change, fix, or optimization in this project, include clickable local preview links in the final response so the user can immediately check the result on their phone.
- Start the dev server with `npm run dev`. It auto-detects an open port (starting at 8002) and the LAN IP, prints both URLs and a QR code at startup. Use the URLs from the latest server output for previews.
- The dev server provides hot reload (HTML/CSS/JS/products.json) and local upload endpoints. Saving in `admin.html` writes to local files and (on the `test` branch only) auto-commits & pushes to `origin/test`.
- Do not hardcode IPs or ports anywhere — always pull them from the running server's banner output.
- Code changes for ongoing development happen on the `test` branch. `main` is the stable branch and is merged into only after `test` is verified.
