# Kalamo Bhala - v0.53

**A free writing app for long-form work** (novels, books, reports, articles) that runs on your own Windows PC and opens
in your web browser. Your writing is kept as ordinary Markdown files in a folder you choose, so it is never locked in.
AI help (continue, revise, chat, summaries, a chapter-by-chapter workflow) works through [OpenRouter](https://openrouter.ai),
including free models.

![Kalamo Bhala: the binder on the left, the editor on the right](images/05-workspace.png)

> [!WARNING]
> **Kalamo Bhala is free and provided "as is", without guarantees or warranties of any kind.** It is early software:
> bugs can be expected, and a bug could damage or lose text. **Keep your own backups of your writing.**
> The AI features send the text you choose to OpenRouter and the model's provider; their terms and prices apply.

## Download

**[⬇ Download the latest version](../../releases/latest)** (the file `Kalamo-Bhala-<version>-Windows.zip`, about 14 MB).

Needs: Windows 10 or 11 (64-bit) and a browser (Chrome or Edge work best). Nothing else: Python is included.
An internet connection is only needed for the AI features.

## Start in three steps

1. **Unzip:** right-click the downloaded ZIP → **Extract All…** → choose a folder (for example `Documents\Kalamo Bhala`).
2. **Start:** open that folder and double-click **Start Kalamo**.
   If Windows says *"Windows protected your PC"*, click **More info** → **Run anyway** (Kalamo is not signed with a paid certificate).
3. **Set up and write:** a black window opens (keep it open while you write) and your browser shows Kalamo. Read the
   notice and click **I understand**; a short **setup wizard** then helps you import your Raptor Write backup and add your
   OpenRouter key (with step-by-step help to get one for free).

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

- **Update:** quit Kalamo, delete its folder, unzip the new version. Your writing (`Documents\MyWritings`), settings
  and API key are kept, because they are not in that folder.
- **Remove:** delete the folder. Your writing stays where it is.

## Questions and problems

See the **Troubleshooting** part of [GUIDE.md](GUIDE.md#troubleshooting). Found a bug? Please open an
[issue](../../issues) and describe what you did and what happened (never attach your private writing).

## Credits and licence

Kalamo Bhala is free software under the [MIT licence](LICENSE). It includes Python (Python Software Foundation License)
and open-source editor components (their licences are in `THIRD-PARTY.md` inside the download), with parts adapted from
DinoWrite by Collean O'Brien (MIT). The chapter and worksheet prompts and the worksheet structure come from the
[Future Fiction Academy](https://futurefictionacademy.com)'s published Narrative Physics Engine material, with thanks.
