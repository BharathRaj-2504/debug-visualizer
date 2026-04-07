from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY or API_KEY == "your_gemini_api_key_here":
    print("WARNING: GEMINI_API_KEY is not configured.")

client = genai.Client()

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

@app.route('/')
def index():
    return app.send_static_file('index.html')

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
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        
        parsed_data = json.loads(response.text)
        return jsonify({"result": parsed_data})
        
    except Exception as e:
        return jsonify({"error": f"Failed to analyze with Gemini: {str(e)}"}), 500

if __name__ == '__main__':
    os.makedirs('static', exist_ok=True)
    app.run(debug=True, port=5000)
