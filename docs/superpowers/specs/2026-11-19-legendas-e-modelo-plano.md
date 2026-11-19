# EditorPro: integrated plan for (1) captions that match the speech and (2) the reference video as the definitive template

## 0. Baseline: what is live now
I checked the worktree directly. It is at a7f2889 (branch int-trial), which is the same commit production runs. It is not c3c7dac.

**Already fixed, so dropped from this plan (the skeptics confirmed these):**
- **Fake brief-text captions.** demoCaptions in demo.ts:600 is now behind `input.allowExampleCaptions`. Only ai.test.ts:290 passes that flag. pipeline.ts never does.
- **generateCaptions fallback.** pipeline.ts:452-459 now explains why it could not transcribe ("Não consegui transcrever… legenda inventada não serve"). It returns no ops for both null and [].
- **triedTranscription.** It is now `const transcribed = new Map<string, CaptionSegment[]>()` at pipeline.ts:251. Only successful results are cached, and they are re-mapped to the timeline after Undo or a re-run.
- **Claude set_captions without a transcript.** These are now dropped and turned into real transcription (app/api/ai/edit/route.ts:124-126). The prompt rule is at edit-system.md:175.
- **WebGPU tiny on phones.** chooseWhisper (whisper.ts:43-51) now gives phones base q8 on WASM, and tiny only when memoryGB ≤ 2. There is a mobile guard at :211, and a small HALLUCINATION regex at :137-140.

**Likely cause of Bruno's report (hypothesis, not proven):** c3c7dac was live from about 15:12 to 15:49 UTC.
- During that window, any time Whisper produced nothing in demo mode, the app inserted his own brief's words as captions, spread evenly over the audio. That gives "nothing to do with the speech" and "not his rhythm".
- **Those fake captions are saved in IndexedDB** (persist/index.ts:27-31).
- They still block automatic re-transcription, because pipeline.ts requires `captions.segments.length === 0`.
- They are still sent to Claude as if they were the transcript.
- So his saved project can still show wrong captions on today's code. A stale PWA client is less likely: sw.js only caches the hashed /_next/static files and calls skipWaiting/clients.claim.

**Still open (confirmed by measurement):**
- Phone accuracy is limited by base q8 on WASM: about 20% WER on real voices and about 35% under music.
- Nothing stops hallucinations or loops. The current regex matches none of the measured cases.
- speechLikely lets music through and drops minutes that contain under about 4.8 s of speech.
- Word times are late: onsets about +0.13-0.16 s on real speech (+0.2 s on TTS). The last word before a pause lingers into the silence.
- On-screen chunking only counts words.
- Captions drift after speed, remove_clip-ripple and move_clip ops. timemap ignores speed curves.
- The server ASR path exists (d6d4afc) but is off: Vercel has no GROQ_API_KEY or OPENAI_API_KEY. I re-checked with filter_project_envs.
- **Reference video: every gap is still open.** `zoomPunchIns: fast` (demo.ts:219), the invented transitions, the color preset heuristic, the hook copied from `textOverlays.examples[0]` (demo.ts:630), no motion measurement, no use of shot lengths in the first edit, and abrupt punch motion by default.

**Dropped or adjusted claims:**
- "sanitizeTranscript lacks a blocklist" is irrelevant: it is not on the Whisper path.
- "speech + white noise passes speechLikely" is correct behaviour, not a bug.
- remove_words removes about 0.19 s of the neighbouring word, not 0.27 s.
- The "13 chunks end on articles" count included pronouns and verbs.
- The end-time overhang is small on real speech (+0.03-0.1 s). Onset lag is the main timing issue.
- tiny/WebGPU on mobile is already gone.

## 1. Owner actions (Bruno)
**A1. GROQ_API_KEY: do today. It is the biggest single accuracy gain and needs no code.** Measured large-v3-turbo: about 5% WER on real voices, about 11% under music, almost no overhang at pauses. Phone base q8 gets about 20% and 35%.
1. Go to https://console.groq.com and sign up (Google or GitHub, no card needed).
2. Open API Keys, Create API Key, name it "editorpro", and copy the `gsk_…` value. It is shown only once.
3. In Vercel, open project **editor-pro**, then Settings, then Environment Variables. Add `GROQ_API_KEY` = `gsk_…`, mark it Sensitive, and select Production.
4. Go to Deployments, open the "…" menu on the latest production deploy, and choose Redeploy. Env changes only apply to new deploys.
5. Check it: while logged in, open https://editorpro-ia.vercel.app/api/ai/status. It should show `"transcribe":"groq"`.

The free tier is about 28.8K audio-seconds per day (confirm under console, Limits). Optionally set `GROQ_TRANSCRIBE_MODEL=whisper-large-v3`.

**A2 (optional, after phase 2 ships). Cloudflare Workers AI as a free second provider.**
1. Sign up at dash.cloudflare.com (Workers Free).
2. Copy the Account ID.
3. Go to My Profile, API Tokens, Create Token, and pick the "Workers AI" template.
4. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in Vercel and redeploy.

The free allowance is about 214 audio-minutes per day.

**A3 (optional). Deepgram nova-3 pt-BR.** Sign-up credit is $200 and does not expire. Create a key at console.deepgram.com and add `DEEPGRAM_API_KEY`. This needs the code in phase 3.

**A4. Tell Bruno what to do on his phone.** After the phase-1 deploy, open the project and tap "Refazer pela fala" when the old-caption chip appears. Also ask him when he tested and for his chat log lines: "Transcrição pulada", "falhou", "Não encontrei fala", or none.

**Without a key:** everything below still works. Captions then come from on-device base q8, which is better filtered and timed but still lower quality on phones, and the app says so.

## 2. Module ownership rules for this work
- **lib/ai (shared with the run_script/add_graphic/GLSL session).** Edit only:
  - whisper.ts, whisper.worker.ts, words.ts, analysis.ts, frames.ts
  - new files: lib/ai/vad.ts, lib/ai/asrFilter.ts, lib/ai/motion.ts, lib/ai/template.ts, lib/ai/fidelity.ts, lib/ai/legacyCaptions.ts
  - the caption and style blocks of pipeline.ts: whisperCaptions, the caption step of runFirstEdit, generateCaptions, the reference block at :324-341
  - in demo.ts: styleFromCuts, colorPresetFromStats, the planFirstEdit style steps, zoomOps/punchKeyframes
  - model.ts styleOps, features.ts emphasisZoomOps/hookOps, colormatch use
  - the analyze-reference route and prompt
  - one new section in edit-system.md, "## Vídeo modelo (definitivo) e movimento"
  - the caption and style branches of validate.ts/sanitize.ts
  - Do not touch run_script/add_graphic/GLSL code.
- **lib/engine (Keyframe.props session in animate.ts/easing.ts).** Do not edit animate.ts or easing.ts. The 'smooth'/'auto' easings are a request to that session (phase 3).
  - lib/engine/captions.ts and textDraw.ts belong to the **Biblioteca** session (CLAUDE.md: text/captions in the engine moved there). The rhythm chunker is a change request to that session, or is done in coordination with it.
- **lib/fx (custom shaders session).** Geometry effect smoothing is a phase-3 request only.
- **Contract files (types.ts, ops.ts).** Additive changes only, each with a test in ops.test.ts / ops.cuts.test.ts.
- **e2e/** belongs to QA. Pass them fixtures and specs; the main session keeps its own copies in the scratchpad.

## 3. Phase 1: ship TODAY (low risk, mostly lib/ai, no engine changes)

### 1.1 Repair captions saved before the fix (must)
- **Additive contract change.** In lib/types.ts, add `Captions.source?: 'transcription'|'manual'|'translation'` and `Captions.model?: string`, with a test in ops.test.ts.
  - Every set_captions coming from whisperCaptions sets `source: 'transcription'` and `model: label`, e.g. "Whisper base" or "Groq turbo". Translation sets 'translation'. "Nova legenda" sets 'manual'.
- **New file lib/ai/legacyCaptions.ts:** `isLegacyFakeCaptions(p): boolean`.
  - Return true when `source` is undefined and either:
    - the normalized word sequence is a prefix-cyclic repetition of `demoWordPool(p.brief)`, or of the fixed sentence "Este é um exemplo de legenda automática…", in ≥80% of words; or
    - the word timings are perfectly length-proportional with no gap ≥0.25 s anywhere (the demoCaptions signature).
- **Wiring** (pipeline.ts runFirstEdit/chatEdit gates at :259/:548 equivalents):
  - Treat legacy fake captions like empty captions, so re-transcription runs.
  - The chat shows "Estas legendas não vieram da fala (versão antiga). Refazer pela fala?" with a button that calls generateCaptions.
  - "coloque legenda" also re-transcribes when `source !== 'transcription'`.
  - summary.ts gets `captions.transcribed: boolean` (summary is shared; a 2-line change) so Claude never treats non-transcribed text as speech.
- **Tests** (vitest): a fixture project built with demoCaptions is detected; a real Whisper fixture is not; generateCaptions replaces the legacy captions.

### 1.2 Stop hallucinations and loops (must)
New file lib/ai/asrFilter.ts with `filterAsr(words: WhisperChunk[], vadRuns?: Range[]): WhisperChunk[]`, called in transcribeMedia before wordsToSegments, for both the local and server paths.
- **(a) Loop detector.** Drop any 10-word window where a 1-3-gram repeats 3 or more times. Also drop counting runs: ≥4 numeric tokens in sequence. This catches "1, 2, 3, 4, 5, 5, 6…" and "sejam gostos de sejam gostas…".
- **(b) Rate limit.** Drop spans where words per second exceed 6.5 over at least 2 s.
- **(c) Digits/punctuation.** Drop segments where 80% or more of tokens are digits or punctuation.
- **(d) Phrase blocklist.** Extend HALLUCINATION with the normalized phrases: "espero que tenham gostado", "até o próximo vídeo", "tchau tchau", "se inscreva", "legenda adriana zanotto", and a lone "e aí" segment. Drop only when VAD speech under the segment is under 50% of its length.
- **(e) VAD overlap.** Drop words whose [start,end] overlaps VAD speech by under 30%. This removes the base model's 58 junk words over music only.
- **Tests:** feed the measured outputs from the scratchpad results (tiny R_4367, C_music10, N_music_only for base and small). Expected: 0 surviving loop words, and clean speech unchanged (WER delta 0).

### 1.3 Cheap VAD plus timing correction (must)
New file lib/ai/vad.ts, pure functions, no model.
- `energyRuns(samples16k)`:
  - RMS dB over 10 ms hops.
  - Threshold `clamp(p10 + 0.3·(p90−p10), −60, −18)`.
  - Bridge gaps under 80 ms; drop islands under 50 ms.
- `refineWordTimes(chunks, runs)`:
  - lag = median(w.start − onset) over words within [onset−0.05, onset+0.45]. Clamp to [0, 0.4]; use 0 if there are fewer than 3 samples.
  - Shift every word by −lag.
  - Snap starts to an onset within ±0.15 s and ends to an offset within ±0.25 s.
  - Cap each word's end at `start + max(0.3, 0.075·chars + 0.25)` when no offset is found.
  - Keep order monotonic with a 0.06 s minimum per word. Zero-length words get `max(0.12, 0.06·chars)`.
  - On the server path the lag is about 0, which is harmless.
- **Measured on whisper-base:** start bias +0.223 → +0.015 s, end bias +0.254 → +0.005 s, words more than 0.15 s off 40 → 5. Overhang into pauses (small): max 1.63 → 0.55 s.
- **Replace the speechLikely gate** (whisper.ts:171/:221): skip a piece only when total energyRuns speech is under 0.4 s, instead of the current 8%-of-window rule (words.ts:319-320). Keep the existing speechLikely only as a tie-break for pure tones.
- **Tests:** synthetic tone bursts with known onsets, plus chunks shifted by +0.2 s. Expect |bias| < 0.03 s after refinement. Also 2 s of speech inside a 60 s piece must now be transcribed.

### 1.4 Worker and model parameters (must)
- whisper.worker.ts:69: `max_new_tokens: 400`. At 220 the cap is close to truncating speakers at 5+ words/s. Loops are now handled by asrFilter.
- whisper.ts chooseWhisper: tiny only when memoryGB ≤ 1. Keep base q8 on phones.
- frames.ts weak rule: change `cores<=4 && mobile` to `memoryGB<=3 || cores<=2`. The Pixel 7 was wrongly classed as weak, which triggers the "Pular legendas" question.

### 1.5 Server path robustness (must; this makes A1 reliable on a flaky phone uplink)
In whisper.ts transcribeOnServer:
- Retry each chunk up to 2 times with backoff (honour `retryAfter`) on 429 or 5xx.
- If a chunk still fails, transcribe **only that chunk** locally. Today one failure re-runs the whole file locally (whisper.ts:245-253).
- Concurrency 3.
- Clamp words to [0, chunkLen] before adding the offset, then force non-decreasing starts.
- Show the provider in the chat: "Legendas: alta precisão (Groq)" or "no aparelho (menos preciso)". Say that audio is sent for transcription.

### 1.6 Claude never rewrites caption text (should)
validate.ts update_caption:
- Drop `patch.text` unless mode==='chat' and the request targets that caption (`context.segmentId`) or matches /corrig|errad|troca a palavra/.
- When a text fix is allowed, keep the original word timings by token alignment (Levenshtein over tokens) instead of redistributing evenly (:525-527).

### 1.7 Honest UX (should; components/chat, small)
- Run log and reply name the real reason: skipped, failed (reason), CC off, or no speech.
- Buttons: "Tentar transcrever de novo", "Ligar CC", "Escrever manualmente".
- Fix the stale demo reply "(a transcrição foi pulada)".

### 1.8 Reference quick wins (must; deterministic, lib/ai only)
- **demo.ts styleFromCuts:** stop inventing.
  - `transitions: ['cut']`.
  - `zoomPunchIns: false` until motion is measured (phase 2).
  - Captions `{present: false}` unless measured.
  - No made-up hook.
- **demo.ts:630:** never use `textOverlays.examples` as content. The hook comes from the transcript or brief only.
- **colorPresetFromStats:** check warm/cool (r−b) before saturation.
- **runFirstEdit:** apply `matchColorOps` (colormatch.ts) before the planner or requestEdit and do not set a colorPreset. In model.ts styleOps, patch `colorPreset: 'none'` when grading, so two looks are not stacked (run B).
- **planFirstEdit:** when a reference exists, split at avgShotLength using the nearest word gap or silence (reuse the styleOps split, snapped to word boundaries). It currently produces one 15 s clip.
- **Caption style:** apply `set_caption_style` from the reference even with 0 segments, so the style is ready when transcription finishes.
- **Smooth default motion** (features.ts emphasisZoomOps :132-165, hookOps :304, demo.ts punchKeyframes/zoomOps :401-433):
  - Push-in of 1.00 → 1.06 over the whole phrase or shot, easeInOut.
  - Release over ≥0.6 s.
  - Hook: 1.12 → 1.0 over 1.2 s, easeOut.
  - Alternate push-in and push-out per shot, with ±0.01 x drift.
  - Constants: MIN_ZOOM_RAMP = 0.6 s, MAX_SMOOTH_SCALE_DELTA = 0.08.
  - Punch (≥1.12 in under 0.25 s) only when the user asks or style.motion.kind === 'punch'.
  - Target: at most 8 px of edge displacement per frame at 30 fps / 1080 wide. Today: emphasis 42 px, hook 25 px, punch 24-39 px. A 3 s push-in is 3.5 px.
- **model.ts:125:** remove `|| fast` from the zoom trigger.
- **sanitize.ts sanitizeKeyframes (AI ops only):** a scale/x/y/rotation keyframe with no easing defaults to easeInOut. When style.motion.kind is not punch/shake, stretch segments with |Δscale|/Δt > 0.25/s or a span under 0.4 s.
- **edit-system.md, new section "Vídeo modelo (definitivo) e movimento":**
  - When `style` exists it is the definitive template.
  - Copy its shot rhythm, transitions (hard cuts stay hard cuts), caption look and color. Add no hook, zoom, effects or transitions the reference does not have.
  - Default camera motion is a continuous slow push of 1.00-1.08 per shot (≥2 s, easeInOut). Every transform keyframe carries an easing.
  - No shake, zoom-punch, zoom-pulse or beat-pulse unless the reference or the user asks.
  - textOverlays.examples are style samples and must never be copied.
  - Replace :187 "keyframes rápidos", make :159-160 and the run_script zoom recipe at :126 conditional, and drop "com moderação".
- **app/api/ai/edit/route.ts first-edit task:** when `style` exists, use the "MODELO DEFINITIVO" wording instead of "gancho, zooms, cor, efeitos e transições". Make "Aplique legendas" conditional on captions existing.
- **Tests:**
  - vitest: planner output has easing on every scale keyframe, ≤ 8 px/frame unless punch, no transition kinds beyond the style's, and no colorPreset when a grade was applied.
  - Regression: a hard-cut reference produces zero zoom-in transitions.

**Phase 1 verification before the PR:**
- tsc, vitest, build.
- Playwright on my own port (section 6, tests T1-T4 and R1).
- Deploy through the integration flow, which is allowed by Bruno's PR/merge rule. Group it into one push to save Vercel deploys.

## 4. Phase 2: next 1-2 days (template fidelity and rhythm)

### 2.1 Measure the reference locally: lib/ai/motion.ts (must)
- **Sampling:** reuse the frames.ts video+canvas loop. Prefer a muted play-through at playbackRate 2-4 with requestVideoFrameCallback; it beats seeking on Android. Target about 10 fps, 108×192 grayscale; 6 fps at 72×128 on weak devices.
- **Per frame pair:**
  - Search scale s ∈ [0.97, 1.06] in 37 steps about the centre, then translation ±3 px.
  - Minimise masked mean absolute difference, masking a 12% border and the caption band.
  - Cut when the aligned residual > max(25, median + 8·MAD).
- **Per shot output:** `{start, end, zoomTotal = exp(Σ log s), panX, panY, peakOverMean, easing class from where velocity peaks, punch events (|log s| > 0.025 in one step with peak/mean > 4)}`.
  - Prototype results: exact cuts 1.2…10.8; zoom 1.12-1.16 (truth 1.15); smooth peak/mean 1.5-1.9 vs punch 13.6.
- **Caption band** (from capdetect.py): a band that is static with strong edges while the background moves. Gives region y0/y1, text color, box color/null, height, uppercase guess. Gate it on background motion (the prototype had a false positive on a static background).
- **Transitions:** dissolve = ramp of diffs over ≥3 samples; flash = luminance spike; whip = high-motion blur run. Each with duration.
- **Reference audio:** detectBeats, then cutsOnBeats ratio (±80 ms).
- **Budget:** ≤ 2 s per 60 s of reference on desktop.
- **Tests:** synthetic eased-zoom and punch clips generated in the test (canvas), plus the scratchpad reference.mp4 / punch.mp4 in Playwright.

### 2.2 Contract: `StyleProfile.template?: ReferenceTemplate` (must; additive, lib/types.ts)
```
{ shots:{start,end}[]; shotStats:{median,p10,p90};
  motion:{ mode:'static'|'smooth-push'|'push-pull'|'punch'|'pan'|'handheld'|'mixed'; avgZoomPerShot; easing; perShot:[...] };
  transitions:{kind,duration,frequency}[];
  captions?:{ region:{y0,y1}; textColor; boxColor|null; heightPx1920; uppercase?; wordsPerChunk? };
  color:{ r,g,b,sat,lum,lumSd; hist16?:number[][] }; cutsOnBeats? }
```
- Add a `StyleProfile.motion` summary as well.
- sanitizeStyleProfile clamps all of it. Stored in project.style, so it survives into later chat turns.
- Test in ops.test.ts (set_project with style.template round-trips).

### 2.3 Claude reference analysis (must)
analyze-reference route and prompt, plus StyleSchema:
- Send metrics.color, the full cuts and the template. Today route.ts:33-39 drops them.
- Send frame pairs at each cut ±0.15 s, the first and last frame of 4-6 shots, and 2 full-resolution crops of the caption band.
- Schema additions: `camera{mode, avgZoomPerShot, easing, punchOnKeyPhrases}`, transitions with frequency and duration, captions.wordsPerChunk / box / fontFamilyGuess, effects[], broll.
- Measured fields override Claude's estimates (extend route.ts:49-51 to camera, shots and color).
- Prompt: "describe only what you SEE; measured numbers are authoritative; textOverlays are style samples".

### 2.4 Strict replication (must)
- **Demo path:** new `templateOps(p, template, words?)` in lib/ai/template.ts, called by planFirstEdit and styleOps when a template exists.
  - Split at the word gap or silence nearest the next target length, cycling through the reference's shot sequence.
  - Per-shot eased move: `[{t:0, scale:1}, {t:dur, scale:avgZoomPerShot, easing:'easeInOut'}]`, alternating direction only if the reference does. Punch only at the template's frequency.
  - Transitions only as measured.
  - Caption style from the template: color, box → wordBox/background, y, size, uppercase, maxWords = wordsPerChunk.
  - colorGradeOps(matchColorGrade(ref, src)) only.
- **Claude path:**
  - Send 3-4 reference frames, labelled "Quadro do MODELO", with mode 'first'.
  - Send the pre-computed colorGrade as data and say "cor já casada".
  - Use the deterministic rules from the 1.8 prompt section.

### 2.5 Fidelity check: lib/ai/fidelity.ts (should)
- Render the result at about 2 fps with the existing review renderer at 108×192, and run the same estimators.
- Scores: shot median/p90 ratio, cuts per 10 s, transition kinds, zoomTotal and peak/mean, caption y / ΔE / box, color ΔE.
- Below 0.8: one repair round. Claude gets the concrete deltas; the demo path re-runs templateOps for the failing aspect.
- Chat line: "Fidelidade ao modelo: ritmo 92%, movimento 88%, legenda 95%, cor 90%".

### 2.6 Rhythm-aware caption chunking (must; change request to the Biblioteca session for lib/engine/captions.ts)
- `chunkCaptions(segments, opts: RhythmOpts | number)` over the flat word list. Use the cut points as break candidates.
- **Break score (lower is a better break):**
  - Hard break if the gap ≥ hardGap or the previous word ends with .!?…
  - −3 if an edit cut falls in the gap.
  - Gap ≥ pauseBreak: −(4 + 6·min(1, (gap − pauseBreak)/0.3)). Gap ≥ 0.12: −2·(gap − 0.12)/(pauseBreak − 0.12).
  - −3 after , ; : —
  - −1 if the next word starts a clause.
  - +4 after a glue word (articles, prepositions, clitics).
  - +5 between a number and its unit.
- **DP:** cost = best[i] + 0.6·(target − n)² + break score. Infeasible if over maxWords / maxChars / maxDur. +3 for a one-word orphan under 0.35 s.
- **Timing:**
  - start = max(prev.end, first.start − leadIn)
  - end = min(next.start − leadIn, last.end + tailHold)
  - close gaps under closeGap; enforce minOn.
- **Presets** (additive `CaptionStyle.rhythm?`, derived from maxWords when absent):

| Preset | maxWords | maxChars | maxDur | pauseBreak | hardGap | minOn | leadIn | tailHold | closeGap |
|---|---|---|---|---|---|---|---|---|---|
| word | 1 | 14 | 1.2 | 0.20 | 0.5 | 0.22 | 0.05 | 0.20 | 0.20 |
| punch (default) | 3 | 18 | 1.8 | 0.20 | 0.5 | 0.40 | 0.06 | 0.25 | 0.25 |
| line | 4 | 26 | 2.4 | 0.25 | 0.6 | 0.50 | 0.06 | 0.30 | 0.30 |
| phrase | 7 | 42 | 3.5 | 0.30 | 0.7 | 0.80 | 0.08 | 0.40 | 0.35 |

- **Measured with maxWords=3:** breath-group mixing 10 → 0, orphans 3 → 0, blinks 6 → 0, minimum on-screen 0.19 → 0.42 s. Prototype: scratchpad diag/captions-rhythm/rhythm.ts.
- **lib/ai side (mine):** wordsToSegments defaults become maxWords 12, maxDur 6, pauseGap 0.45, applied on refined times. Segments become phrases for SRT and for the AI.

### 2.7 Captions stay anchored to the media (must; lib/ops.ts, additive and internal)
- `retimeCaptions(before, after)`: map each word to media time through its clip using mapSourceTime (lib/engine/speed.ts, read-only use), then back through the same clip or its split descendants.
- Call it from update_clip (speed / speedCurve / speedPreset / in / reverse), remove_clip with ripple, move_clip and trim_clip.
- timemap.ts: use the curve inverse instead of the constant `c.speed`. Measured drift today: up to 14.6 s.
- **Tests** in ops.cuts.test.ts, each with drift ≤ 1 ms:

| Op | Drift today |
|---|---|
| speed 1.2 | 1.23 s |
| hero preset | 1.17 s |
| remove_clip ripple | 4.28 s |
| move_clip | 1.00 s |
| montage curve at transcription | 14.6 s |

### 2.8 Cuts robust to timing error (should)
- New op `cut_pauses {minPause}`, executed client-side with detectSilences. It replaces the "end+0.12" rule at edit-system.md:158, which clipped 0.5 s of speech across 5 of 6 cuts.
- remove_words: snap edges to the lowest-energy point within ±0.12 s; default padding 0.05.
- validate.ts and the prompt section are mine. The op itself is a contract addition plus a test.

## 5. Phase 3: later or by request
- **Cloudflare provider and TRANSCRIBE_PROVIDER=auto fallback chain** (lib/ai/server/transcribe.ts):
  - POST `…/ai/run/@cf/openai/whisper-large-v3-turbo` with `{audio: base64 wav, language: 'pt', vad_filter: true, condition_on_previous_text: false}`.
  - Map `result.segments[].words[]`.
- **Opus/WebM uploads:** WebCodecs AudioEncoder + webm-muxer, 32 kbps. About 8× smaller: a 100 s chunk drops from 3.2 MB to 0.4 MB. WAV stays as the fallback.
- **Deepgram direct browser upload** with a short-lived token route.
- **COOP/COEP credentialless** for WASM threads (base RTF 0.58 → 0.42). Needs shell/infra approval because it affects embeds and CDN imports.
- **WebGPU whisper-small/turbo on desktop only.** Phones stay on WASM because d6d4afc found WebGPU on phones hangs or returns wrong text.
- **Engine requests:** 'smooth' (smootherstep) and 'auto' (Catmull-Rom) easings once the Keyframe.props session lands.
- **Preview:**
  - Present native geometry on every rAF instead of 30 Hz (Preview.tsx:393).
  - Use transform: scale instead of CSS width/height (livePool.ts:435-441).
- **lib/fx requests:**
  - zoom-punch with an attack ≥0.12 s / release ≥0.25 s envelope.
  - beat/zoom-pulse with attack-decay.
  - shake with smooth value noise instead of floor(t·24) holds.
  - clip-local time.
  - A "push-in" effect.
- **Export:** optional motion blur on fast geometry.

## 6. Test plan
**Vitest (lib/ai, contract):**
- legacyCaptions detection.
- asrFilter on the measured hallucination outputs.
- vad refineWordTimes bias < 0.03 s.
- speechLikely replacement (2 s of speech in 60 s is kept).
- The set_captions guard (already exists) plus the update_caption text guard with timings kept.
- Captions.source set by every path.
- runFirstEdit/generateCaptions with transcribeMedia mocked to throw, abort or return []: zero set_captions, and a reply giving the reason.
- Server path: per-chunk retry and single-chunk local fallback (whisperServer.test.ts).
- Planner smoothness: easing present, ≤ 8 px/frame, no invented transitions, no stacked preset and grade.
- motion.ts on synthetic frames.
- templateOps shot distribution within ±20% of the template median.
- ops retime tests (2.7).
- Chunker tests in the Biblioteca session.

**Playwright, real PT speech** (own server, `DASH_PASSWORD=demo PORT=<p> npm start`, Pixel 7 + desktop 1440):
- **Fixtures (to give QA for e2e/fixtures):**
  - scratchpad diag/captions-src/fala.mp4 + speech.txt: Piper pt_BR-faber, 52 words, known pauses.
  - Real human MLS-pt clips from diag/whisper (R_4367 etc.).
  - Speech + music at 10 dB / 3 dB (C_music*).
  - Music only (N_music_only).
  - Reference reference.mp4 and punch.mp4 from diag/reference.
- **T1 (on-device):** WER < 25% vs speech.txt with base; caption gaps within 0.3 s of real pauses; no word of the brief in the captions.
- **T2 (server, mocked /api/ai/transcribe returning large-v3 JSON; real Groq once A1 is done):** WER < 10%; provider label shown.
- **T3 (negative cases):** CC off, "Pular legendas", HF/jsDelivr blocked, music only, Undo + re-run. Expect zero fake captions, a reason in the chat, and re-run reusing the cached transcript (same captions).
- **T4 (legacy):** inject a demoCaptions project into IndexedDB; the chip appears; "Refazer pela fala" replaces it with WER < 25%.
- **R1 (reference):** 10×1.2 s eased-zoom, hard-cut, yellow-box reference. Expect:
  - 10 ± 2 clips with median shot within 20% of 1.2 s
  - 0 non-cut transitions
  - every scale keyframe eased, with export-measured peak/mean < 3
  - no colorPreset; colorGrade present
  - caption style yellow + box at y ≈ 0.72
  - punch.mp4 as reference produces punch motion (the classifier tells them apart)
- **R2 (fidelity, phase 2):** score ≥ 0.8 on all aspects.
- **Export smoothness check** (ex.js/fa.py method): box width per frame, edge step ≤ 8 px/frame for the default motion.

## 7. Rollout order
1. **Now:** Bruno does A1 (GROQ_API_KEY). Ask him for the test time and chat log.
2. **Today, one integration push:** 1.1 legacy repair and provenance, 1.2 filters, 1.3 VAD timing, 1.4 parameters, 1.5 server robustness, 1.8 reference quick wins and smooth defaults with the prompt section. Then 1.6 and 1.7 if time allows. Run T1-T4 and R1, then deploy and ask Bruno to tap "Refazer pela fala".
3. **Checkpoint** (Bruno's rule): compare with this plan, update CLAUDE.md "Estado".
4. **Days 1-2:**
   - 2.1-2.4 motion measurement, template contract, analysis, strict replication
   - 2.7 caption retiming (contract)
   - 2.6 chunker, requested from the Biblioteca session
   - 2.5 fidelity
   - 2.8 robust cuts
5. **Phase 3** items by priority: Cloudflare fallback and Opus first, because they make the free server ASR more robust.

## Evidence locations
All under /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/diag/:
- **captions-src/:** sim.js, fala.mp4, speech.txt, result-*.json
- **whisper/:** run.mjs, gate.mjs, results/*.json, web/bench.js
- **verify-whisper/:** rerun.mjs
- **captions-rhythm/:**
  - asr/{asr.mjs, align.py, refine.py}
  - rhythm.ts
  - compare.exp.ts
- **verify-ritmo/:** mls_eval.py, cuts.py
- **reference/:** motion.py, capdetect.py, reference.mp4, punch.mp4, result_A/B/C.json
- **motion/:** math.ts, pv.js, ex.js, fa.py, exp_*.mp4

**Current code anchors (a7f2889):** whisper.ts:43-51, 137-140, 171, 211, 221, 245-254; whisper.worker.ts:69-70; words.ts:13, 51, 77; pipeline.ts:251-252, 324-341, 352, 442-466; demo.ts:194, 219, 600, 630; route.ts (edit):124-126; edit-system.md:62-63, 126, 158-160, 175, 187; types.ts:543, 560; sw.js:1-40.