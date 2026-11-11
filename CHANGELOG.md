# Changes

## 0.70 (November 2026)

- **Import more files:** drag almost any document onto the binder or use Import… on the Projects page.
  PDF (free reader on your computer; scanned pages or every page read by an AI model with a word check),
  Word (.docx), old Word (.doc, Word 97–2003), PowerPoint (.pptx: one document per slide or one document;
  titles, bullet points, tables, pictures, speaker notes), OpenDocument text (.odt), OpenDocument slides (.odp),
  Excel (.xlsx), OpenDocument spreadsheet (.ods), saved web pages (.html), Rich Text (.rtf),
  photos of notes (.jpg / .png / .webp), and iPhone photos (.heic).
  One document or one per heading/slide/sheet — your choice; originals kept and openable from the right-click menu.
  **Stop** keeps the pages already read; **Carry on importing** resumes a stopped PDF from the next page;
  **PDF page range**; imports run in the background — several at once, while you keep writing.
- **Export to Word and OpenDocument:** export a document, folder or project as **.docx** or **.odt**.
  Normal or manuscript layout (double-spaced, indented first lines, scene breaks, header with your name and page number),
  font choice, tables, pictures, optional title page. Tested in Microsoft Word 365.
- **Print and Export to PDF** for a document, folder or project, through your system's print dialog.
  One **Export…** item on the right-click menu opens the full Export dialog.
- **AI-generated pictures (B5):** the **Pictures** button in the top bar opens the Pictures window;
  `/image` in a document inserts a picture at the cursor; `/image` in the chat adds one to the conversation.
  Set a **picture style** per project (watercolour, pencil sketch, oil painting, photo… or your own);
  shown and changeable in every request.
- **Voice — dictation and read-aloud (B6):** a microphone button in the editor and every text box
  (the browser's free dictation, or AI dictation). **Read aloud** reads a selection, a document, chat messages
  or AI replies with the computer's voices or an AI voice. **Talk** switch in the chat: speak a message,
  hear the reply, then Kalamo listens again.
- **Version history (B14):** Kalamo saves a version automatically every 10 minutes while you write, when you
  switch documents, before an AI change and before Replace all. **Save a version** with a note at any time.
  The **History** window shows what changed and lets you restore; it floats so you can keep writing.
- **Reworked first run:** the setup wizard now asks first — guided setup or look around yourself.
  The guided path explains what the AI service is and sets a few key settings, ending with a numbered map of
  the screen. The wizard's last page offers to create a desktop shortcut.
- **One-click downloads:** this release and every future one also publishes the downloads without the version
  number in the name, so the README can always link to the newest file.
- **App icon and shortcuts:** Kalamo now has its own icon on every platform.
  Settings → **Create a desktop shortcut** adds it to the Windows desktop and Start menu, the Mac Applications
  folder, or the Linux desktop and application menu. The Mac download includes **Kalamo Bhala.app**.
- **Spelling — Show me fixed:** "Show me" in Spelling settings now shows the steps to follow in the browser
  you are using, with a **Copy address** button and a link to the guide section "Spell check in another language"
  (Chrome 157+ can no longer open its own settings pages from outside the browser).
- **Editor improvements:** paste text with pictures (from Word or some websites); merged table cells
  (Merge / Split); more than one line per cell (Enter); picture size (25 / 50 / 75 / 100 % or drag the corner);
  draggable borders between the binder, the editor, the split-view panes and the chat.
  Split view — **Insert at cursor** or **Append** puts the right-hand document into yours as one undo step.
- **Chat improvements:** search the open project (a switch sends only the passages that share words with your
  message — word search on your computer, no AI, no cost); saved prompts in the chat's `/` list;
  a prompt with its own model sends that one message on that model.
- **Worksheet wizard — Fill every empty section (B19):** lists the empty sections and the estimated cost,
  asks for a budget and a request limit, then writes them in order, pausing after each one for you to
  accept, edit, discard or stop.
- API keys are verified by an automated test to never appear in the library, backups, exports or what the browser is sent.

## 0.63 (November 2026)

- **Tables:** the ▦ button inserts a table; inside it, add or delete rows and columns; Tab moves between cells.
  Saved as ordinary Markdown tables.
- **Pictures:** the 🖼 button adds a picture (PNG, JPEG, GIF, WebP or SVG). It is kept in the project's *images* folder
  and included in backups and whole-project ZIP exports.
- **Four example projects:** schoolwork (Grade 8), university study (BA Psychology), a novel (*Salt and Signal*) and
  office documents (*Harbourside Logistics*: a report, meeting notes, a letter, a memo, a proposal). A new install
  starts with all four; **Examples…** on the Projects page adds one again. Your existing projects are not touched.
- **New here:** right-click a folder or the project → *New document here…* / *New folder here…*.
- Saving is more robust on Windows when another program (antivirus, OneDrive) briefly holds a file.

## 0.54 (November 2026)

- **Mac and Linux:** downloads for Mac (Apple Silicon and Intel) and Linux (x64 and ARM64), with Python included, like
  the Windows one. They pass every automated test on real Mac and Linux machines; no writer has used them yet.
- **Updates:** the weekly check works on every system; **Download and install** now works on Mac too. On Linux the
  pop-up opens the download page for now (one-click install there follows once it has been tested on Linux).
- **Your own browser:** Kalamo opens in your default browser, whichever it is (it no longer picks Chrome or Edge for
  you). Brave, Vivaldi and Opera are recognised, and Spelling → **Show me** opens their own language settings.

## 0.53 (November 2026)

- **New versions, automatically:** once a week Kalamo checks whether a new version is out (one small file from GitHub;
  nothing about you or your writing is sent). A pop-up tells you what is new, with **Download and install**: Kalamo
  downloads it, checks it, unzips it next to your current folder and **restarts** in the new version in the same tab.
  Afterwards it offers to delete the old folder. **Remind me next week** hides the pop-up for a week.
- Settings → *About and reset*: switch the weekly check on or off, or **Check now**.

## 0.52 (November 2026)

- **Setup wizard** at the first start (and from Settings): import your Raptor Write full backup, or separate collection,
  prompt and project files in the right order; add and test your OpenRouter key, with step-by-step help to get one;
  check the defaults, including imported models that no longer exist on OpenRouter.
- **Starts where you left off:** Kalamo opens the project you had open last time (Settings → *Start Kalamo with*: the
  last project, the Projects page, or a new project).
- **Quit closes the tab** as well as stopping Kalamo.
- **New Settings:** groups on the left (Start and folders, Appearance, Writing and saving, Spelling, AI, API keys,
  About and reset), no scrolling, and no Save button: every change is saved at once. Saving Settings no longer closes
  the open project. **Reset to defaults** keeps your folders, keys, prompts and writing.
- **Browse…** for the library and backup folders (or type the path).
- **More colour schemes:** Dark, Light, Follow the system, High contrast, Forest, Lavender and Sky, besides Walnut and
  Sand.
- **Spelling: Show me** opens the browser's language settings, where you add a language's dictionary.
- **Sign in with OpenRouter:** approve Kalamo on OpenRouter and the key is made and saved for you; nothing to copy.
- **API keys in Settings**, also for **OpenAI, Anthropic (Claude), Google (Gemini) and xAI (Grok)** if you want to use
  them directly: choose the provider first, then its models. Their cost is shown as an estimate.
- **Better Continue and Revise Selection:** they write in your voice, follow your `[notes]`, don't repeat your text or
  wrap the story up, and Continue reads the text after the cursor when you write in the middle of a chapter.
- **Keyboard shortcuts per prompt:** choose each prompt's key, also for the standard prompts.
- **Selection bar:** select text and the prompts that use it appear under the selection.
- **A prompt's model is gone?** Kalamo offers a replacement (or lets you choose one) and then carries on with your run.
- **Trash:** deleted documents and projects can be seen, restored (never over another file, with the deletion time in
  the name) or deleted for good.
- **Rename** a document by clicking its name above the editor; **Rename** and **Delete** in the binder's right-click menu.
- **Run dialog:** the Input tab shows only the variables the prompt uses; the Model tab shows what an empty temperature
  or length means; new standard collections start at temperature 0.7.
- After a Raptor Write import, its prompts and collections can be added to your library with one click.

## 0.51 (November 2026): the first public version

Free, provided as is, without warranty. Bugs can be expected: keep backups of your writing.

- Projects, folders and documents in a binder; drag and drop; word counts that add up per folder and project.
- Rich-text editor on plain Markdown files; autosave, safety and recovery copies; notices changes made outside Kalamo.
- Split view; find & replace in a document, a folder or the whole project; spell check (Chrome's).
- AI through OpenRouter with your own key: prompt library and the `/` list (Continue, Revise Selection, Go and your own
  prompts), chat with `@` references and `{{variables}}`, summaries, past / present / future tense.
- Every AI feature starts on the free model router `openrouter/free`; standard collections Default, Free and Top Weekly
  (refreshed weekly); a model search box; estimated cost before and actual cost after every run; Stop; no automatic retries.
- The Future Fiction Academy's chapter workflow: a worksheet wizard (18-section template you can change) and a chapter
  pipeline (plan, draft, three audits, final candidate, accept, summary) with a budget limit.
- Raptor Write import (full backups, project exports, prompts and collections), with a word-by-word check.
- Backups (ZIP) and restore; exports to Markdown, plain text or ZIP.
- Portable Windows download with Python included: unzip and double-click.
