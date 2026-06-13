In the Respawn Settings dialog, the 'Respawn now' button is currently always enabled. If the user toggles 'Enable respawn' but hasn't hit Save yet, clicking 'Respawn now' silently does nothing because `respawnItem` checks the saved `respawnEnabled` flag.

Change: disable the 'Respawn now' button when `item.respawnEnabled` is false (the saved state, not the local toggle). This forces the user to save the respawn configuration before they can trigger a manual respawn.

Scope: single file `src/components/RespawnSettingsDialog.tsx` — add `disabled={!item.respawnEnabled}` to the 'Respawn now' button.