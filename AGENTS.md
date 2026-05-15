# Project Collaboration Notes

- After every feature change, fix, or optimization in this project, include clickable local preview links in the final response so the user can immediately check the result on their phone.
- Use the current LAN preview server when available. For this workspace, the current phone-accessible URLs are:
  - Display page: http://172.20.10.5:8002/index.html
  - Admin page: http://172.20.10.5:8002/admin.html
- Before returning preview links, check whether the last preview server is still running and usable. If it is usable, keep using the same port instead of starting another server.
- If the last preview server is not usable, stop/clean up that old service if needed, then start the next port number. For example, keep using 8002 while it works; if 8002 fails, move to 8003.
- If the LAN IP or port changes, refresh the links before responding and update this file.
