### Mastery Quiz — Static Website + Python Editor

A cozy, mastery-based quiz system for serious study. Pure static site (HTML/CSS/JS) that runs on GitHub Pages. A Python Tkinter desktop app helps you create and edit quiz topics and questions.

#### Highlights
- Pure static website (no backend, no build step)
- Mobile-friendly, calm UI (light/dark)
- Deterministic mastery flow: correct removes, incorrect repeats more often
- Supported question types: true/false, single-choice, multi-choice, fill-in-text, fill-in-table
- Optional localStorage persistence
- Python GUI editor for creating/editing topics and questions

---

### Project Structure
```
/                          # project root
  index.html               # main page
  assets/styles.css        # styles (light/dark)
  js/                      # modular vanilla JS
    app.js
    data.js
    engine.js
    ui.js
    storage.js
  data/                    # JSON data (courses and topics)
    courses.json           # list of courses
    /<course>/
      topics.json          # course metadata + list of topics
      presets.json         # optional (future)
      /topic/
        <topic>.json       # topic files with questions
  images/                  # images used in questions
    /<course>/
      /<topic>/
        *.png ...
  tools/
    editor.py              # Python Tkinter editor
```

---

### Data Model

Courses are discovered from `data/courses.json` (static index needed on GitHub Pages; browsers can’t list folders).

```
// data/courses.json
{
  "courses": [
    { "id": "os", "course_name": "Operačné systémy" }
  ]
}
```

Each course has `data/<course>/topics.json`:
```
{
  "course": "os",
  "course_name": "Operačné systémy",
  "topics": [
    { "id": "memory", "file": "topic/memory.json" },
    { "id": "linux",  "file": "topic/linux.json"  }
  ]
}
```

Topic file schema (self-describing):
```
{
  "topic_id": "memory",
  "topic_name": "Pamäť a správa pamäte",
  "questions": [ Question, ... ]
}
```

Question types (required fields per type):
- Common to all: `id`, `type`, `question`, `explanation`, optional `image`
- true_false: `correct` (boolean)
- mc_single: `options` (array of strings), `correct` (number index)
- mc_multi: `options` (array of strings), `correct` (array of number indices)
- fill_text: `answers` (array of accepted strings; matching is case-insensitive and trimmed)
- fill_table: `table.answers` (2D array of strings, case-insensitive & trimmed match)

Images
- Put images under `images/<course>/<topic>/...`
- In topic JSON, you can reference as:
  - `"image": "<topic>/<file>"` (preferred; auto-resolves to `images/<course>/<topic>/<file>`), or
  - `"image": "images/<course>/<topic>/<file>"` (absolute within site)

---

### Mastery Algorithm (engine.js)
- One question shown at a time.
- On correct: add to `mastered` — it is permanently removed.
- On incorrect: increment wrong counter and set a short cooldown (1–3) so it doesn’t repeat immediately.
- Selection uses weighted random among unmastered, non-cooled questions:
  - Unseen weight = 1
  - Wrong once weight = 3
  - Each additional wrong adds +1
- Quiz ends only when all questions are mastered.
- Options for multiple choice are shuffled per render.

Optional enhancements implemented:
- Progress indicator (mastered/total).
- Cooldown indicator (count of "cooling" questions).
- localStorage persistence toggle.

---

### How to Add Courses and Topics

1) Add a course
- Edit `data/courses.json` and append an object: `{ "id": "<courseId>", "course_name": "Readable Name" }`.
- Create folder `data/<courseId>/` with a `topics.json` file.

2) Add topics to a course
- Edit `data/<courseId>/topics.json` and add a topic entry: `{ "id": "<topicId>", "file": "topic/<topicId>.json" }`.
- Create the file `data/<courseId>/topic/<topicId>.json` with the schema above.
- If you use images, copy them under `images/<courseId>/<topicId>/...` and reference them as `"<topicId>/<file>"` or `"images/<courseId>/<topicId>/<file>"`.

Tip: Use the Python editor (below) to avoid editing JSON by hand.

---

### Python GUI Editor (Tkinter)
Requirements: Python 3.x, Tkinter (usually included). No web dependency.

Run:
```
python tools/editor.py
```
Features:
- Select course and topic
- Create a new topic (updates `topics.json` automatically)
- Add/edit/delete questions
- Dynamic fields depending on type
- Optional image selector (copies into `images/<course>/<topic>/`)
- Validates JSON structure before saving
- Save writes to `data/<course>/topic/<topic>.json`

Workflow:
- Choose a course and a topic.
- Add questions and click "Save/Update Question" (saves to in-memory list).
- Click "Save Topic File" to write the JSON file.

---

### Deploy to GitHub Pages

Option A: User/Org Pages (root)
- Push this repository to `main` (or `master`).
- In repo Settings → Pages: set Source to `Deploy from a branch` and pick `main` root.
- Your site will be available at `https://<user>.github.io/<repo>/`.

Option B: Project Pages (docs folder)
- Alternatively, move the site into `/docs` and enable Pages to serve from `/docs`.

Notes
- All paths are relative; the site works from a subpath.
- GitHub Pages serves JSON and modules fine. Opening `index.html` directly from the filesystem may block `fetch()`. Use Pages or a local static server for testing.

---

### Development Notes
- No frameworks (React/Vue), no bundlers; plain modules.
- Clean separation: `engine.js` (logic), `ui.js` (render), `data.js` (fetch), `storage.js` (persistence), `app.js` (glue).
- Important logic is documented in `engine.js`.

---

### Example Data
- OS course: `data/os/topics.json`
- Topics:
  - memory (`data/os/topic/memory.json`)
  - linux (`data/os/topic/linux.json`)

You can start the quiz immediately by opening the site via a static server or GitHub Pages.
