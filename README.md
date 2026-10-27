# Tour of the Branches

Walk a cemetery with your family tree in your pocket. Before you leave home you build a *tour pack* from [WikiTree](https://www.wikitree.com); at the cemetery GPS picks the nearest place, you tap a name, and a small open model, **Gemma**, tells that person's story using only what their WikiTree profile says. It also says how they are related to you, links back to their profile, and can read the story aloud. Everything the tour needs is on the phone, so it works with no signal.

Made for the DEV Hacktoberfest Open-Source AI Challenge, Week 4 ("Ghost in the Machine").

Plain JavaScript modules, no build step, no dependencies to install.

## Run

    npm start      # http://localhost:8080
    npm test       # unit tests, plain node:test, nothing to install

To use it on a phone, put the files on any static host over HTTPS (WebGPU and the service worker need a secure origin). The live copy runs on `apps.wikitree.com`, where the WikiTree API accepts logged-in requests from the page.

## How it works

1. **Build a pack** (`src/builder.js`). In the browser, with your WikiTree login, build from the WikiTree API:
   - *My ancestors*, with biographies;
   - *My CC7*, relatives within one to seven degrees. WikiTree's API returns at most 1,025 profiles per page and says so with a "Maximum number of profiles" status, but the next page carries on, so the builder follows the pages;
   - *One cemetery or category*. The API cannot list a category's members, so WikiTree Plus is asked, then each profile's categories are verified. Biographies are included, blood relationships are worked out from ancestor lines (`src/kinship.js`), and the cemetery's position is read from its category page.
   Public, deceased profiles only. Anyone who may be living is left out.
2. **Narrow it** (optional): "Only people near a place" within N miles or km keeps just the people who rest nearby (`src/nearby.js`). It looks up regions first and drops the far ones whole, so only a few places need the one-per-second map lookup.
3. **Or import files** (`src/pack.js`, `src/xlsx.js`, `src/report.js`, `src/connections.js`): a WikiTree Plus export (Excel, CSV, TSV), a Genealogy Report JSON export, or saved My Connections pages.
4. **Tour** (`app.js`, `src/geo.js`, `src/sort.js`). GPS picks the nearest place with no network. The list can be limited to a distance, and sorted by birth surname (default), birth date, death date or closest relative.
5. **Narrate** (`src/narrate.js`, `src/webllm.js`, `src/ollama.js`). Gemma writes each story in the browser with WebLLM on WebGPU (bundled in `vendor/`, weights downloaded once and kept by the browser), or through Ollama on the same computer. The prompt holds only the facts of the record.
6. **Check** (`src/narrate.js`, `src/quality.js`). Every story is checked before you see it: a year, name or place that is not in the record, a count of relatives the record never states, stock phrases such as "peaceful" or "remembered as", and text that is not language at all (repeated words or lines) are all refused. A refused story is replaced by a plain narration built from the record alone, and the screen says why and shows what the model wrote.
7. **Speak** (`src/voice.js`, optional). With your own ElevenLabs key, each story becomes audio. Stories and clips are saved on the device, so "Prepare this cemetery" lets a place be heard with no signal. Only the story text is sent to ElevenLabs.

Packs live in IndexedDB; stories and clips in the Cache API. The service worker keeps the app itself available offline.

## Privacy

A pack holds the names, dates, places and relatives of a family, and the app knows where you are standing. With Gemma in the browser nothing about either is sent anywhere. The map lookup sends place names (not people) to OpenStreetMap Nominatim, and the optional voice sends the finished story text to ElevenLabs.

## Notes

- The storage names `ghost-tour` and `ghost-tour-media` come from the app's first name and are kept on purpose, so packs and saved stories survive updates.
- Gemma 3 1B is small and plain. Faithfulness to the record, not fluency, is the hard part, which is why the checks exist.
- Nominatim often lacks small cemeteries. Those fall back to the town and are marked "approximate spot", unless the cemetery's category page gives its position.

## Licenses

MIT, see `LICENSE`. Bundled: WebLLM (Apache-2.0, `vendor/WEB-LLM-LICENSE.txt`) and Roboto Mono (Apache-2.0, `fonts/ROBOTO-MONO-LICENSE.txt`). Gemma is used under Google's Gemma terms and is downloaded by the user, not included. "WikiTree" and its logo belong to WikiTree.
