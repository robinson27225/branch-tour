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
   - *One cemetery or category*. The API cannot list a category's members, so WikiTree Plus is asked, then each profile's categories are verified. Plus runs a day or more behind WikiTree, so the category page's own profile links are read too, a spouse who is already in the category is added, and you can name anyone else under "Also include these profiles". Biographies are included, blood relationships are worked out from ancestor lines (`src/kinship.js`), and the cemetery's position is read from its category page when WikiTree lets the page see it.
   Public, deceased profiles only. Anyone who may be living is left out. A dated list in a biography ("He married 1. … 2. …") is kept, so a spouse without a profile still appears.
2. **Narrow it** (optional): "Only people near a place" within N miles or km keeps just the people who rest nearby (`src/nearby.js`). It looks up regions first and drops the far ones whole, so only a few places need the one-per-second map lookup.
3. **Or import files** (`src/pack.js`, `src/xlsx.js`, `src/report.js`, `src/connections.js`): a WikiTree Plus export (Excel, CSV, TSV), a Genealogy Report JSON export, or saved My Connections pages.
4. **Tour** (`app.js`, `src/geo.js`, `src/sort.js`). GPS picks the nearest place with no network. The list can be limited to a distance, and people at a place sorted by birth surname (default), birth date, death date or closest relative. A place's position can be typed in, pasted, or taken from the phone at the gate. Each story offers WikiTree's own photo upload for that profile.
5. **Narrate** (`src/narrate.js`, `src/webllm.js`, `src/ollama.js`). Gemma writes each story, either in the browser with WebLLM on WebGPU (bundled in `vendor/`, weights downloaded once and kept by the browser), or through Ollama on a computer. The prompt holds only the facts of the record.
6. **Check** (`src/narrate.js`, `src/quality.js`). Every story is checked before you see it: a year, name or place that is not in the record, a count of relatives the record never states ("six" and "6" are the same count), stock phrases such as "peaceful" or "remembered as", and text that is not language at all (repeated words or lines) are all refused. A model gets three tries, each a little more careful, before the plain narration built from the record alone is used. The screen says why, and shows what the model wrote.
7. **Speak** (`src/voice.js`, optional). With your own ElevenLabs key, each story becomes audio. Clips are saved on the device, so a story can be heard with no signal. Only the story text is sent to ElevenLabs.
8. **Stories for no signal** (`src/stories.js`). A laptop running Ollama writes better stories than a phone can. "Write every story now" writes one for everyone at a place, "Save stories to a file" saves them, and "Load stories from a file" puts them on the phone. A loaded story is checked against the record again before it is used.
9. **Offline** (`sw.js`, `src/offline.js`). The service worker keeps the app available with no signal and gives up on a slow network after three seconds. Narrator → "Ready for no signal?" lists what is and is not saved on this device. On an iPhone use Safari and Add to Home Screen: other browsers there cannot keep the app for offline use.
10. **When Gemma is too much for the phone.** Loading Gemma needs a lot of memory, and an iPhone may close the page to make room. The step it was on is noted, and if the page closes during it Gemma is paused (plain stories and the voice carry on) until it is turned back on under Narrator.

Packs live in IndexedDB; stories and clips in the Cache API.

## Privacy

A pack holds the names, dates, places and relatives of a family, and the app knows where you are standing. With Gemma in the browser nothing about either is sent anywhere. The map lookup sends place names (not people) to OpenStreetMap Nominatim, and the optional voice sends the finished story text to ElevenLabs.

## Notes

- The storage names `ghost-tour` and `ghost-tour-media` come from the app's first name and are kept on purpose, so packs and saved stories survive updates.
- Gemma 3 1B is small and plain, and on some phones it is more than the browser will give it. Faithfulness to the record, not fluency, is the hard part, which is why the checks exist. Gemma through Ollama on a laptop writes cleaner stories; the stories file carries them to the phone.
- Nominatim often lacks small cemeteries. Those fall back to the town and are marked "approximate spot", unless the cemetery's category page gives its position.

## Licenses

MIT, see `LICENSE`. Bundled: WebLLM (Apache-2.0, `vendor/WEB-LLM-LICENSE.txt`) and Roboto Mono (Apache-2.0, `fonts/ROBOTO-MONO-LICENSE.txt`). Gemma is used under Google's Gemma terms and is downloaded by the user, not included. "WikiTree" and its logo belong to WikiTree.
