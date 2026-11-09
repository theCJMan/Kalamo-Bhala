# Kalamo Bhala - v0.54

**A free writing app for long-form work** (novels, books, reports, articles) that runs on your own computer (Windows, Mac or
Linux) and opens in your web browser. Your writing is kept as ordinary Markdown files in a folder you choose, so it is never locked in.
AI help (continue, revise, chat, summaries, a chapter-by-chapter workflow) works through [OpenRouter](https://openrouter.ai),
including free models.

![Kalamo Bhala: the binder on the left, the editor on the right](images/05-workspace.png)

> [!WARNING]
> **Kalamo Bhala is free and provided "as is", without guarantees or warranties of any kind.** It is early software:
> bugs can be expected, and a bug could damage or lose text. **Keep your own backups of your writing.**
> The AI features send the text you choose to OpenRouter and the model's provider; their terms and prices apply.

## Download

**[⬇ Download the latest version](../../releases/latest)** and pick the file for your computer under *Assets*:

| Your computer | File |
| --- | --- |
| Windows 10 or 11 (64-bit) | `Kalamo-Bhala-<version>-Windows.zip` (about 14 MB) |
| Mac with Apple Silicon (M1 and later) | `Kalamo-Bhala-<version>-Mac-AppleSilicon.zip` (about 29 MB) |
| Mac with an Intel processor | `Kalamo-Bhala-<version>-Mac-Intel.zip` (about 29 MB) |
| Linux, most PCs (x64) | `Kalamo-Bhala-<version>-Linux-x64.tar.gz` (about 39 MB) |
| Linux on ARM (for example a Raspberry Pi 4/5, 64-bit) | `Kalamo-Bhala-<version>-Linux-ARM64.tar.gz` (about 32 MB) |

Nothing else is needed: Python is included, and Kalamo opens in your own default browser. An internet connection is
only needed for the AI features and the weekly check for new versions.

> [!NOTE]
> **Mac and Linux are new in 0.54.** They pass every automated test on real Mac and Linux machines (GitHub's), but no
> writer has used them yet. Please [tell us](../../issues) how it goes. The Mac download is not signed by Apple, so
> macOS asks you to allow it once (see step 2).

## Start in three steps

1. **Unpack:**
   - **Windows:** right-click the ZIP → **Extract All…** → choose a folder (for example `Documents\Kalamo Bhala`).
   - **Mac:** double-click the ZIP and move the folder somewhere you like (for example Documents).
   - **Linux:** `tar -xzf Kalamo-Bhala-<version>-Linux-x64.tar.gz` (or "Extract Here" in your file manager).
2. **Start:**
   - **Windows:** double-click **Start Kalamo**. If Windows says *"Windows protected your PC"*, click **More info** →
     **Run anyway** (Kalamo is not signed with a paid certificate).
   - **Mac:** double-click **Start Kalamo.command**. The first time macOS refuses: click **Done**, open **System
     Settings → Privacy & Security**, click **Open Anyway** next to "Start Kalamo.command", then double-click it again
     and click **Open**. Only once.
   - **Linux:** in a terminal, `cd "Kalamo Bhala <version>"` and `./start-kalamo.sh`.
3. **Set up and write:** a console (Terminal) window opens (keep it open while you write) and your browser shows
   Kalamo. Read the notice and click **I understand**; a short **setup wizard** then helps you import your Raptor Write
   backup and add your OpenRouter key (one click with **Sign in with OpenRouter**).

**➜ The full guide, with pictures: [GUIDE.md](GUIDE.md)**

## What it does

- **Projects, folders and documents** in a binder; drag to reorder; word counts per folder and project.
- **A clean editor** (bold, italics, headings, lists, scene breaks) on plain Markdown files; autosave; safety copies;
  **split view** to look something up while you write; **find & replace** across a document, folder or project.
- **AI with your own OpenRouter key:** your own prompt library (type `/` in the text), Continue / Revise Selection / Go,
  a **chat** that can read your documents, **summaries**, rewriting in **past / present / future tense**.
- **Free to start:** every AI feature starts on `openrouter/free`; pick paid models when you want them. Every run shows
  its estimated cost before and its actual cost after; nothing is retried behind your back.
- **A chapter-by-chapter workflow** (the Future Fiction Academy's Narrative Physics Engine): a worksheet wizard, then per
  chapter a plan, a draft, three audits and a final candidate that you accept, with a budget limit.
- **Raptor Write import:** bring in your Raptor Write backup (projects, prompts, model collections).
- **Backups and exports:** one-click ZIP backups; export to Markdown, plain text or ZIP.

## Updating and removing

- **Update:** once a week Kalamo checks for a new version. When there is one, a pop-up offers **Download and install**
  (Windows and Mac; on Linux it opens the download page for now):
  Kalamo downloads it, checks it, unpacks it next to your current folder and restarts in the new version; then it
  offers to delete the old folder. Your writing (`Documents/MyWritings`), settings and API keys are kept, because they
  are not in Kalamo's folder. (Versions before 0.53 update by hand: quit, unpack the new version, start it.)
- **Remove:** delete the folder. Your writing stays where it is.

## Questions and problems

See the **Troubleshooting** part of [GUIDE.md](GUIDE.md#troubleshooting). Found a bug? Please open an
[issue](../../issues) and describe what you did and what happened (never attach your private writing).

## Credits and licence

Kalamo Bhala is free software under the [MIT licence](LICENSE). It includes Python (Python Software Foundation License)
and open-source editor components (their licences are in `THIRD-PARTY.md` inside the download), with parts adapted from
DinoWrite by Collean O'Brien (MIT). The chapter and worksheet prompts and the worksheet structure come from the
[Future Fiction Academy](https://futurefictionacademy.com)'s published Narrative Physics Engine material, with thanks.
