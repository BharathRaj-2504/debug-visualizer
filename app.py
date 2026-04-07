from flask import Flask, request, jsonify, session, redirect
from flask_cors import CORS
import os
import json
import sqlite3
from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='')
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
CORS(app, supports_credentials=True)

API_KEY = os.getenv("HUGGINGFACE_API_TOKEN")
if not API_KEY or API_KEY == "your_api_key_here":
    print("WARNING: HUGGINGFACE_API_TOKEN is not configured in .env.")

client = InferenceClient(api_key=API_KEY)

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

# ─────────────────────────────────────────────
# DATABASE INIT
# ─────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    conn.commit()
    conn.close()

# ─────────────────────────────────────────────
# AI PROMPT GENERATOR (unchanged)
# ─────────────────────────────────────────────
def generate_prompt(mode, language, code, error_message, expected_output):
    prompt = f"""You are an expert AI programming assistant for a Code Debugger and Code Visualizer.

Supported languages:
- C
- C++
- Java
- Python

-------------------------------------
INPUT:
Mode: {mode}  // MUST be either DEBUGGER or VISUALIZER
Language: {language}
Code:
{code}

Error (optional):
{error_message}

Expected Output (optional):
{expected_output}
-------------------------------------

STRICT RULES:
1. Output ONLY valid JSON.
2. DO NOT mix modes.
3. If Mode = DEBUGGER → PRIORITIZE error detection and fixing.
4. If Mode = VISUALIZER → PRIORITIZE execution steps only.
5. No chatbot-style explanations.
6. Keep explanations very short (1 line max).
7. Include line numbers in all steps.
8. total_steps must match steps length.

-------------------------------------

OUTPUT FORMAT:

{{
  "mode": "{mode}",
  "steps": [],
  "total_steps": 0,
  "final_output": "",
  "error": null,
  "analysis": [],
  "fixed_code": null
}}

-------------------------------------

IF Mode = DEBUGGER (CRITICAL):

YOU MUST DO THESE FIRST:

1. Analyze the code and detect ALL issues:
   - Syntax errors
   - Logical errors
   - Runtime issues

2. ALWAYS fill "error" field if ANY issue exists:
   {{
     "line": "(number here)",
     "token": "the exact string snippet causing the error",
     "type": "Syntax/Runtime/Logic",
     "message": "short description"
   }}

3. ALWAYS fill "analysis":
   [
     "Issue 1 explanation",
     "Issue 2 explanation"
   ]

4. ALWAYS provide "fixed_code":
   - Full corrected version of the code

5. Steps are OPTIONAL in debugger mode:
   - Only include if useful
   - Focus is debugging, NOT visualization

🚨 IMPORTANT:
If you fail to detect an error when one exists, the response is WRONG.

-------------------------------------

IF Mode = VISUALIZER:

1. DO NOT include analysis or fixed_code.
2. DO NOT behave like debugger.

3. Simulate execution step-by-step:
   - Each step = ONE small change
   - Include line number
   - Include variable updates

4. Fill "steps" like:
   {{
     "step": 1,
     "line": "(number here)",
     "action": "short action",
     "variables": {{}},
     "changes": {{}},
     "explanation": "short"
   }}

5. Fill:
   - total_steps
   - final_output

-------------------------------------

FINAL CHECK BEFORE OUTPUT:

- If DEBUGGER:
  ✅ error MUST NOT be null (if code is wrong)
  ✅ fixed_code MUST exist
  ✅ analysis MUST exist

- If VISUALIZER:
  ✅ steps MUST exist
  ❌ NO analysis
  ❌ NO fixed_code

-------------------------------------

IMPORTANT:
- Output ONLY JSON
- No markdown
- No extra text
- Must strictly follow mode behavior
"""
    return prompt

# ─────────────────────────────────────────────
# PAGE ROUTES
# ─────────────────────────────────────────────
@app.route('/')
def landing():
    return app.send_static_file('index.html')

@app.route('/auth')
def auth_page():
    return app.send_static_file('auth.html')

@app.route('/app')
def debugger_page():
    return app.send_static_file('debugger.html')

@app.route('/admin')
def admin_page():
    return app.send_static_file('admin.html')

# ─────────────────────────────────────────────
# AUTH API
# ─────────────────────────────────────────────
@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.json
    email = data.get('email', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not email or not username or not password:
        return jsonify({"error": "All fields are required"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    conn = get_db()
    try:
        # Check duplicates
        existing = conn.execute("SELECT id FROM users WHERE email = ? OR username = ?", (email, username)).fetchone()
        if existing:
            return jsonify({"error": "Email or username already exists"}), 409

        # Auto-assign admin role if username is 'admin'
        role = 'admin' if username.lower() == 'admin' else 'user'

        conn.execute(
            "INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)",
            (email, username, generate_password_hash(password), role)
        )
        conn.commit()

        # Fetch the new user
        user = conn.execute("SELECT id, username, role FROM users WHERE email = ?", (email,)).fetchone()
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']

        return jsonify({"message": "Account created", "username": user['username'], "role": user['role']}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    identifier = data.get('identifier', '').strip()  # email or username
    password = data.get('password', '')

    if not identifier or not password:
        return jsonify({"error": "All fields are required"}), 400

    conn = get_db()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE email = ? OR username = ?",
            (identifier, identifier)
        ).fetchone()

        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({"error": "Invalid credentials"}), 401

        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']

        return jsonify({"message": "Login successful", "username": user['username'], "role": user['role']})
    finally:
        conn.close()

@app.route('/api/me', methods=['GET'])
def get_me():
    if 'user_id' in session:
        return jsonify({
            "logged_in": True,
            "username": session['username'],
            "role": session['role']
        })
    return jsonify({"logged_in": False})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})

@app.route('/api/guest', methods=['POST'])
def guest_access():
    session['user_id'] = None
    session['username'] = 'Guest'
    session['role'] = 'guest'
    return jsonify({"message": "Guest access granted", "username": "Guest", "role": "guest"})

# ─────────────────────────────────────────────
# ANALYTICS API
# ─────────────────────────────────────────────
@app.route('/api/track', methods=['POST'])
def track_action():
    data = request.json
    action = data.get('action', '')

    if action not in ('DEBUGGER', 'VISUALIZER'):
        return jsonify({"error": "Invalid action"}), 400

    user_id = session.get('user_id')  # None for guests

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO analytics (user_id, action) VALUES (?, ?)",
            (user_id, action)
        )
        conn.commit()
        return jsonify({"message": "Tracked"})
    finally:
        conn.close()

@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    if session.get('role') != 'admin':
        return jsonify({"error": "Unauthorized"}), 403

    conn = get_db()
    try:
        total_users = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
        debug_count = conn.execute("SELECT COUNT(*) as c FROM analytics WHERE action = 'DEBUGGER'").fetchone()['c']
        visual_count = conn.execute("SELECT COUNT(*) as c FROM analytics WHERE action = 'VISUALIZER'").fetchone()['c']

        # Recent activity (last 10)
        recent = conn.execute(
            """SELECT a.action, a.timestamp, COALESCE(u.username, 'Guest') as username
               FROM analytics a LEFT JOIN users u ON a.user_id = u.id
               ORDER BY a.timestamp DESC LIMIT 10"""
        ).fetchall()

        return jsonify({
            "total_users": total_users,
            "debug_requests": debug_count,
            "visualize_requests": visual_count,
            "recent_activity": [dict(r) for r in recent]
        })
    finally:
        conn.close()

# ─────────────────────────────────────────────
# ANALYZE (existing + tracking)
# ─────────────────────────────────────────────
@app.route('/analyze', methods=['POST'])
def analyze_code():
    data = request.json

    code = data.get('code', '')
    language = data.get('language', 'Python')
    mode = data.get('mode', 'DEBUGGER')
    error_message = data.get('error_message', '')
    expected_output = data.get('expected_output', '')

    if not code:
        return jsonify({"error": "Code is required"}), 400

    try:
        prompt = generate_prompt(mode, language, code, error_message, expected_output)

        messages = [
            {"role": "system", "content": "You are a backend JSON API. You must ONLY output raw JSON. Do NOT wrap it in ```json blocks or provide markdown."},
            {"role": "user", "content": prompt}
        ]

        response = client.chat_completion(
            model="Qwen/Qwen2.5-Coder-32B-Instruct",
            messages=messages,
            max_tokens=2048,
            temperature=0.1
        )

        raw_text = response.choices[0].message.content.strip()
        
        # Clean up markdown if the model stubbornly adds it
        if raw_text.startswith("```json"):
            raw_text = raw_text.replace("```json\n", "", 1)
        if raw_text.startswith("```"):
            raw_text = raw_text.replace("```\n", "", 1)
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3].strip()

        parsed_data = json.loads(raw_text)
        return jsonify({"result": parsed_data})

    except Exception as e:
        return jsonify({"error": f"Failed to analyze with Hugging Face: {str(e)}"}), 500

# ─────────────────────────────────────────────
# BOOTSTRAP
# ─────────────────────────────────────────────
if __name__ == '__main__':
    os.makedirs('static', exist_ok=True)
    init_db()
    print("✅ Database initialized")
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', debug=False, port=port)
