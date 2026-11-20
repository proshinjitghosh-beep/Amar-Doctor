Amar Doctor Pro
1) Real AI (DeepSeek, PowerShell):  $env:DEEPSEEK_API_KEY="sk-..."; node server.js   (or ANTHROPIC_API_KEY for Claude)   then open http://localhost:3000
   (Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js)
2) Without a key the AI chat still works in demo mode.
3) Video call is parked in later/video.html (server.js already has the signaling). Move it back to the root + add to NAV when ready.
4) Login (OTP 123456), payment, doctor panel, records are DEMO UIs stored in localStorage.
Never put your API key in the HTML files.
