# Marking Lab owns Scores; this app keeps its own record of every Call

Marking Lab stores Results permanently, but its API can't return them, and it has no place for latency, tokens, cost or failed Calls, so analysis needs a local record of every Call in SQLite. Scores stay with Marking Lab because Reference Marks never leave it: the app saves a copy of each Score and never calculates agreement itself, which means the two stores overlap by design and a Score can't be worked out from local data.
