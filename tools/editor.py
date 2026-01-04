#!/usr/bin/env python3
"""
 Editor (Tkinter)
- Create/edit topics and questions
- Validates and saves JSON in /data/<course>/topic/*.json
- Updates /data/<course>/topics.json automatically

Question types supported:
- true_false
- mc_single
- mc_multi
- fill_text
- fill_table

Run: python tools/editor.py
"""
import json
import os
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
IMAGES_DIR = os.path.join(PROJECT_ROOT, 'images')


def load_courses():
    p = os.path.join(DATA_DIR, 'courses.json')
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('courses', [])


def load_topics(course_id):
    p = os.path.join(DATA_DIR, course_id, 'topics.json')
    if not os.path.exists(p):
        raise FileNotFoundError(f'Missing {p}')
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data


def save_topics_json(course_id, topics_json):
    p = os.path.join(DATA_DIR, course_id, 'topics.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(topics_json, f, ensure_ascii=False, indent=2)


def load_topic_file(course_id, rel_file):
    p = os.path.join(DATA_DIR, course_id, rel_file.replace('/', os.sep))
    if not os.path.exists(p):
        return {"topic_id": "", "topic_name": "", "questions": []}
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_topic_file(course_id, rel_file, topic_data):
    p = os.path.join(DATA_DIR, course_id, rel_file.replace('/', os.sep))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(topic_data, f, ensure_ascii=False, indent=2)


def copy_image_into_course(course_id, topic_id, src_path):
    if not src_path:
        return ""
    if not os.path.isfile(src_path):
        return src_path
    # Copy into images/<course>/<topic>/
    dst_dir = os.path.join(IMAGES_DIR, course_id, topic_id)
    os.makedirs(dst_dir, exist_ok=True)
    base = os.path.basename(src_path)
    dst_path = os.path.join(dst_dir, base)
    try:
        if os.path.abspath(src_path) != os.path.abspath(dst_path):
            shutil.copy2(src_path, dst_path)
    except Exception as e:
        print('Image copy failed:', e)
    # Return relative path used in JSON (relative to images/<course>/)
    return f"{topic_id}/{base}"


# ---------- Validation ----------

def validate_question(q):
    # Base required fields
    base_required = ['id', 'type', 'question']
    for k in base_required:
        if not q.get(k):
            return False, f"Missing field: {k}"
    # Allow either text explanation or explanation image (at least one is required)
    has_text_expl = bool((q.get('explanation') or '').strip())
    has_image_expl = bool(q.get('explanation_image'))
    if not (has_text_expl or has_image_expl):
        return False, 'Provide either explanation text or explanation_image (or both)'
    t = q.get('type')
    if t == 'true_false':
        if 'correct' not in q or not isinstance(q['correct'], bool):
            return False, 'true_false requires boolean "correct"'
    elif t == 'mc_single':
        if not isinstance(q.get('options'), list) or len(q['options']) < 2:
            return False, 'mc_single requires options[] (>=2)'
        if not isinstance(q.get('correct'), int) or not (0 <= q['correct'] < len(q['options'])):
            return False, 'mc_single requires numeric correct index'
    elif t == 'mc_multi':
        if not isinstance(q.get('options'), list) or len(q['options']) < 2:
            return False, 'mc_multi requires options[] (>=2)'
        corr = q.get('correct')
        if not isinstance(corr, list) or not all(isinstance(i, int) for i in corr):
            return False, 'mc_multi requires array of correct indices'
        if any(i < 0 or i >= len(q['options']) for i in corr):
            return False, 'mc_multi: correct indices out of range'
    elif t == 'fill_text':
        if not isinstance(q.get('answers'), list) or len(q['answers']) == 0:
            return False, 'fill_text requires answers[]'
    elif t == 'fill_table':
        table = q.get('table') or {}
        ans = table.get('answers')
        if not isinstance(ans, list) or not all(isinstance(row, list) for row in ans):
            return False, 'fill_table requires table.answers as 2D array'
    elif t == 'sort':
        items = q.get('items')
        corr = q.get('correct')
        if not isinstance(items, list) or len(items) < 2:
            return False, 'sort requires items[] (>=2)'
        if not isinstance(corr, list) or not all(isinstance(i, int) for i in corr):
            return False, 'sort requires correct[] as array of indices (0..n-1)'
        n = len(items)
        if len(corr) != n:
            return False, 'sort correct[] must have the same length as items[]'
        if any(i < 0 or i >= n for i in corr):
            return False, 'sort: correct indices out of range'
        # must be a permutation
        if sorted(corr) != list(range(n)):
            return False, 'sort: correct[] must contain each index 0..n-1 exactly once (a permutation)'
    else:
        return False, f'Unknown type: {t}'
    return True, 'OK'


# ---------- GUI ----------

class EditorApp:
    def __init__(self, root):
        self.root = root
        root.title('Mastery Quiz Editor')
        root.geometry('1100x650')

        # Apply dark theme
        self._apply_dark_theme()

        self.courses = load_courses()
        self.current_course = None
        self.topics_json = None
        self.current_topic_relfile = None
        self.current_topic = {"topic_id": "", "topic_name": "", "questions": []}
        self.selected_question_index = None

        self.build_ui()
        self.populate_courses()

    def build_ui(self):
        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(0, weight=1)

        # Left panel
        left = ttk.Frame(self.root, padding=8)
        left.grid(row=0, column=0, sticky='ns')

        ttk.Label(left, text='Course').grid(row=0, column=0, sticky='w')
        self.course_cmb = ttk.Combobox(left, state='readonly')
        self.course_cmb.grid(row=1, column=0, sticky='ew', pady=(0,6))
        self.course_cmb.bind('<<ComboboxSelected>>', lambda e: self.on_course_change())

        ttk.Label(left, text='Topic').grid(row=2, column=0, sticky='w')
        self.topic_cmb = ttk.Combobox(left, state='readonly')
        self.topic_cmb.grid(row=3, column=0, sticky='ew', pady=(0,4))
        self.topic_cmb.bind('<<ComboboxSelected>>', lambda e: self.on_topic_change())

        btns = ttk.Frame(left)
        btns.grid(row=4, column=0, pady=4, sticky='ew')
        ttk.Button(btns, text='New Topic', command=self.new_topic_dialog).pack(side='left')
        ttk.Button(btns, text='Save Topic File', command=self.save_topic_file).pack(side='left', padx=6)

        ttk.Separator(left).grid(row=5, column=0, sticky='ew', pady=8)

        ttk.Label(left, text='Questions').grid(row=6, column=0, sticky='w')
        self.q_list = tk.Listbox(left, height=25)
        self._style_listbox(self.q_list)
        self.q_list.grid(row=7, column=0, sticky='ns')
        self.q_list.bind('<<ListboxSelect>>', lambda e: self.on_select_question())

        qbtns = ttk.Frame(left)
        qbtns.grid(row=8, column=0, pady=6, sticky='ew')
        ttk.Button(qbtns, text='Add', command=self.add_question).pack(side='left')
        ttk.Button(qbtns, text='Delete', command=self.delete_question).pack(side='left', padx=6)

        # Right panel (form)
        right = ttk.Frame(self.root, padding=8)
        right.grid(row=0, column=1, sticky='nsew')
        right.columnconfigure(1, weight=1)

        r = 0
        ttk.Label(right, text='Question ID').grid(row=r, column=0, sticky='e')
        self.id_var = tk.StringVar()
        ttk.Entry(right, textvariable=self.id_var).grid(row=r, column=1, sticky='ew', pady=2)
        r += 1

        ttk.Label(right, text='Type').grid(row=r, column=0, sticky='e')
        self.type_var = tk.StringVar(value='true_false')
        self.type_cmb = ttk.Combobox(right, textvariable=self.type_var, values=['true_false','mc_single','mc_multi','fill_text','fill_table','sort'], state='readonly')
        self.type_cmb.grid(row=r, column=1, sticky='w', pady=2)
        self.type_cmb.bind('<<ComboboxSelected>>', lambda e: self.refresh_form_fields())
        r += 1

        ttk.Label(right, text='Question Text').grid(row=r, column=0, sticky='ne')
        self.question_txt = tk.Text(right, height=4)
        self._style_text(self.question_txt)
        self.question_txt.grid(row=r, column=1, sticky='ew', pady=2)
        r += 1

        ttk.Label(right, text='Explanation (text)').grid(row=r, column=0, sticky='ne')
        self.expl_txt = tk.Text(right, height=4)
        self._style_text(self.expl_txt)
        self.expl_txt.grid(row=r, column=1, sticky='ew', pady=2)
        r += 1

        ttk.Label(right, text='Image').grid(row=r, column=0, sticky='e')
        img_row = ttk.Frame(right)
        img_row.grid(row=r, column=1, sticky='ew', pady=2)
        img_row.columnconfigure(0, weight=1)
        self.image_var = tk.StringVar()
        ttk.Entry(img_row, textvariable=self.image_var).grid(row=0, column=0, sticky='ew')
        ttk.Button(img_row, text='Select…', command=self.select_image).grid(row=0, column=1, padx=4)
        r += 1

        ttk.Label(right, text='Explanation Image').grid(row=r, column=0, sticky='e')
        expl_img_row = ttk.Frame(right)
        expl_img_row.grid(row=r, column=1, sticky='ew', pady=2)
        expl_img_row.columnconfigure(0, weight=1)
        self.expl_image_var = tk.StringVar()
        ttk.Entry(expl_img_row, textvariable=self.expl_image_var).grid(row=0, column=0, sticky='ew')
        ttk.Button(expl_img_row, text='Select…', command=self.select_expl_image).grid(row=0, column=1, padx=4)
        r += 1

        self.dynamic_frame = ttk.Frame(right)
        self.dynamic_frame.grid(row=r, column=0, columnspan=2, sticky='nsew', pady=4)
        right.rowconfigure(r, weight=1)
        r += 1

        save_row = ttk.Frame(right)
        save_row.grid(row=r, column=0, columnspan=2, sticky='ew')
        ttk.Button(save_row, text='Preview', command=self.preview_question).pack(side='left')
        ttk.Button(save_row, text='Save/Update Question', command=self.save_question).pack(side='left', padx=6)
        ttk.Button(save_row, text='Clear Form', command=self.clear_form).pack(side='left', padx=6)

        self.refresh_form_fields()

    def _apply_dark_theme(self):
        # Basic dark palette for ttk + Tk widgets
        bg = '#121212'
        bg2 = '#1e1f22'
        fg = '#e6e6e6'
        self.root.configure(bg=bg)
        style = ttk.Style(self.root)
        try:
            style.theme_use('clam')
        except Exception:
            pass
        style.configure('.', background=bg2, foreground=fg)
        style.configure('TFrame', background=bg2)
        style.configure('TLabel', background=bg2, foreground=fg)
        style.configure('TButton', background=bg2, foreground=fg, relief='flat')
        style.map('TButton', background=[('active', '#2a2c30')])
        style.configure('TEntry', fieldbackground=bg, foreground=fg)
        style.configure('TCombobox', fieldbackground=bg, foreground=fg, background=bg2)
        style.map('TCombobox', fieldbackground=[('readonly', bg)], foreground=[('readonly', fg)])
        style.configure('TSeparator', background='#2a2a2a')

    def _style_text(self, widget: tk.Text):
        widget.configure(bg='#121212', fg='#e6e6e6', insertbackground='#e6e6e6', highlightthickness=1, highlightbackground='#2a2a2a', relief='flat')

    def _style_listbox(self, widget: tk.Listbox):
        widget.configure(bg='#121212', fg='#e6e6e6', selectbackground='#2a2c30', selectforeground='#e6e6e6', highlightthickness=0, relief='flat')

    def select_expl_image(self):
        p = filedialog.askopenfilename(title='Select explanation image', filetypes=[('Image files','*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg'),('All files','*.*')])
        if p:
            self.expl_image_var.set(p)

        # ---------- Data Binding ----------

    def populate_courses(self):
        ids = [c['id'] for c in self.courses]
        self.course_cmb['values'] = ids
        if ids:
            self.course_cmb.set(ids[0])
            self.on_course_change()

    def on_course_change(self):
        cid = self.course_cmb.get()
        if not cid:
            return
        self.current_course = cid
        data = load_topics(cid)
        self.topics_json = data
        topics = data.get('topics', [])
        self.topic_cmb['values'] = [t['id'] for t in topics]
        if topics:
            self.topic_cmb.set(topics[0]['id'])
            self.on_topic_change()
        else:
            self.topic_cmb.set('')
            self.current_topic_relfile = None
            self.current_topic = {"topic_id": "", "topic_name": "", "questions": []}
            self.refresh_question_list()

    def on_topic_change(self):
        tid = self.topic_cmb.get()
        if not tid:
            return
        # find file
        entry = next((t for t in self.topics_json.get('topics', []) if t['id'] == tid), None)
        if not entry:
            return
        self.current_topic_relfile = entry['file']
        self.current_topic = load_topic_file(self.current_course, self.current_topic_relfile)
        if not self.current_topic.get('topic_id'):
            self.current_topic['topic_id'] = tid
        if not self.current_topic.get('topic_name'):
            self.current_topic['topic_name'] = entry.get('topic_name', tid)
        self.refresh_question_list()

    def refresh_question_list(self):
        self.q_list.delete(0, tk.END)
        for q in self.current_topic.get('questions', []):
            snippet = (q.get('question') or '').strip().split('\n')[0]
            if len(snippet) > 60:
                snippet = snippet[:57] + '…'
            self.q_list.insert(tk.END, f"{q.get('id')} — {snippet}")
        self.selected_question_index = None

    # ---------- Topics ----------

    def new_topic_dialog(self):
        dialog = tk.Toplevel(self.root)
        dialog.title('New Topic')
        ttk.Label(dialog, text='Topic ID').grid(row=0, column=0, sticky='e')
        tid_var = tk.StringVar()
        ttk.Entry(dialog, textvariable=tid_var).grid(row=0, column=1)
        ttk.Label(dialog, text='Topic Name').grid(row=1, column=0, sticky='e')
        tname_var = tk.StringVar()
        ttk.Entry(dialog, textvariable=tname_var).grid(row=1, column=1)

        def create():
            tid = tid_var.get().strip()
            tname = tname_var.get().strip() or tid
            if not tid:
                messagebox.showerror('Error', 'Topic ID required')
                return
            file_rel = f"topic/{tid}.json"
            topics = self.topics_json.get('topics', [])
            if any(t['id'] == tid for t in topics):
                messagebox.showerror('Error', 'Topic ID already exists')
                return
            topics.append({"id": tid, "file": file_rel})
            self.topics_json['topics'] = topics
            save_topics_json(self.current_course, self.topics_json)
            self.topic_cmb['values'] = [t['id'] for t in topics]
            self.topic_cmb.set(tid)
            self.current_topic_relfile = file_rel
            self.current_topic = {"topic_id": tid, "topic_name": tname, "questions": []}
            self.refresh_question_list()
            dialog.destroy()

        ttk.Button(dialog, text='Create', command=create).grid(row=2, column=0, columnspan=2, pady=8)

    def save_topic_file(self):
        if not self.current_course or not self.current_topic_relfile:
            messagebox.showerror('Error', 'Select or create a topic first')
            return
        # Validate all questions
        for i, q in enumerate(self.current_topic.get('questions', [])):
            ok, msg = validate_question(q)
            if not ok:
                messagebox.showerror('Validation Error', f'Question #{i+1} ({q.get("id")}): {msg}')
                return
        save_topic_file(self.current_course, self.current_topic_relfile, self.current_topic)
        messagebox.showinfo('Saved', f'Saved {self.current_topic_relfile}')

    # ---------- Questions ----------

    def on_select_question(self):
        sel = self.q_list.curselection()
        if not sel:
            self.selected_question_index = None
            return
        idx = sel[0]
        self.selected_question_index = idx
        q = self.current_topic['questions'][idx]
        self.load_question_into_form(q)

    def add_question(self):
        self.selected_question_index = None
        self.clear_form()

    def delete_question(self):
        sel = self.q_list.curselection()
        if not sel:
            return
        idx = sel[0]
        if messagebox.askyesno('Delete', 'Delete selected question?'):
            del self.current_topic['questions'][idx]
            self.refresh_question_list()

    def clear_form(self):
        self.id_var.set('')
        self.type_var.set('true_false')
        self.question_txt.delete('1.0', tk.END)
        self.expl_txt.delete('1.0', tk.END)
        self.image_var.set('')
        if hasattr(self, 'expl_image_var'):
            self.expl_image_var.set('')
        self.refresh_form_fields()

    def load_question_into_form(self, q):
        self.id_var.set(q.get('id', ''))
        self.type_var.set(q.get('type', 'true_false'))
        self.question_txt.delete('1.0', tk.END)
        self.question_txt.insert('1.0', q.get('question', ''))
        self.expl_txt.delete('1.0', tk.END)
        self.expl_txt.insert('1.0', q.get('explanation', ''))
        self.image_var.set(q.get('image', ''))
        if hasattr(self, 'expl_image_var'):
            self.expl_image_var.set(q.get('explanation_image', ''))
        self.refresh_form_fields(q)

    def refresh_form_fields(self, q=None):
        for w in self.dynamic_frame.winfo_children():
            w.destroy()
        t = self.type_var.get()
        if t == 'true_false':
            self.tf_var = tk.BooleanVar(value=(q.get('correct') if q else False))
            ttk.Radiobutton(self.dynamic_frame, text='True', variable=self.tf_var, value=True).pack(anchor='w')
            ttk.Radiobutton(self.dynamic_frame, text='False', variable=self.tf_var, value=False).pack(anchor='w')
        elif t == 'mc_single':
            ttk.Label(self.dynamic_frame, text='Options (one per line)').pack(anchor='w')
            opts = ''
            correct_idx = 0
            if q:
                opts = '\n'.join(q.get('options', []))
                correct_idx = q.get('correct', 0)
            self.opts_text = tk.Text(self.dynamic_frame, height=6)
            self._style_text(self.opts_text)
            self.opts_text.insert('1.0', opts)
            self.opts_text.pack(fill='x')
            ttk.Label(self.dynamic_frame, text='Correct option index (0-based)').pack(anchor='w', pady=(6,0))
            self.correct_idx_var = tk.IntVar(value=correct_idx)
            ttk.Entry(self.dynamic_frame, textvariable=self.correct_idx_var).pack(anchor='w')
        elif t == 'mc_multi':
            ttk.Label(self.dynamic_frame, text='Options (one per line)').pack(anchor='w')
            opts = ''
            corr = ''
            if q:
                opts = '\n'.join(q.get('options', []))
                corr = ','.join(str(i) for i in q.get('correct', []))
            self.opts_text = tk.Text(self.dynamic_frame, height=6)
            self._style_text(self.opts_text)
            self.opts_text.insert('1.0', opts)
            self.opts_text.pack(fill='x')
            ttk.Label(self.dynamic_frame, text='Correct indices (comma-separated, 0-based)').pack(anchor='w', pady=(6,0))
            self.correct_multi_var = tk.StringVar(value=corr)
            ttk.Entry(self.dynamic_frame, textvariable=self.correct_multi_var).pack(anchor='w')
        elif t == 'fill_text':
            ttk.Label(self.dynamic_frame, text='Accepted answers (comma-separated)').pack(anchor='w')
            ans = ''
            if q:
                ans = ','.join(q.get('answers', []))
            self.answers_var = tk.StringVar(value=ans)
            ttk.Entry(self.dynamic_frame, textvariable=self.answers_var).pack(fill='x')
        elif t == 'fill_table':
            ttk.Label(self.dynamic_frame, text='Table answers (rows; separate cells with commas)').pack(anchor='w')
            table_txt = ''
            if q and q.get('table') and q['table'].get('answers'):
                rows = q['table']['answers']
                table_txt = '\n'.join(','.join(str(c) for c in row) for row in rows)
            self.table_text = tk.Text(self.dynamic_frame, height=8)
            self._style_text(self.table_text)
            self.table_text.insert('1.0', table_txt)
            self.table_text.pack(fill='x')
        elif t == 'sort':
            ttk.Label(self.dynamic_frame, text='Items to sort (one per line, displayed initially in this order)').pack(anchor='w')
            items_txt = ''
            corr_txt = ''
            if q:
                items = q.get('items', [])
                if items and isinstance(items[0], dict):
                    items_txt = '\n'.join(it.get('text','') for it in items)
                    # When items are objects, correct might be ids; convert to indices by mapping current order
                    id_to_idx = {str(it.get('id')): i for i, it in enumerate(items)}
                    corr_src = q.get('correct', [])
                    try:
                        corr_idx = [str(id_to_idx[str(v)]) for v in corr_src]
                        corr_txt = ','.join(corr_idx)
                    except Exception:
                        corr_txt = ','.join(str(v) for v in corr_src)
                else:
                    items_txt = '\n'.join(str(it) for it in items)
                    corr_txt = ','.join(str(v) for v in (q.get('correct', [])))
            self.sort_items_text = tk.Text(self.dynamic_frame, height=8)
            self._style_text(self.sort_items_text)
            self.sort_items_text.insert('1.0', items_txt)
            self.sort_items_text.pack(fill='x')
            ttk.Label(self.dynamic_frame, text='Correct final order as indices (comma-separated permutation of 0..n-1)').pack(anchor='w', pady=(6,0))
            self.sort_correct_var = tk.StringVar(value=corr_txt)
            ttk.Entry(self.dynamic_frame, textvariable=self.sort_correct_var).pack(fill='x')
        else:
            ttk.Label(self.dynamic_frame, text='Unknown type').pack()

    def select_image(self):
        p = filedialog.askopenfilename(title='Select image', filetypes=[('Image files','*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg'),('All files','*.*')])
        if p:
            self.image_var.set(p)

    def build_question_from_form(self):
        q = {
            'id': self.id_var.get().strip(),
            'type': self.type_var.get(),
            'question': self.question_txt.get('1.0', tk.END).strip(),
            'explanation': self.expl_txt.get('1.0', tk.END).strip(),
        }
        img = self.image_var.get().strip()
        if img:
            # copy on save_question after validation
            q['image'] = img
        expl_img = self.expl_image_var.get().strip() if hasattr(self, 'expl_image_var') else ''
        if expl_img:
            q['explanation_image'] = expl_img
        t = q['type']
        if t == 'true_false':
            q['correct'] = bool(self.tf_var.get())
        elif t == 'mc_single':
            options = [line.strip() for line in self.opts_text.get('1.0', tk.END).split('\n') if line.strip()]
            q['options'] = options
            q['correct'] = int(self.correct_idx_var.get()) if options else 0
        elif t == 'mc_multi':
            options = [line.strip() for line in self.opts_text.get('1.0', tk.END).split('\n') if line.strip()]
            q['options'] = options
            corr = [s.strip() for s in self.correct_multi_var.get().split(',') if s.strip()]
            q['correct'] = [int(s) for s in corr]
        elif t == 'fill_text':
            answers = [s.strip() for s in self.answers_var.get().split(',') if s.strip()]
            q['answers'] = answers
        elif t == 'fill_table':
            rows = []
            for line in self.table_text.get('1.0', tk.END).split('\n'):
                line = line.strip()
                if not line:
                    continue
                rows.append([cell.strip() for cell in line.split(',')])
            q['table'] = {'answers': rows}
        elif t == 'sort':
            items = [line.strip() for line in self.sort_items_text.get('1.0', tk.END).split('\n') if line.strip()]
            q['items'] = items
            corr_raw = [s.strip() for s in self.sort_correct_var.get().split(',') if s.strip()]
            if corr_raw:
                try:
                    q['correct'] = [int(s) for s in corr_raw]
                except Exception:
                    q['correct'] = list(range(len(items)))
            else:
                q['correct'] = list(range(len(items)))
        return q

    def preview_question(self):
        q = self.build_question_from_form()
        ok, msg = validate_question(q)
        if not ok:
            messagebox.showerror('Validation error', msg)
            return
        win = tk.Toplevel(self.root)
        win.title(f"Preview — {q.get('id')}")
        frm = ttk.Frame(win, padding=10)
        frm.pack(fill='both', expand=True)
        text = tk.Text(frm, wrap='word', height=20, width=80)
        self._style_text(text)
        text.pack(fill='both', expand=True)
        def w(s):
            text.insert('end', s + '\n')
        w(f"ID: {q.get('id')}")
        w(f"Type: {q.get('type')}")
        w("")
        w("Question:")
        w(q.get('question',''))
        w("")
        t = q.get('type')
        if t in ('mc_single','mc_multi'):
            w("Options:")
            for i,opt in enumerate(q.get('options',[])):
                w(f"  {i}. {opt}")
            w("")
            w("Correct:")
            if t=='mc_single':
                w(f"  {q.get('correct')}")
            else:
                w(f"  {', '.join(str(i) for i in q.get('correct', []))}")
        elif t=='true_false':
            w(f"Correct: {'True' if q.get('correct') else 'False'}")
        elif t=='fill_text':
            w("Accepted answers:")
            w(", ".join(q.get('answers',[])))
        elif t=='fill_table':
            w("Table answers:")
            for row in q.get('table',{}).get('answers',[]):
                w(' | '.join(str(c) for c in row))
        elif t=='sort':
            w("Items:")
            for i, it in enumerate(q.get('items', [])):
                if isinstance(it, dict):
                    w(f"  {i}. {it.get('text','')}")
                else:
                    w(f"  {i}. {it}")
            w("")
            w("Correct order (indices):")
            w(', '.join(str(i) for i in q.get('correct', [])))
        img = q.get('image')
        if img:
            w("")
            w(f"Image: {img}")
        expl_img = q.get('explanation_image')
        if expl_img:
            w("")
            w(f"Explanation image: {expl_img}")
        w("")
        w("Explanation:")
        w(q.get('explanation',''))
        text.config(state='disabled')
        ttk.Button(frm, text='Close', command=win.destroy).pack(pady=6, anchor='e')

    def save_question(self):
        if not self.current_course:
            messagebox.showerror('Error', 'Select a course')
            return
        if not self.topic_cmb.get():
            messagebox.showerror('Error', 'Select or create a topic')
            return
        q = self.build_question_from_form()
        ok, msg = validate_question(q)
        if not ok:
            messagebox.showerror('Validation error', msg)
            return
        # Copy images into images/<course>/<topic>/ and set relative JSON image path(s)
        topic_id = self.current_topic.get('topic_id') or self.topic_cmb.get()
        if q.get('image'):
            rel_img = copy_image_into_course(self.current_course, topic_id, q['image'])
            q['image'] = rel_img
        if q.get('explanation_image'):
            rel_expl_img = copy_image_into_course(self.current_course, topic_id, q['explanation_image'])
            q['explanation_image'] = rel_expl_img
        # Upsert into list
        if self.selected_question_index is not None:
            self.current_topic['questions'][self.selected_question_index] = q
        else:
            self.current_topic['questions'].append(q)
            self.selected_question_index = len(self.current_topic['questions']) - 1
        self.refresh_question_list()
        messagebox.showinfo('Saved', f'Question {q["id"]} saved to topic (not yet written to file). Click "Save Topic File" to write JSON.')


if __name__ == '__main__':
    root = tk.Tk()
    app = EditorApp(root)
    root.mainloop()
