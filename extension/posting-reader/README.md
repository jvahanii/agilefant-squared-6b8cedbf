# Agilefant posting reader

A small Chrome extension that reads job postings Agilefant's servers are not
allowed to see.

Jobly (jobly.fi) sits behind Cloudflare, which answers every request from
Supabase's servers with a "Just a moment…" bot check. The server therefore never
learns a Jobly posting's application deadline. The same page loads normally in
your own browser, so Agilefant asks this extension to fetch it there.

It only ever fetches `https://www.jobly.fi/…` pages, one at a time, and only
when Agilefant's import picker asks. It
is used for superusers only. LinkedIn is deliberately not included: reading it
with your signed-in session would breach LinkedIn's terms.

## Install (once)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this folder, `extension/posting-reader`.
4. Reload Agilefant.

After changing the files here, press the reload icon on the extension's card.

## If Jobly still refuses

Should Cloudflare start challenging the extension too, open any jobly.fi page in
a normal tab once, then try again: the check is passed per browser, not per
request.
