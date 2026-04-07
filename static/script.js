document.addEventListener('DOMContentLoaded', () => {
    let editor;
    let currentMarker = null;
    let Range;
    
    // Player Machine State
    let stepsData = [];
    let currentStepIndex = 0;

    // Ace Editor Setup
    editor = ace.edit("editor-container");
    editor.setTheme("ace/theme/tomorrow_night_eighties");
    editor.session.setMode("ace/mode/python");
    editor.setFontSize(14);
    editor.setOptions({
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        showPrintMargin: false,
        wrap: true
    });

    Range = ace.require('ace/range').Range;

    editor.setValue([
        "// Start writing your code here...",
        "// Use the mode dropdown to switch between Debugger and Visualizer!"
    ].join('\n'), -1);

    document.getElementById('language-select').addEventListener('change', (e) => {
        const langMap = { 'Python': 'python', 'C': 'c_cpp', 'C++': 'c_cpp', 'Java': 'java' };
        editor.session.setMode(`ace/mode/${langMap[e.target.value]}`);
    });

    let globalMode = 'VISUALIZER';
    const debuggerInputs = document.getElementById('debugger-inputs');

    const analyzeBtn = document.getElementById('analyze-btn');
    const btnText = analyzeBtn.querySelector('.btn-text');
    const loader = analyzeBtn.querySelector('.loader');

    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            modeButtons.forEach(b => b.classList.remove('active'));
            const targetBtn = e.currentTarget;
            targetBtn.classList.add('active');
            
            globalMode = targetBtn.dataset.mode;
            debuggerInputs.style.display = globalMode === 'DEBUGGER' ? 'flex' : 'none';
            btnText.textContent = globalMode === 'DEBUGGER' ? 'Debug' : 'Trace Execution';
            resetPlayerUI();
        });
    });

    analyzeBtn.addEventListener('click', async () => {
        if (!editor) return;
        const code = editor.getValue();
        if (!code.trim()) return;

        // Visual feedback
        analyzeBtn.disabled = true;
        btnText.textContent = "Processing logic flow...";
        loader.classList.remove('hidden');
        resetPlayerUI();

        document.getElementById('empty-state').innerHTML = '<p style="color: #666">Contacting GenAI execution engine... 🚀</p>';
        document.getElementById('empty-state').classList.remove('hidden');

        try {
            const response = await fetch('http://127.0.0.1:5000/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code,
                    language: document.getElementById('language-select').value,
                    mode: globalMode,
                    error_message: document.getElementById('error-message').value,
                    expected_output: document.getElementById('expected-output').value
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Server responded with an error');

            const payload = data.result;
            if(!payload) throw new Error("Invalid sequence data received from AI engine.");

            initializePlayer(payload);

        } catch (error) {
            document.getElementById('empty-state').innerHTML = `<div class="alert-box"><h4>Failure</h4><p>${error.message}</p></div>`;
        } finally {
            analyzeBtn.disabled = false;
            btnText.textContent = globalMode === 'DEBUGGER' ? 'Debug' : 'Trace Execution';
            loader.classList.add('hidden');
        }
    });

    // Sub-system: UI Player Lifecycle methods
    function resetPlayerUI() {
        document.getElementById('player-container').classList.add('hidden');
        document.getElementById('empty-state').classList.remove('hidden');
        stepsData = [];
        currentStepIndex = 0;
        clearHighlights();
        if (editor) editor.session.clearAnnotations();
    }

    function initializePlayer(payload) {
        document.getElementById('empty-state').classList.add('hidden');
        document.getElementById('player-container').classList.remove('hidden');
        
        stepsData = payload.steps || [];
        currentStepIndex = 0;

        // Handle Debugger Mode Specifics
        const errorBanner = document.getElementById('error-banner');
        if (payload.error || (payload.analysis && payload.analysis.length > 0)) {
            errorBanner.classList.remove('hidden');
            
            if (payload.error) {
                const errLineNum = parseInt(payload.error.line) || 1;
                document.getElementById('error-title').textContent = `${payload.error.type || 'Execution'} Error (Line ${errLineNum})`;
                document.getElementById('error-desc').textContent = payload.error.message;

                // Add gutter badge
                editor.session.setAnnotations([{
                    row: errLineNum - 1, 
                    column: 0, 
                    text: payload.error.message, 
                    type: "error"
                }]);

                // Token highlighting
                if (payload.error.token) {
                    const lineText = editor.session.getLine(errLineNum - 1) || "";
                    const startCol = lineText.indexOf(payload.error.token);
                    
                    if (startCol !== -1) {
                        clearHighlights();
                        currentMarker = editor.session.addMarker(
                            new Range(errLineNum - 1, startCol, errLineNum - 1, startCol + payload.error.token.length),
                            "ace_error-token", 
                            "text"
                        );
                        editor.scrollToLine(errLineNum - 1, true, true, function () {});
                    }
                }
            } else {
                document.getElementById('error-title').textContent = "Debugger Analysis";
                document.getElementById('error-desc').textContent = "Review the findings below.";
            }

            // Handle Analysis Bullet Points
            const analysisList = document.getElementById('error-analysis-list');
            analysisList.innerHTML = '';
            if (payload.analysis && payload.analysis.length > 0) {
                document.querySelector('.analysis-container').style.display = 'block';
                payload.analysis.forEach(item => {
                    const li = document.createElement('li');
                    li.textContent = item;
                    li.style.marginBottom = "4px";
                    analysisList.appendChild(li);
                });
            } else {
                document.querySelector('.analysis-container').style.display = 'none';
            }

            if (payload.fixed_code) {
                document.querySelector('.fixed-code-container').classList.remove('hidden');
                document.getElementById('fixed-code-block').textContent = payload.fixed_code;
                window.currentFixedCode = payload.fixed_code;
            }
        } else {
            errorBanner.classList.add('hidden');
        }

        // Output final standard output
        const outputCard = document.getElementById('final-output-card');
        if (payload.final_output) {
            outputCard.classList.remove('hidden');
            document.getElementById('final-output-text').textContent = payload.final_output;
        } else {
            outputCard.classList.add('hidden');
        }

        if (stepsData.length > 0) {
            document.getElementById('player-controls').style.display = 'block';
            document.getElementById('step-card').style.display = 'block';
            document.getElementById('variables-card').style.display = 'block';
            renderStep();
        } else {
            document.getElementById('player-controls').style.display = 'none';
            document.getElementById('step-card').style.display = 'none';
            document.getElementById('variables-card').style.display = 'none';
        }
    }

    function renderStep() {
        if (!stepsData || stepsData.length === 0) return;
        const step = stepsData[currentStepIndex];

        // 1. Mutate UI Step Text Information
        document.getElementById('step-counter').textContent = `${currentStepIndex + 1} / ${stepsData.length}`;
        document.getElementById('progress-fill').style.width = `${((currentStepIndex + 1) / stepsData.length) * 100}%`;
        document.getElementById('step-action').textContent = step.action || 'Execute';
        document.getElementById('step-title').textContent = step.title || `Step ${step.step}`;
        document.getElementById('step-desc').textContent = step.explanation || 'Program executes this branch.';

        // 2. Playback Button Limits
        document.getElementById('btn-first').disabled = currentStepIndex === 0;
        document.getElementById('btn-prev').disabled = currentStepIndex === 0;
        document.getElementById('btn-next').disabled = currentStepIndex === stepsData.length - 1;
        document.getElementById('btn-last').disabled = currentStepIndex === stepsData.length - 1;

        // 3. Fire custom Monaco Line Selection Event
        highlightEditorLine(step.line);

        // 4. Transform and Load Variable Datasets Grid
        renderVariablesGrid(step);
    }

    function renderVariablesGrid(step) {
        const tbody = document.getElementById('variables-tbody');
        tbody.innerHTML = '';
        const vars = step.variables || {};
        const changes = step.changes || {};

        if (Object.keys(vars).length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#555; padding: 20px">No Variables to Track</td></tr>';
            return;
        }

        for (const [key, val] of Object.entries(vars)) {
            const tr = document.createElement('tr');
            
            const tdKey = document.createElement('td');
            tdKey.textContent = key;
            tdKey.style.color = '#79c0ff'; // Light blue for var names in IDE

            const tdVal = document.createElement('td');
            tdVal.textContent = (val !== null && typeof val === 'object') ? JSON.stringify(val) : String(val);

            // Change highlight implementation logic
            const tdChange = document.createElement('td');
            if (changes[key]) {
                const oldRaw = changes[key].old;
                const newRaw = changes[key].new;
                
                if (JSON.stringify(oldRaw) === JSON.stringify(newRaw)) {
                    tdChange.textContent = '-';
                } else {
                    const oldV = oldRaw === undefined ? '-' : JSON.stringify(oldRaw);
                    const newV = newRaw === undefined ? '-' : JSON.stringify(newRaw);
                    tdChange.innerHTML = `<span style="text-decoration:line-through;color:#888;margin-right:8px">${oldV}</span> <span style="font-weight:600;color:var(--accent-green)">${newV}</span>`;
                    tr.classList.add('val-change');
                }
            } else {
                tdChange.textContent = '-';
            }

            tr.appendChild(tdKey);
            tr.appendChild(tdVal);
            tr.appendChild(tdChange);
            tbody.appendChild(tr);
        }
    }

    // Ace Decoration Injection
    function clearHighlights() {
        if (editor && currentMarker !== null) {
            editor.session.removeMarker(currentMarker);
            currentMarker = null;
        }
    }

    function highlightEditorLine(lineNumber) {
        if (!editor || !lineNumber || lineNumber < 1) return;
        
        clearHighlights();
        
        const lineIndex = lineNumber - 1; // Ace API uses 0-indexed rows
        currentMarker = editor.session.addMarker(
            new Range(lineIndex, 0, lineIndex, 1),
            "ace_active-line", 
            "fullLine"
        );

        editor.scrollToLine(lineIndex, true, true, function () {});
    }

    // Register Controls
    document.getElementById('apply-fix-btn').addEventListener('click', () => {
        if (window.currentFixedCode) {
            editor.setValue(window.currentFixedCode, -1);
            resetPlayerUI();
        }
    });

    document.getElementById('btn-first').addEventListener('click', () => { currentStepIndex = 0; renderStep(); });
    document.getElementById('btn-prev').addEventListener('click', () => { if(currentStepIndex > 0) currentStepIndex--; renderStep(); });
    document.getElementById('btn-next').addEventListener('click', () => { if(currentStepIndex < stepsData.length - 1) currentStepIndex++; renderStep(); });
    document.getElementById('btn-last').addEventListener('click', () => { currentStepIndex = stepsData.length - 1; renderStep(); });
});
