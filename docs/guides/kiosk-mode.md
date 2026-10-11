# Kiosk mode: a till or kitchen screen that is always full screen

How to start Chrome so a Sell screen or a Kitchen screen stays full screen all day.

The **Full screen** button on the Sell screen and on the Restaurant's Kitchen page uses the browser's full screen.
The browser leaves it by itself:

- when a print dialog opens
- on a page reload
- on Esc

For a screen that stays open all day, start Chrome in kiosk mode. Then nothing leaves full screen.

## Start Chrome in kiosk mode

Mac:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --kiosk --kiosk-printing \
  --no-first-run --no-default-browser-check \
  --user-data-dir="$HOME/chrome-kiosk" \
  "http://localhost:3000/pos"
```

Windows (one line, also works as a shortcut's Target):

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --no-first-run --no-default-browser-check --user-data-dir="%USERPROFILE%\chrome-kiosk" "http://localhost:3000/pos"
```

Linux:

```sh
google-chrome --kiosk --kiosk-printing --no-first-run --no-default-browser-check \
  --user-data-dir="$HOME/chrome-kiosk" "http://localhost:3000/pos"
```

Change the address to the page you want:

| Address | Page |
|---|---|
| `/pos` | The Sell screen |
| `/extensions/restaurant/kitchen` | The Kitchen |
| `/extensions/restaurant/tables` | The Tables |

On a real server, use your own address, like `https://pos.example.com/pos`.

## What each option does

| Option | What it does |
|---|---|
| `--kiosk` | Full screen with no tabs and no address bar |
| `--kiosk-printing` | Prints straight to the computer's default printer, with no print dialog. Leave it out to pick the printer each time |
| `--user-data-dir=…` | A separate Chrome with its own profile. Without it the command joins the Chrome that is already running, and the options are ignored |
| `--no-first-run`, `--no-default-browser-check` | Skips the welcome page of a new profile, which would open as a normal window |

## Good to know

- Sign in to the app once inside the kiosk Chrome. It remembers you next time.
- Set the receipt printer as the computer's default printer.
- Leave kiosk mode with Cmd+Q (Mac) or Alt+F4 (Windows).

**It opens as a normal window?**
The command joined a Chrome that was already running.

- Keep `--user-data-dir`.
- Run Chrome's program file as above. On a Mac, do not start it through `open -a`.
