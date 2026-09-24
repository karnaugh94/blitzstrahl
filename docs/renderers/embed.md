# `embed` renderer

A live web page on a slide, in a frame. The body is YAML:

````markdown
```embed {@1}
src: https://example.com/dashboard
fallback: ./dashboard.png
zoom: 0.8
```
````

A bare URL is enough when you need nothing else:

````markdown
```embed
https://example.com
```
````

| Key | Type | Default | Meaning |
|---|---|---|---|
| `src` | URL | *required* | The page to show. Must start `http://` or `https://` |
| `fallback` | path or URL | — | An image shown instead when the computer is offline, e.g. a screenshot of the page |
| `zoom` | number | `1` | Scale the page. `0.8` shows it at 80%, so more of it fits |
| `title` | string | the site's host | The frame's accessible name |

**Size.** Like a chart, an embed fills the slide's width and is
`--blitz-block-height` tall. Set `height=` or `style=` on the fence to
change it.

**Loading.** The page loads when its slide is entered (or when its step is
reached), and is unloaded when you leave the slide, so it starts fresh on
every visit. A slow site shows "Loading…" until it arrives.

## Limits

Be ready for these before you're in front of a room.

- **Many sites refuse to be framed.** A site can forbid it with the
  `X-Frame-Options` header or the CSP `frame-ancestors` directive, and most
  large sites do. The frame then shows the browser's error page, and the
  deck can't detect that. `blitzstrahl check` asks every embedded site
  ahead of time and warns about the ones that refuse. For those, take a
  screenshot and use an image instead.
- **Embeds need the network**, including in a single-file (`--standalone`)
  build. `fallback` covers being offline. It can't cover a site that's down
  or slow.
- **A clicked frame keeps the keyboard.** When you click into an embedded
  page, your key presses (and a clicker's) go to that page, not the deck.
  Click the slide outside the frame to take them back.
- In a PDF (`blitzstrahl export`), the frame shows the page as it loaded at
  export time. `fallback` isn't used there unless the computer is offline.
