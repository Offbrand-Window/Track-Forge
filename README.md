# Track Forge

Track Forge is a local macOS app for preparing MP3 files for Spotify Local Files. It can import audio you own or have permission to use, scrape tag suggestions and cover art from a Genius song page, write ID3 tags, and return a finished MP3 ready to add to Spotify.

The bundled macOS release includes its own Node runtime, yt-dlp, and ffmpeg for both Apple Silicon and Intel Macs, so users do not need to install packages before opening the app.

## Use The Bundled macOS App

1. Download `TrackForge-macOS.zip` from the latest GitHub release.
2. Double-click the zip to extract it.
3. Open `Track Forge.app`.
4. If macOS blocks it because it is not notarized, right-click `Track Forge.app`, choose **Open**, then choose **Open** again.
5. The app starts a local server and opens `http://localhost:5173` in your browser.
6. Add an audio source:
   - upload an MP3,
   - import a direct audio URL, or
   - use the YouTube/media URL form for material you have rights to download.
7. Paste a Genius lyrics URL in **Metadata source URL** and click **Scrape Metadata**.
8. Review or edit title, artist, album, year, track, genre, and artwork.
9. Click **Export Tagged MP3**.
10. In Spotify, enable **Settings > Local Files** and add the folder containing the exported MP3.

The app runs locally on your Mac. The browser UI talks to a local server launched by the app bundle.

## Run

These steps are for development from source. Most users should use the bundled release above.

```bash
corepack enable
pnpm install
pnpm start
```

Then open `http://localhost:5173`.

## YouTube/media import

Track Forge can import audio from a YouTube/media URL with local command-line tools when the user owns the content, has a license, is using public-domain or Creative Commons material, or has permission from the rightsholder.

Track Forge also includes `youtube-dl-exec` and `ffmpeg-static` as package fallbacks. If pnpm blocks their postinstall downloads, run:

```bash
pnpm approve-builds
pnpm install
```

If the tools are not on `PATH`, point Track Forge at them:

```bash
YTDLP_PATH=/path/to/yt-dlp FFMPEG_PATH=/path/to/ffmpeg pnpm start
```

`youtube-dl` is also supported:

```bash
YOUTUBE_DL_PATH=/path/to/youtube-dl FFMPEG_PATH=/path/to/ffmpeg pnpm start
```

The media import route extracts audio locally and converts it to MP3. Long sources are rejected by default after 30 minutes; adjust this with:

```bash
MEDIA_IMPORT_MAX_SECONDS=3600 pnpm start
```

If `yt-dlp` reports a local certificate verification failure, prefer installing/updating system certificates or using a Homebrew/system `yt-dlp`. As a local trusted-source workaround:

```bash
YTDLP_NO_CHECK_CERTIFICATE=1 pnpm start
```

## Workflow

1. Upload an MP3, import a direct audio URL, or use the YouTube/media URL form for a source you have rights to download.
2. Paste a Genius lyrics page URL in Tag Editor to scrape title, artist, and artwork.
3. Refine the tags or paste any direct artwork image URL.
4. Export the tagged MP3.
5. In Spotify, enable Settings > Local Files and add the folder containing the exported file.

## Scope

The app intentionally does not provide a general-purpose copyrighted music ripper. YouTube/media import requires an explicit rights basis. Spotify URLs are not accepted as import sources.

## Disclaimer

This is 100% vibecoded. I have no clue how it works. If it does not work properly, leave a comment, or see if you can fix it yourself. Good luck. 
