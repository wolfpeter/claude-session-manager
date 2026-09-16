# Pane fixtures

Captures of the visible tmux pane in the states `server/src/status.ts` has to tell apart.
The Claude Code chrome (spinner line, prompt box, question footer, trust dialog) is verbatim
from a real terminal; the conversation text in between is placeholder, because only the chrome
is matched on.

To refresh one after a Claude Code UI change:

```bash
tmux capture-pane -p -J -t '=claude-<session>:' > server/test/fixtures/pane-<state>.txt
```

Then replace the conversation text with placeholder lines and keep the chrome untouched.
